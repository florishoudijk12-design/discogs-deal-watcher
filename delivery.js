'use strict';

/*
 * delivery.js — persistent notification delivery for detected deals and rare gems.
 *
 * Detection writes an item to store.js's outbox. This module sends queued items and only then
 * acknowledges their alert-dedupe state. A temporary mail/Telegram outage therefore leaves the
 * item pending for a later retry instead of silently suppressing it forever.
 */

const DEFAULT_RETRY_MS = 5 * 60 * 1000;

async function flushPendingAlerts({ store, mailer, telegram, ids = null, force = false, retryMs = DEFAULT_RETRY_MS } = {}) {
  if (!store) throw new Error('flushPendingAlerts requires a store');
  const now = Date.now();
  const all = store.getPendingAlerts();
  const wanted = ids ? new Set(ids.map(String)) : null;
  let queued = all.filter((item) => {
    if (wanted && !wanted.has(String(item.id))) return false;
    return force || !item.lastAttemptAt || now - item.lastAttemptAt >= retryMs;
  });
  // Preserve caller order so watch-once can keep its strongest deal first in a batched message.
  if (ids) {
    const order = new Map(ids.map((id, index) => [String(id), index]));
    queued = queued.sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
  }
  const result = { attempted: queued.length, delivered: 0, pending: queued.length, emailSent: 0, telegramSent: 0, emailErrors: [], telegramErrors: [] };

  for (const kind of ['gem', 'deal']) {
    const items = queued.filter((item) => item.kind === kind);
    if (!items.length) continue;
    const payloads = items.map((item) => item.payload);
    const configured = !!(mailer && mailer.enabled) || !!(telegram && telegram.enabled);
    let delivered = !configured; // dashboard-only mode: persistence itself is the intended outcome.
    const errors = [];

    for (const item of items) store.markPendingAttempt(item.id, { ts: now });

    if (mailer && mailer.enabled) {
      try {
        if (kind === 'gem') await mailer.sendGems(payloads);
        else await mailer.sendDeals(payloads);
        delivered = true;
        result.emailSent += items.length;
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        result.emailErrors.push({ kind, error: msg });
        errors.push(`email: ${msg}`);
      }
    }

    if (telegram && telegram.enabled) {
      try {
        if (kind === 'gem') await telegram.sendGems(payloads);
        else await telegram.sendDeals(payloads);
        delivered = true;
        result.telegramSent += items.length;
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        result.telegramErrors.push({ kind, error: msg });
        errors.push(`telegram: ${msg}`);
      }
    }

    if (delivered) {
      for (const item of items) store.ackPendingAlert(item.id, now);
      result.delivered += items.length;
    } else {
      for (const item of items) store.markPendingAttempt(item.id, { ts: now, error: errors.join(' | ') });
    }
  }

  result.pending = store.getPendingAlerts().length;
  return result;
}

module.exports = { flushPendingAlerts, DEFAULT_RETRY_MS };

if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { makeStore } = require('./store');

  (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddw-delivery-'));
    try {
      let store = makeStore(tmp);
      const deal = { id: 'd1', releaseId: 1, lowest: 10, ts: 100 };
      const pending = store.queuePendingAlert('deal', deal);
      const failing = { enabled: true, async sendDeals() { throw new Error('mail down'); }, async sendGems() {} };
      const off = { enabled: false };

      let r = await flushPendingAlerts({ store, mailer: failing, telegram: off, ids: [pending.id], force: true });
      assert.strictEqual(r.delivered, 0, 'a failed notification is not acknowledged');
      assert.strictEqual(store.getAlerted(1), null, 'failed delivery does not poison deal dedupe');
      assert.strictEqual(store.getPendingAlerts().length, 1, 'failed delivery stays in the outbox');

      store = makeStore(tmp); // simulate the process exiting after the provider failure
      assert.strictEqual(store.getPendingAlerts().length, 1, 'outbox survives a process restart');
      r = await flushPendingAlerts({ store, mailer: failing, telegram: off, ids: [pending.id] });
      assert.strictEqual(r.attempted, 0, 'retry backoff prevents an immediate provider hammer');

      const telegram = { enabled: true, async sendDeals() {}, async sendGems() {} };
      r = await flushPendingAlerts({ store, mailer: failing, telegram, ids: [pending.id], force: true });
      assert.strictEqual(r.delivered, 1, 'one successful configured channel acknowledges the alert');
      assert.strictEqual(store.getAlerted(1).lowest, 10, 'successful delivery updates deal dedupe');
      assert.strictEqual(store.getPendingAlerts().length, 0, 'delivered item leaves the outbox');

      const gem = { id: 'g1', releaseId: 2, lowest: 50, numForSale: 1, ts: 200 };
      const gp = store.queuePendingAlert('gem', gem);
      await flushPendingAlerts({ store, mailer: off, telegram: off, ids: [gp.id], force: true });
      assert.strictEqual(store.getRareAlerted(2).numForSale, 1, 'dashboard-only mode still dedupes persisted gems');
      assert.strictEqual(store.getPendingAlerts().length, 0);

      console.log('delivery selftest: all assertions passed');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })().catch((e) => { console.error('FAILED:', e.stack || e); process.exit(1); });
}
