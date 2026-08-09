'use strict';

const ALLOWED_LIMITS = new Set([25, 50, 100, 200]);
const ALLOWED_CURRENCIES = new Set(['EUR', 'USD', 'GBP']);

function normalizeScoutOptions(raw = {}) {
  const field = raw.field === 'genre' ? 'genre' : 'style';
  const query = String(raw.query || '').trim().replace(/\s+/g, ' ');
  if (!query) throw new Error('Choose a Discogs genre or style first.');
  if (query.length > 80) throw new Error('Genre/style is too long.');

  const requestedLimit = Number(raw.limit);
  const limit = ALLOWED_LIMITS.has(requestedLimit) ? requestedLimit : 100;
  const requestedValue = Number(raw.minValue);
  const minValue = Number.isFinite(requestedValue) ? Math.min(5000, Math.max(1, requestedValue)) : 80;
  const requestedCurrency = String(raw.currency || 'EUR').toUpperCase();
  const currency = ALLOWED_CURRENCIES.has(requestedCurrency) ? requestedCurrency : 'EUR';
  return { field, query, limit, minValue, currency, format: 'Vinyl' };
}

function splitArtistTitle(value) {
  const text = String(value || '').trim();
  const marker = text.indexOf(' - ');
  if (marker < 1) return { artist: '', title: text };
  return { artist: text.slice(0, marker).trim(), title: text.slice(marker + 3).trim() };
}

function normalizeSearchResult(raw = {}) {
  const parsed = splitArtistTitle(raw.title);
  const community = raw.community || {};
  return {
    releaseId: Number(raw.id),
    artist: raw.artist || parsed.artist,
    title: raw.release_title || parsed.title,
    year: Number(raw.year) || null,
    country: raw.country || null,
    formats: Array.isArray(raw.format) ? raw.format : [],
    labels: Array.isArray(raw.label) ? raw.label : [],
    genres: Array.isArray(raw.genre) ? raw.genre : [],
    styles: Array.isArray(raw.style) ? raw.style : [],
    catno: raw.catno || null,
    thumb: raw.thumb || raw.cover_image || null,
    have: Number(community.have) || 0,
    want: Number(community.want) || 0,
  };
}

function suggestionSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return { vgplus: null, vg: null, currency: null, ladder: null };
  const vgplus = raw['Very Good Plus (VG+)'];
  const vg = raw['Very Good (VG)'];
  const ladder = {};
  for (const [grade, quote] of Object.entries(raw)) {
    if (quote && Number.isFinite(Number(quote.value))) ladder[grade] = Number(quote.value);
  }
  return {
    vgplus: vgplus && Number.isFinite(Number(vgplus.value)) ? Number(vgplus.value) : null,
    vg: vg && Number.isFinite(Number(vg.value)) ? Number(vg.value) : null,
    currency: (vgplus && vgplus.currency) || (vg && vg.currency) || null,
    ladder: Object.keys(ladder).length ? ladder : null,
  };
}

function scoutScore(item) {
  const value = Number(item.estimatedValue) || 0;
  const want = Number(item.want) || 0;
  const have = Number(item.have) || 0;
  const copies = Number(item.numForSale);
  const demand = Math.min(35, Math.log10(want + 1) * 12);
  const ratio = Math.min(30, (want / Math.max(1, have)) * 25);
  const scarcity = !Number.isFinite(copies) ? 0 : (copies === 0 ? 55 : copies <= 2 ? 35 : copies <= 5 ? 18 : 0);
  return Math.round((value + demand + ratio + scarcity) * 100) / 100;
}

function sortScoutResults(items) {
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
    const score = scoutScore(b) - scoutScore(a);
    if (score) return score;
    return (Number(b.estimatedValue) || 0) - (Number(a.estimatedValue) || 0);
  });
}

module.exports = {
  normalizeScoutOptions,
  normalizeSearchResult,
  suggestionSnapshot,
  scoutScore,
  sortScoutResults,
};

if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  assert.deepStrictEqual(normalizeScoutOptions({ query: '  Italo-Disco  ', minValue: 80, limit: 100 }), {
    field: 'style', query: 'Italo-Disco', limit: 100, minValue: 80, currency: 'EUR', format: 'Vinyl',
  });
  assert.strictEqual(normalizeScoutOptions({ field: 'genre', query: 'Rock', limit: 999, minValue: -2 }).limit, 100);
  assert.throws(() => normalizeScoutOptions({ query: '   ' }), /Choose/);
  const release = normalizeSearchResult({ id: 12, title: 'Artist - Title', community: { want: 90, have: 10 }, style: ['Italo-Disco'] });
  assert.strictEqual(release.artist, 'Artist');
  assert.strictEqual(release.title, 'Title');
  assert.strictEqual(release.want, 90);
  const quote = suggestionSnapshot({ 'Very Good Plus (VG+)': { value: 120, currency: 'EUR' } });
  assert.strictEqual(quote.vgplus, 120);
  assert.ok(scoutScore({ estimatedValue: 100, want: 100, have: 10, numForSale: 0 }) > scoutScore({ estimatedValue: 100, want: 10, have: 100, numForSale: 20 }));
  console.log('scout-policy selftest: all assertions passed');
}
