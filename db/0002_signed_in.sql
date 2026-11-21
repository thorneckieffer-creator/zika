-- 字卡 — the record store. Migration 0002 (`signed_in`), applied on 16 November 2026.
--
-- Found by the first run of tools/dbtest.mjs: a device that signed out could go on reading and writing with the
-- token it still held until the token expired, up to an hour later. Supabase's data API checks a token's
-- signature and its expiry, not whether its session still exists. From here on every door asks private.me(),
-- which does: the read policy, rec_write(), rec_head() and the Realtime channel.
--
-- rec_write() and rec_head() are restated whole (a function is replaced, not patched). Only who they take the
-- caller to be has changed; the protocol described in 0001 stands.

grant usage on schema private to authenticated;   -- for private.me() in the policies; the tables in it grant nothing

-- ---------------------------------------------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------------------------------------------
-- private.me() is the caller's id when all of this holds, and null otherwise: the token is a signed-in person's,
-- its session still exists (signing out, here or from another device, deletes the session, so a token a device
-- still holds stops working at once instead of at its expiry an hour later), the email is confirmed, and it is
-- not an anonymous session. Everything below asks this instead of auth.uid().

create function private.me()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  join auth.sessions s on s.user_id = u.id
  where u.id = (select auth.uid())
    and s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
    and u.email_confirmed_at is not null
    and not coalesce(u.is_anonymous, false);
$$;

-- the same, for the functions: it says why not. rec:signin [401] or rec:unconfirmed [403].
create function private.need_me()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _id uuid := private.me();
begin
  if _id is null then
    if exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is null) then
      raise sqlstate 'PT403' using message = 'rec:unconfirmed';
    end if;
    raise sqlstate 'PT401' using message = 'rec:signin';
  end if;
  return _id;
end;
$$;

revoke all on function private.me() from public, anon;
revoke all on function private.need_me() from public, anon;
grant execute on function private.me() to authenticated;

alter policy "read own records" on public.rec
  using (owner = (select private.me()) and (x is null or x > now()));

alter policy "hear own change signal" on realtime.messages
  using (extension = 'broadcast' and realtime.topic() = 'rec:' || (select private.me())::text);

