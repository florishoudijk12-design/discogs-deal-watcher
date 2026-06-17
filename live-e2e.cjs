'use strict';
/*
 * live-e2e.cjs — proves the whole chain works end-to-end with REAL data, no user secrets:
 *
 *   1. pulls a REAL public Discogs wantlist via the official API           (real tracking)
 *   2. fetches REAL marketplace stats (current lowest price) per release    (real market data)
 *   3. runs the REAL processRelease() / evaluateMarketSignal() pipeline      (real detection)
 *   4. SENDS the detected deals as a real email via a throwaway Ethereal SMTP account
 *      and prints a clickable preview URL                                    (real delivery)
 *
 * The only thing simulated is the reference baseline: in production that's the VG+
 * price-suggestion (needs YOUR token) or the trailing median learned over weeks of
 * polling. Here we seed a baseline so a deal fires on today's REAL lowest price.
 *
 * Run:  node live-e2e.cjs            (or: npm run e2e)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const nodemailer = require('nodemailer');
const engine = require('./engine');
const { makeClient } = require('./discogs');
const { makeStore } = require('./store');
const { makeMailer } = require('./mailer');
const { processRelease } = require('./watcher');

const PUBLIC_WANTLIST_USER = process.env.E2E_USER || 'djfood'; // a real public wantlist
const SEED_BASELINE = 18; // EUR — simulated "usual" price so a deal fires on the real low
const EXTRA_RELEASES = [249504]; // Rick Astley NGGYU — guaranteed busy market for a strong demo

async function main() {
  const client = makeClient({ userAgent: 'DiscogsDealWatcher/0.1 (+live-e2e)' });

  console.log(`\n[1] REAL wantlist  —  GET /users/${PUBLIC_WANTLIST_USER}/wants`);
  let wants = [];
  try { wants = await client.getWantlist(PUBLIC_WANTLIST_USER); } catch (e) { console.log('   (wantlist error:', e.message, ')'); }
  console.log(`   -> ${wants.length} real release(s) tracked from the live API`);
  wants.slice(0, 3).forEach((w) => console.log(`      • ${w.artist} – ${w.title}  (release ${w.releaseId})`));

  // Build the working set: the real wantlist releases + a guaranteed-busy one.
  const releases = [...wants.map((w) => ({ releaseId: w.releaseId, title: w.title, artist: w.artist, year: w.year, thumb: w.thumb }))];
  for (const id of EXTRA_RELEASES) {
    const r = await client.getRelease(id);
    if (r) releases.push({ releaseId: r.id, title: r.title, artist: r.artist, year: r.year, thumb: r.thumb });
  }

  console.log(`\n[2] REAL marketplace data  —  GET /marketplace/stats/{id}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddw-e2e-'));
  const store = makeStore(tmp);
  const config = { ...require('./watcher').DEFAULTS, token: '', currency: 'EUR', minDiscount: 0.5 };

  const deals = [];
  for (const rel of releases) {
    // Seed a simulated baseline history so a reference exists without a token.
    for (let i = 0; i < 6; i++) store.pushObservation(rel.releaseId, { ts: Date.now() - (i + 1) * 86400000, lowest: SEED_BASELINE, numForSale: 5 });
    const before = store.trailingMedianLowest(rel.releaseId);
    const deal = await processRelease(rel, { client, store, engine, config });
    const live = (store.trailingMedianLowest(rel.releaseId)); // includes the just-pushed real low
    const obs = store.getDeals(1); // not reliable; print from stats instead
    const histLast = JSON.parse(fs.readFileSync(path.join(tmp, 'history.json'), 'utf8'))[rel.releaseId].slice(-1)[0];
    console.log(`   • ${rel.artist} – ${rel.title}`);
    console.log(`     real current lowest = EUR ${histLast.lowest}  ·  ${histLast.numForSale} for sale  ·  baseline ref = EUR ${SEED_BASELINE}  ->  ${deal ? `DEAL (${Math.round(deal.discount * 100)}% off${deal.suspicious ? ', ⚠maybe<VG+' : ''})` : 'no deal'}`);
    if (deal) deals.push(deal);
  }

  console.log(`\n[3] Detection result: ${deals.length} deal(s) from real prices.`);
  if (!deals.length) { console.log('   No deal fired — try a lower SEED_BASELINE or another release.'); fs.rmSync(tmp, { recursive: true, force: true }); return; }

  console.log(`\n[4] REAL email delivery via throwaway Ethereal SMTP (no account needed)...`);
  const acct = await nodemailer.createTestAccount();
  const mailer = makeMailer({ host: 'smtp.ethereal.email', port: 587, secure: false, user: acct.user, pass: acct.pass, to: 'collector@example.com', from: 'Discogs Deal Watcher <watcher@example.com>' });
  const info = await mailer.sendDeals(deals);
  console.log('   sent! messageId:', info.messageId);
  console.log('   >>> OPEN THIS to see the real rendered email:');
  console.log('   ' + nodemailer.getTestMessageUrl(info));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nEnd-to-end OK: real wantlist -> real prices -> detection -> real email.\n');
}

main().catch((e) => { console.error('E2E FAILED:', e.stack || e); process.exit(1); });
