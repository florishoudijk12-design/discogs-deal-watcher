'use strict';

// Pure scan policy kept outside Electron so reference selection and configuration are regression-testable.
function scanMinDiscount(config = {}) {
  const value = Number(config.minDiscount);
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0.5;
}

function parseMoney(value) {
  if (value == null) return null;
  let text = String(value).trim().replace(/[^0-9,.-]/g, '');
  if (!text) return null;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    text = text
      .replace(decimal === ',' ? /\./g : /,/g, '')
      .replace(decimal, '.');
  } else if (comma >= 0) {
    const decimals = text.length - comma - 1;
    text = decimals > 0 && decimals <= 2 ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (dot >= 0) {
    const looksLikeThousands = /^-?\d{1,3}(?:\.\d{3})+$/.test(text);
    if (looksLikeThousands) text = text.replace(/\./g, '');
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function evaluateScanPreliminary({ engine, store, rel, stats, suggestion, config }) {
  const sold = store.getSoldMedian(rel.releaseId);
  return engine.evaluateMarketSignal({
    lowest: stats.lowestPrice,
    soldMedian: sold ? sold.median : null,
    suggestion: suggestion ? suggestion.vgplus : null,
    suggestionLow: suggestion ? suggestion.vg : null,
    ladder: suggestion ? suggestion.ladder : null,
    trailingMedian: store.trailingMedianLowest(rel.releaseId, config.trailingN),
    prevAlertedLowest: null,
  }, { minDiscount: scanMinDiscount(config) });
}

module.exports = { scanMinDiscount, parseMoney, evaluateScanPreliminary };

if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  const engine = require('../engine');
  const history = [50, 50, 50];
  const store = {
    getSoldMedian() { return { median: 100 }; },
    trailingMedianLowest() { return 50; },
  };
  const rel = { releaseId: 1 };
  const stats = { lowestPrice: 45 };
  const suggestion = { vgplus: 50, vg: 30, ladder: null };

  const withSold = evaluateScanPreliminary({ engine, store, rel, stats, suggestion, config: { minDiscount: 0.5, trailingN: history.length } });
  assert.ok(withSold.meetsThreshold, 'real sold median can promote a candidate the suggestion would miss');
  assert.strictEqual(withSold.referenceSource, 'sold-median');
  assert.strictEqual(withSold.reference, 100);

  assert.strictEqual(scanMinDiscount({ minDiscount: 0.65 }), 0.65, 'configured threshold is preserved');
  assert.strictEqual(scanMinDiscount({ minDiscount: '0.3' }), 0.3, 'numeric env/file strings are accepted');
  assert.strictEqual(scanMinDiscount({ minDiscount: NaN }), 0.5, 'invalid threshold falls back safely');
  const strict = evaluateScanPreliminary({ engine, store, rel, stats, suggestion, config: { minDiscount: 0.6 } });
  assert.ok(!strict.meetsThreshold, 'configured threshold changes candidate admission');

  assert.strictEqual(parseMoney('€12,50'), 12.5);
  assert.strictEqual(parseMoney('€1.234,56'), 1234.56);
  assert.strictEqual(parseMoney('$1,234.56'), 1234.56);
  assert.strictEqual(parseMoney('1.234'), 1234);
  assert.strictEqual(parseMoney('n/a'), null);

  console.log('scan-policy selftest: all assertions passed');
}
