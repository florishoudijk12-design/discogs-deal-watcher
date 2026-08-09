'use strict';

/*
 * Durable per-listing history for the desktop dashboard.
 *
 * The cloud watcher only sees a release's aggregate lowest price. The desktop scraper can see the
 * stable Discogs itemId for every copy, so it can distinguish a real price edit on one listing from
 * a different cheap copy appearing. This store records that exact history without changing the
 * watcher's existing release-level deal/dedupe state.
 */

const fs = require('fs');
const path = require('path');

const VERSION = 1;
const EVENTS_CAP = 30;
const LISTINGS_CAP = 25000;
const INACTIVE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const finitePrice = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const round2 = (n) => Math.round(n * 100) / 100;

function makeListingHistory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'listing-history.json');

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!parsed || typeof parsed !== 'object') throw new Error('root must be an object');
      return {
        version: VERSION,
        listings: parsed.listings && typeof parsed.listings === 'object' ? parsed.listings : {},
        releases: parsed.releases && typeof parsed.releases === 'object' ? parsed.releases : {},
      };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { version: VERSION, listings: {}, releases: {} };
      let backup = null;
      try {
        backup = `${target}.corrupt-${Date.now()}`;
        fs.copyFileSync(target, backup);
      } catch { backup = null; }
      throw new Error(`Could not read ${target}${backup ? `; preserved at ${backup}` : ''}: ${error.message}`);
    }
  }

  let state = read();

  function write() {
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, target);
  }

  function addEvent(record, event) {
    if (!Array.isArray(record.events)) record.events = [];
    record.events.push(event);
    if (record.events.length > EVENTS_CAP) record.events.splice(0, record.events.length - EVENTS_CAP);
  }

  function prune(now) {
    for (const [id, record] of Object.entries(state.listings)) {
      if (record && record.active === false && now - (record.lastSeenAt || 0) > INACTIVE_TTL_MS) delete state.listings[id];
    }
    const entries = Object.entries(state.listings);
    if (entries.length <= LISTINGS_CAP) return;
    entries.sort((a, b) => (a[1].lastSeenAt || 0) - (b[1].lastSeenAt || 0));
    for (const [id] of entries.slice(0, entries.length - LISTINGS_CAP)) delete state.listings[id];
  }

  function movement(record, flags = {}) {
    return {
      listingId: record.itemId,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      seenCount: record.seenCount,
      previousPrice: flags.previousPrice ?? null,
      currentPrice: record.lastPrice,
      dropAmount: flags.dropAmount ?? null,
      dropPct: flags.dropPct ?? null,
      priceDropped: !!flags.priceDropped,
      priceRaised: !!flags.priceRaised,
      newListing: !!flags.newListing,
      relisted: !!flags.relisted,
    };
  }

  /*
   * Observe one release's current copies and return movement metadata keyed by itemId.
   * `complete` must only be true when all current copies were returned; otherwise unseen itemIds are
   * deliberately left active (the Discogs endpoint is capped at 100 rows).
   */
  function observeRelease(releaseId, listings, { ts = Date.now(), complete = false } = {}) {
    const rid = String(releaseId);
    const currentIds = new Set();
    const result = {};

    for (const listing of (Array.isArray(listings) ? listings : [])) {
      if (!listing || listing.itemId == null) continue;
      const price = finitePrice(listing.price);
      if (price == null) continue;
      const id = String(listing.itemId);
      if (currentIds.has(id)) continue;
      currentIds.add(id);
      const old = state.listings[id];
      const previousPrice = old ? finitePrice(old.lastPrice) : null;
      const newListing = !old;
      const relisted = !!(old && old.active === false);
      const priceDropped = previousPrice != null && price < previousPrice;
      const priceRaised = previousPrice != null && price > previousPrice;
      const dropAmount = priceDropped ? round2(previousPrice - price) : null;
      const dropPct = priceDropped && previousPrice > 0 ? (previousPrice - price) / previousPrice : null;
      const record = old || {
        itemId: listing.itemId,
        releaseId,
        firstSeenAt: ts,
        seenCount: 0,
        lowestPrice: price,
        highestPrice: price,
        events: [],
      };

      record.releaseId = releaseId;
      record.lastSeenAt = ts;
      record.seenCount = (record.seenCount || 0) + 1;
      record.lastPrice = price;
      record.lowestPrice = Math.min(finitePrice(record.lowestPrice) ?? price, price);
      record.highestPrice = Math.max(finitePrice(record.highestPrice) ?? price, price);
      record.currency = listing.currency || record.currency || null;
      record.media = listing.media || record.media || null;
      record.sleeve = listing.sleeve || record.sleeve || null;
      record.active = true;
      record.missingSince = null;

      if (newListing) addEvent(record, { ts, type: 'first-seen', price });
      else if (relisted) addEvent(record, { ts, type: 'relisted', price, previousPrice });
      if (priceDropped) addEvent(record, { ts, type: 'price-drop', price, previousPrice });
      else if (priceRaised) addEvent(record, { ts, type: 'price-rise', price, previousPrice });

      state.listings[id] = record;
      result[id] = movement(record, { previousPrice, dropAmount, dropPct, priceDropped, priceRaised, newListing, relisted });
    }

    const prior = state.releases[rid];
    if (complete && prior && Array.isArray(prior.itemIds)) {
      for (const id of prior.itemIds) {
        if (currentIds.has(String(id))) continue;
        const record = state.listings[id];
        if (!record || record.active === false) continue;
        record.active = false;
        record.missingSince = ts;
        addEvent(record, { ts, type: 'gone', price: record.lastPrice });
      }
    }
    state.releases[rid] = {
      lastSnapshotAt: ts,
      complete: !!complete,
      itemIds: complete ? Array.from(currentIds) : Array.from(new Set([...(prior && prior.itemIds || []), ...currentIds])),
    };

    prune(ts);
    write();
    return result;
  }

  function getListing(itemId) { return state.listings[String(itemId)] || null; }

  return { observeRelease, getListing, file: target };
}

