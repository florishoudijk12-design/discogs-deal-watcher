'use strict';
/*
 * watch-once.js — ONE sweep of a rotating slice of the wantlist, then exit.
 *
 * This is the "GitHub Actions every few minutes" model (vs watcher.js, the always-on loop):
 * each scheduled run checks `sliceSize` releases starting where the last run left off
 * (cursor persisted in state/cursor.json), advancing the cursor so successive runs cover the
 * whole wantlist over time. State (history, alert memory, suggestions, cursor) lives in state/
 * and is carried between runs via the Actions cache. Detected deals are emailed (Resend) and
 * written to deals.json (committed by the workflow so the desktop dashboard can read it).
 *
 * Env (set as GitHub Secrets): DISCOGS_TOKEN, DISCOGS_USERNAME, RESEND_API_KEY, MAIL_TO,
 * MAIL_FROM, SLICE_SIZE. Run: `node watch-once.js`.
 */

const fs = require('fs');
const path = require('path');
const engine = require('./engine');
const { makeClient } = require('./discogs');
const { makeStore } = require('./store');
const { makeMailer } = require('./mailer');
const { processRelease, loadConfig } = require('./watcher');

const STATE_DIR = path.join(__dirname, 'state');
const cursorFile = () => path.join(STATE_DIR, 'cursor.json');
const readCursor = () => { try { return JSON.parse(fs.readFileSync(cursorFile(), 'utf8')); } catch { return { idx: 0, wantlistAt: 0, wantlist: [] }; } };
const writeCursor = (c) => fs.writeFileSync(cursorFile(), JSON.stringify(c));

async function main() {
  const config = loadConfig();
  if (!config.username) { console.error('Missing DISCOGS_USERNAME / config.username.'); process.exit(1); }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const store = makeStore(STATE_DIR);
  const client = makeClient({ token: config.token, userAgent: config.userAgent });
  const mailer = makeMailer(config.email);
  const sliceSize = config.sliceSize || 50;

  // Refresh the wantlist at most every wantlistRefreshMs (it changes rarely).
  const cur = readCursor();
  if (!cur.wantlist || !cur.wantlist.length || Date.now() - (cur.wantlistAt || 0) > config.wantlistRefreshMs) {
    cur.wantlist = await client.getWantlist(config.username);
    cur.wantlistAt = Date.now();
    if (cur.idx >= cur.wantlist.length) cur.idx = 0;
    console.log(`Refreshed wantlist: ${cur.wantlist.length} releases.`);
  }
  const N = cur.wantlist.length;
  if (!N) { console.log('Empty wantlist — nothing to do.'); writeCursor(cur); publishDeals(store); return; }

  const start = cur.idx % N;
  const take = Math.min(sliceSize, N);
  console.log(`Sweeping slice [${start}..${(start + take - 1) % N}] of ${N} (mode=${config.mode}, email=${mailer.enabled ? mailer.provider : 'off'}).`);

  const deals = [];
  let checked = 0;
  for (let i = 0; i < take; i++) {
    const rel = cur.wantlist[(start + i) % N];
    try {
      const d = await processRelease(rel, { client, store, engine, config });
      if (d) deals.push(d);
      checked++;
    } catch (e) { console.log(`  release ${rel.releaseId} error: ${e.message}`); }
  }
  cur.idx = (start + take) % N;
  writeCursor(cur);

  const sweepsToCover = Math.ceil(N / take);
  console.log(`Checked ${checked}. Deals this run: ${deals.length}. (Full wantlist covered every ~${sweepsToCover} runs.)`);

  if (deals.length) {
    for (const d of deals) console.log(`  DEAL ${d.artist} – ${d.title}  ${d.currency} ${d.lowest} (${Math.round(d.discount * 100)}% off${d.suspicious ? ', ⚠maybe<VG+' : ''})`);
    if (mailer.enabled) {
      try { await mailer.sendDeals(deals); console.log(`Emailed ${deals.length} deal(s) to ${config.email.to}.`); }
      catch (e) { console.log('Email FAILED:', e.message); }
    } else {
      console.log('Email disabled — deals saved for the dashboard.');
    }
  }

  publishDeals(store);
}

// Write deals.json at the repo root for the dashboard (the workflow commits this file).
function publishDeals(store) {
  fs.writeFileSync(path.join(__dirname, 'deals.json'), JSON.stringify(store.getDeals(200)));
}

main().catch((e) => { console.error('watch-once FAILED:', e.stack || e); process.exit(1); });
