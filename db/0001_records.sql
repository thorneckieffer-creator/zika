-- 字卡 — the record store. Migration 0001 (`records`), applied to the Supabase project on 16 November 2026.
--
-- What it is for, the protocol the app speaks to it and how it is tested are in docs/backend.md. Run on an empty
-- Supabase project, this file and the ones after it rebuild the whole backend. Nothing here is a secret.
--
-- The shape, in one paragraph: a person owns records. A record is a key (`<kind>~<id>`), a stamp that says which
-- version is the later one, and a value the database never looks inside. People read their own rows directly and
-- change them only through rec_write(), which takes a version when its stamp is later than the stored one and
-- numbers every version it takes, 1, 2, 3 … per person, so a device can ask for "everything after 41".

create schema if not exists private;          -- not served by the API: only the functions below reach it
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- The records
-- ---------------------------------------------------------------------------------------------------------------

create table public.rec (
  owner uuid        not null references auth.users (id) on delete cascade,
  k     text        collate "C" not null,     -- <kind>~<id>, e.g. c~w123:rec
  h     text        collate "C" not null,     -- the stamp: 13 digits of milliseconds, 3 of counter, the device's id
  j     text,                                 -- the value, exactly as the app sent it; null when deleted
  d     boolean     not null default false,   -- the deleted mark (a tombstone keeps its stamp)
  n     bigint      not null,                 -- the change number: the owner's nth accepted version
  at    timestamptz not null default now(),   -- when the server took it
  x     timestamptz,                          -- when the server may forget it; null = never
  primary key (owner, k),
  constraint rec_key   check (octet_length(k) between 3 and 512 and k ~ '^[a-z]{1,3}~.' and k !~ '[\x01-\x1f\x7f]'),
  constraint rec_stamp check (h ~ '^[0-9]{13}[0-9a-z]{3}[0-9A-Za-z_-]{1,47}$'),
  constraint rec_value check (case when d then j is null else j is not null and octet_length(j) <= 65536 end),
  constraint rec_n     check (n > 0)
);

-- "C" on k and h: stamps and keys are compared byte by byte, the way the app compares them as strings.

create unique index rec_owner_n on public.rec (owner, n);               -- everything after n, in order
create index rec_owner_x on public.rec (owner, x) where x is not null;  -- what is due to be forgotten

alter table public.rec enable row level security;

-- A signed-in person reads their own rows that have not expired. There is no policy for insert, update or
-- delete, and no grant for them either: rec_write() is the only way in.
create policy "read own records" on public.rec for select to authenticated
  using (owner = (select auth.uid()) and (x is null or x > now()));

revoke all on public.rec from public, anon, authenticated;
grant select (k, h, j, d, n) on public.rec to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- One row per person: the change counter, the record format, and what they are using
-- ---------------------------------------------------------------------------------------------------------------

create table private.rec_owner (
  owner uuid        primary key references auth.users (id) on delete cascade,
  n     bigint      not null default 0,       -- the last change number given out
  fmt   smallint    not null default 1,       -- the newest record format that has written here
  nrows integer     not null default 0,       -- rows held
  bytes bigint      not null default 0,       -- their size, as rec_write() counts it
  win   timestamptz not null default now(),   -- start of the current minute of writing
  win_n integer     not null default 0        -- records sent in it
);
alter table private.rec_owner enable row level security;   -- and no policy: nobody reaches it through the API

-- ---------------------------------------------------------------------------------------------------------------
-- rec_write(v, recs): the only way a record changes
-- ---------------------------------------------------------------------------------------------------------------
--
--   v     the record format the calling app speaks (1 today). An app older than the newest format that has
--         written to this account is refused, whole call: it must update before it writes.
--   recs  [{k, h, j}, {k, h, d: true}, …], at most 1000. Optional on any of them: t, seconds until the server may
--         forget the record (for what the app itself forgets: sibling claims, old daily snapshots).
--
-- Answer: {now, n, r}. now is the server's clock in ms, n the owner's change number after the call, and r has one
-- entry per record sent, in order:
--
--   {"n": 124}                    taken; this version is the owner's 124th change
--   {"n": 97, "same": true}       exactly this version is already stored (a batch sent twice); nothing changed
--   {"old": {h, j | d, n}}        not taken: the stored version is later (or has the same stamp and another
--                                 value). Here it is, to be merged on the device.
--   {"no": "<why>"}               refused for its form, and never to be sent again as it is:
--                                 shape, key, stamp, future (a stamp more than five minutes ahead of the server),
--                                 size, ttl, full (the account's room is used up)
--
-- One record's refusal never holds up the others. What refuses the whole call is raised as an error (HTTP status
-- in brackets): rec:signin [401], rec:unconfirmed [403], rec:shape and rec:batch [400], rec:newer [409],
-- rec:slow [429].
--
-- Everything one person writes goes through one lock (their rec_owner row), so their change numbers are handed
-- out and committed in order with none missing: a device that has seen 41 and is told 42 has missed nothing.

create function public.rec_write(v integer, recs jsonb)
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

  _uid    uuid := auth.uid();
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
  -- who is asking: a signed-in person whose email is confirmed, and no anonymous session
  if _uid is null then
    raise sqlstate 'PT401' using message = 'rec:signin';
  end if;
  if not exists (select 1 from auth.users u
                 where u.id = _uid and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)) then
    raise sqlstate 'PT403' using message = 'rec:unconfirmed';
  end if;

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

-- ---------------------------------------------------------------------------------------------------------------
-- rec_head(): what a device asks first — the server's clock, the owner's change number, the record format
-- ---------------------------------------------------------------------------------------------------------------
-- {now, n, v}; n and v are 0 for an account that has never written. One small answer tells a device whether
-- there is anything to fetch, what time it really is before it stamps anything, and whether a newer app has
-- written here.

create function public.rec_head()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'now', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'n',   coalesce(o.n, 0),
    'v',   coalesce(o.fmt, 0))
  from (select auth.uid() as id) me
  left join private.rec_owner o on o.owner = me.id
  where me.id is not null;
$$;

revoke all on function public.rec_write(integer, jsonb) from public, anon;
revoke all on function public.rec_head() from public, anon;
grant execute on function public.rec_write(integer, jsonb) to authenticated;
grant execute on function public.rec_head() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- The signal: a private Realtime channel per person, `rec:<their id>`
-- ---------------------------------------------------------------------------------------------------------------
-- A signed-in person may listen to their own channel. Nobody may send on it: there is no insert policy, and
-- rec_write() sends as the database.

create policy "hear own change signal" on realtime.messages for select to authenticated
  using (extension = 'broadcast' and realtime.topic() = 'rec:' || (select auth.uid())::text);