module.exports = { makeListingHistory, EVENTS_CAP, LISTINGS_CAP, INACTIVE_TTL_MS };

if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddw-listing-history-'));
  let history = makeListingHistory(dir);

  let movement = history.observeRelease(10, [
    { itemId: 101, price: 42, currency: 'EUR', media: 'VG+' },
    { itemId: 102, price: 55, currency: 'EUR', media: 'NM' },
  ], { ts: 1000, complete: true });
  assert.ok(movement['101'].newListing && !movement['101'].priceDropped, 'first observation is new, not a drop');

  movement = history.observeRelease(10, [
    { itemId: 101, price: 31, currency: 'EUR', media: 'VG+' },
    { itemId: 102, price: 60, currency: 'EUR', media: 'NM' },
  ], { ts: 2000, complete: true });
  assert.strictEqual(movement['101'].previousPrice, 42, 'remembers the exact prior listing price');
  assert.strictEqual(movement['101'].dropAmount, 11, 'calculates the price drop');
  assert.ok(Math.abs(movement['101'].dropPct - 11 / 42) < 1e-9, 'calculates the drop percentage');
  assert.ok(movement['102'].priceRaised && !movement['102'].priceDropped, 'price rises are distinguished');

  history.observeRelease(10, [{ itemId: 102, price: 60 }], { ts: 3000, complete: true });
  assert.strictEqual(history.getListing(101).active, false, 'missing copy is marked gone after a complete snapshot');
  movement = history.observeRelease(10, [{ itemId: 101, price: 29 }, { itemId: 102, price: 60 }], { ts: 4000, complete: true });
  assert.ok(movement['101'].relisted && movement['101'].priceDropped, 'same item returning is a relist and can also be a drop');

  history.observeRelease(10, [{ itemId: 101, price: 29 }], { ts: 5000, complete: false });
  assert.strictEqual(history.getListing(102).active, true, 'partial/capped snapshots never falsely mark unseen copies gone');

  history = makeListingHistory(dir);
  assert.strictEqual(history.getListing(101).seenCount, 4, 'history survives an app restart');
  assert.ok(history.getListing(101).events.some((event) => event.type === 'price-drop'), 'price-change events are durable');
  console.log('listing-history selftest: all assertions passed');
}
