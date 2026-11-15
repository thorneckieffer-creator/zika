#!/usr/bin/env node
/* Writes a page that shows the Account panel and every sheet of js/account.js in each state,
   inside the app's own stylesheet, so they can be looked at before anything is wired in.

     node tools/test/account-preview.mjs          → tools/test/.cross/account-preview.html
     open tools/test/.cross/account-preview.html  (add #dark to the address for the night side)

   The page is static: buttons do nothing. It takes the first <style> block of index.html (or of
   css/app.css once the stylesheet has moved there) and the strings the script returns. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { FakeBackend, browser, settle } from './fake-firebase.mjs';

const root = new URL('../../', import.meta.url);
let css = '';
if (existsSync(new URL('css/app.css', root))) css = readFileSync(new URL('css/app.css', root), 'utf8');
else {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
}

const b = new FakeBackend();
async function dev(name, owner, cfg) {
  const client = b.client(), page = browser();
  page.acStart(client, Object.assign({ deviceName: () => name, ownerName: () => owner || '', now: () => b.now, appUrl: 'https://example.test/app/' }, cfg || {}));
  await settle(); return { page, client };
}
const sheet = (d, kind, extra) => { d.page.AC_.sheet = Object.assign({ kind, step: '', msg: '', bad: false, busy: false }, extra || {}); const h = d.page.acSheetHtml(); d.page.AC_.sheet = null; return h; };

const out = [];
const show = (title, html) => out.push(`<section><h3 class="pv">${title}</h3>${html}</section>`);
const guest = await dev('Mac', 'Lin');
show('Panel · not connected', browser().acPanelHtml());
show('Panel · guest, alone', guest.page.acPanelHtml());
for (const k of ['create', 'signin', 'approve', 'privacy', 'delete']) show('Sheet · ' + k + ' (guest)', sheet(guest, k));
show('Sheet · create, with an error', sheet(guest, 'create', { msg: 'That email already has an account. Sign in instead.', bad: true, email: 'lin@example.test' }));
const phone = await dev('iPhone'), pad = await dev('iPad');
show('Sheet · join, before', sheet(phone, 'join'));
const r = await phone.page.acJoinStart();
show('Sheet · join, waiting', sheet(phone, 'join'));
show('Sheet · approve, confirm', sheet(guest, 'approve', { step: 'confirm', data: { code: r.code, name: 'iPhone', uid: 'x' }, summary: { started: 1284 } }));
show('Sheet · approve, confirm, in a browser with no deck', sheet(guest, 'approve', { step: 'confirm', data: { code: r.code, name: 'iPhone', uid: 'x' }, summary: { started: 0 } }));
await guest.page.acJoinApprove(r.shown); await settle();
const r2 = await pad.page.acJoinStart(); await guest.page.acJoinApprove(r2.shown); await settle();
b.advance(3 * 86400000);
show('Sheet · join, done', sheet(phone, 'join'));
show('Panel · guest with two devices', guest.page.acPanelHtml());
show('Panel · member', phone.page.acPanelHtml());
for (const k of ['leave', 'delete']) show('Sheet · ' + k + ' (member)', sheet(phone, k));
await guest.page.acCreateAccount('lin@example.test', 'correct horse');
show('Panel · account, email not confirmed', guest.page.acPanelHtml());
for (const k of ['signout', 'delete']) show('Sheet · ' + k + ' (account)', sheet(guest, k));
show('Sheet · approve, done', sheet(guest, 'approve', { step: 'done', data: { name: 'iPhone' } }));

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Account panel preview</title><style>${css}</style><style>${guest.page.acCss()}</style>
<style>.pv{font:600 12px/1 system-ui;color:var(--mut);margin:26px 0 8px}.pvwrap{max-width:720px;margin:0 auto;padding:16px}section .modal-card{margin:0 auto;animation:none}</style>
<script>if(location.hash==='#dark')document.documentElement.dataset.theme='dark';</script></head>
<body><div class="pvwrap">${out.join('\n')}</div></body></html>`;
mkdirSync(new URL('./.cross/', import.meta.url), { recursive: true });
const file = new URL('./.cross/account-preview.html', import.meta.url);
writeFileSync(file, page);
console.log('wrote ' + file.pathname + ' (' + out.length + ' views, ' + Math.round(page.length / 1024) + ' KB)');