create or replace function public.rec_write(v integer, recs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_call      constant integer  := 1000;          -- records in one call
  c_value     constant integer  := 65536;         -- bytes in one value (the largest real one is about 15 KB)
  c_key       constant integer  := 512;           -- bytes in one key
  c_ahead     constant bigint   := 300000;        -- ms a stamp may be ahead of the server's clock
  c_rows      constant integer  := 40000;         -- rows one person may hold (a full deck is about 6,000)
  c_bytes     constant bigint   := 8388608;       -- and their size (a full deck is under 1 MB)
  c_minute    constant integer  := 30000;         -- records one person may send in a minute
  c_ttl_min   constant numeric  := 60;            -- seconds
  c_ttl_max   constant numeric  := 34560000;      -- 400 days
  c_overhead  constant integer  := 64;            -- counted per row on top of key, stamp and value

  _uid    uuid := private.need_me();     -- a signed-in person, still signed in, whose email is confirmed
  _o      private.rec_owner%rowtype;
  _cur    public.rec%rowtype;
  _now    timestamptz;
  _now_ms bigint;
  _count  integer;
  _el     jsonb;
  _k      text collate "C";
  _h      text collate "C";
  _j      text;
  _d      boolean;
  _t      numeric;
  _x      timestamptz;
  _sz     integer;
  _was    integer;
  _gone_n integer;
  _gone_b bigint;
  _took   boolean := false;
  _out    jsonb[] := '{}';
begin
  if v is null or v < 1 or v > 32767 or recs is null or jsonb_typeof(recs) <> 'array' then
    raise sqlstate 'PT400' using message = 'rec:shape';
  end if;
  _count := jsonb_array_length(recs);
  if _count > c_call then
    raise sqlstate 'PT400' using message = 'rec:batch';
  end if;

  -- the owner's row, locked until this call ends
  insert into private.rec_owner (owner) values (_uid) on conflict (owner) do nothing;
  select * into strict _o from private.rec_owner o where o.owner = _uid for update;

  _now := clock_timestamp();                                    -- after the lock: waiting for it is not the caller's lateness
  _now_ms := floor(extract(epoch from _now) * 1000)::bigint;

  if v < _o.fmt then
    raise sqlstate 'PT409' using message = 'rec:newer';
  end if;
  _o.fmt := v;

  if _now - _o.win > interval '1 minute' then
    _o.win := _now;
    _o.win_n := 0;
  end if;
  if _o.win_n + _count > c_minute then
    raise sqlstate 'PT429' using message = 'rec:slow';
  end if;
  _o.win_n := _o.win_n + _count;

  -- forget what is due
  with gone as (
    delete from public.rec r where r.owner = _uid and r.x <= _now
    returning c_overhead + octet_length(r.k) + octet_length(r.h) + coalesce(octet_length(r.j), 0) as sz
  )
  select count(*), coalesce(sum(g.sz), 0) into _gone_n, _gone_b from gone g;
  _o.nrows := greatest(0, _o.nrows - _gone_n);
  _o.bytes := greatest(0, _o.bytes - _gone_b);

  for _el in select e.value from jsonb_array_elements(recs) as e(value) loop
    if jsonb_typeof(_el) <> 'object' then
      _out := _out || '{"no":"shape"}'::jsonb; continue;
    end if;
    _k := case when jsonb_typeof(_el -> 'k') = 'string' then _el ->> 'k' end;
    _h := case when jsonb_typeof(_el -> 'h') = 'string' then _el ->> 'h' end;
    _j := case when jsonb_typeof(_el -> 'j') = 'string' then _el ->> 'j' end;
    _d := coalesce((_el -> 'd') = 'true'::jsonb, false);

    if _k is null or octet_length(_k) < 3 or octet_length(_k) > c_key
       or _k !~ '^[a-z]{1,3}~.' or _k ~ '[\x01-\x1f\x7f]' then
      _out := _out || '{"no":"key"}'::jsonb; continue;
    end if;
    if _h is null or _h !~ '^[0-9]{13}[0-9a-z]{3}[0-9A-Za-z_-]{1,47}$' then
      _out := _out || '{"no":"stamp"}'::jsonb; continue;
    end if;
    if left(_h, 13)::bigint > _now_ms + c_ahead then
      _out := _out || '{"no":"future"}'::jsonb; continue;
    end if;
    -- a value or the deleted mark, never both and never neither
    if (_d and _el ? 'j') or (not _d and _j is null) or (_el ? 'd' and jsonb_typeof(_el -> 'd') <> 'boolean') then
      _out := _out || '{"no":"shape"}'::jsonb; continue;
    end if;
    if octet_length(_j) > c_value then
      _out := _out || '{"no":"size"}'::jsonb; continue;
    end if;
    _x := null;
    if _el ? 't' then
      _t := case when jsonb_typeof(_el -> 't') = 'number' then (_el ->> 't')::numeric end;
      if _t is null or _t <> trunc(_t) or _t < c_ttl_min or _t > c_ttl_max then
        _out := _out || '{"no":"ttl"}'::jsonb; continue;
      end if;
      _x := _now + make_interval(secs => _t::double precision);
    end if;

    _sz := c_overhead + octet_length(_k) + octet_length(_h) + coalesce(octet_length(_j), 0);
    select * into _cur from public.rec r where r.owner = _uid and r.k = _k;

    if not found then
      if _o.nrows + 1 > c_rows or _o.bytes + _sz > c_bytes then
        _out := _out || '{"no":"full"}'::jsonb; continue;
      end if;
      _o.n := _o.n + 1;
      insert into public.rec (owner, k, h, j, d, n, at, x) values (_uid, _k, _h, _j, _d, _o.n, _now, _x);
      _o.nrows := _o.nrows + 1;
      _o.bytes := _o.bytes + _sz;
      _took := true;
      _out := _out || jsonb_build_object('n', _o.n);

    elsif _h > _cur.h then
      _was := c_overhead + octet_length(_cur.k) + octet_length(_cur.h) + coalesce(octet_length(_cur.j), 0);
      if _sz > _was and _o.bytes - _was + _sz > c_bytes then
        _out := _out || '{"no":"full"}'::jsonb; continue;
      end if;
      _o.n := _o.n + 1;
      update public.rec r set h = _h, j = _j, d = _d, n = _o.n, at = _now, x = _x where r.owner = _uid and r.k = _k;
      _o.bytes := greatest(0, _o.bytes - _was + _sz);
      _took := true;
      _out := _out || jsonb_build_object('n', _o.n);

    elsif _h = _cur.h and _d = _cur.d and _j is not distinct from _cur.j then
      _out := _out || jsonb_build_object('n', _cur.n, 'same', true);

    else
      _out := _out || jsonb_build_object('old',
        case when _cur.d then jsonb_build_object('h', _cur.h, 'd', true, 'n', _cur.n)
             else jsonb_build_object('h', _cur.h, 'j', _cur.j, 'n', _cur.n) end);
    end if;
  end loop;

  update private.rec_owner o
     set n = _o.n, fmt = _o.fmt, nrows = _o.nrows, bytes = _o.bytes, win = _o.win, win_n = _o.win_n
   where o.owner = _uid;

  -- tell the owner's other devices that there is something after the number they hold. The signal carries the
  -- number and nothing else; the records themselves are only ever read from the table, under its policy.
  if _took then
    perform realtime.send(jsonb_build_object('n', _o.n), 'n', 'rec:' || _uid::text, true);
  end if;

  return jsonb_build_object('now', _now_ms, 'n', _o.n, 'r', to_jsonb(_out));
end;
$$;

create or replace function public.rec_head()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'now', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'n',   coalesce(o.n, 0),
    'v',   coalesce(o.fmt, 0))
  from (select private.need_me() as id) me
  left join private.rec_owner o on o.owner = me.id;
$$;
