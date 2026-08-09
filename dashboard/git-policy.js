'use strict';

function parseGitHubOwner(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  const match = value.match(/github\.com[/:]([^/]+)\/[^/]+?(?:\.git)?$/i);
  return match ? match[1] : null;
}

function sameAccount(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function filterRealMedians(input) {
  const real = {};
  if (input && typeof input === 'object') {
    for (const [id, value] of Object.entries(input)) {
      if (value && value.median != null) real[id] = value;
    }
  }
  return real;
}

function mergeSoldMedians(remoteInput, localInput) {
  const remote = filterRealMedians(remoteInput);
  const local = filterRealMedians(localInput);
  const merged = {};
  const ids = [...new Set([...Object.keys(remote), ...Object.keys(local)])]
    .sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
  for (const id of ids) {
    const remoteValue = remote[id];
    const localValue = local[id];
    if (!remoteValue) merged[id] = localValue;
    else if (!localValue) merged[id] = remoteValue;
    else merged[id] = (Number(localValue.ts) || 0) >= (Number(remoteValue.ts) || 0) ? localValue : remoteValue;
  }
  return merged;
}

module.exports = { parseGitHubOwner, sameAccount, filterRealMedians, mergeSoldMedians };

if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  assert.strictEqual(parseGitHubOwner('https://github.com/norsnors/discogs-deal-watcher.git'), 'norsnors');
  assert.strictEqual(parseGitHubOwner('git@github.com:DanielBNR/example.git'), 'DanielBNR');
  assert.strictEqual(parseGitHubOwner('C:\\local\\repo.git'), null);
  assert.ok(sameAccount('NorsNors', 'norsnors'));
  assert.ok(!sameAccount('DanielBNR', 'norsnors'));

  const merged = mergeSoldMedians(
    { 1: { median: 10, ts: 10 }, 2: { median: 20, ts: 30 }, 4: { median: null, ts: 99 } },
    { 1: { median: 11, ts: 20 }, 2: { median: 19, ts: 25 }, 3: { median: 30, ts: 40 } },
  );
  assert.deepStrictEqual(Object.keys(merged), ['1', '2', '3']);
  assert.strictEqual(merged[1].median, 11, 'newer local entry wins');
  assert.strictEqual(merged[2].median, 20, 'newer remote entry wins');
  assert.strictEqual(merged[3].median, 30, 'local-only entry is preserved');
  console.log('git-policy selftest: all assertions passed');
}
