'use strict';

function dedupeGems(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((gem) => {
    if (!gem || gem.releaseId == null) return false;
    const id = String(gem.releaseId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function cloudBusyFromRun(run, now = Date.now()) {
  if (!run || (run.status !== 'in_progress' && run.status !== 'queued')) return null;
  const budgetMs = (run.event === 'schedule' ? 75 : 16) * 60_000;
  const endsInMs = Math.max(60_000, (run.startedAt || now) + budgetMs - now);
  return { startedAt: run.startedAt, event: run.event, url: run.url, endsInMs };
}

function estimateScanEta(state) {
  const paceOf = (ms, ops, prior) => (ops >= 2 ? ms / ops : prior);
  const apiRemaining = Math.max(0, state.total - state.scanned);
  const apiPace = state.scanned >= 5 ? (state.now - state.scanStart) / state.scanned : 1300;
  const candidateBacklog = Math.max(0, state.candidateCount - state.priced);
  const expectedMore = state.scanned >= 10 ? (state.candidateCount / state.scanned) * apiRemaining : 0;
  const warmRemaining = Math.max(0, Math.min(
    state.warmupBudget - state.warmedChecked,
    state.warmupQueueLength - state.warmupIndex,
  ));
  const browserLane = (candidateBacklog + expectedMore) * paceOf(state.candidateMs, state.candidateOps, 8000)
    + warmRemaining * paceOf(state.warmMs, state.warmOps, 4500);
  return Math.round(Math.max(apiRemaining * apiPace, browserLane));
}

module.exports = { dedupeGems, cloudBusyFromRun, estimateScanEta };

if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  const newest = { releaseId: 7, id: 'new' };
  assert.deepStrictEqual(dedupeGems([newest, { releaseId: '7', id: 'old' }, null]), [newest], 'numeric/string ids dedupe to the newest card');
  assert.strictEqual(cloudBusyFromRun({ status: 'completed' }), null);
  assert.strictEqual(cloudBusyFromRun({ status: 'in_progress', event: 'schedule', startedAt: 1000 }, 1000).endsInMs, 75 * 60_000);
  assert.strictEqual(cloudBusyFromRun({ status: 'queued', event: 'workflow_dispatch' }, 5000).endsInMs, 16 * 60_000);

  const eta = estimateScanEta({
    total: 100, scanned: 50, now: 51_000, scanStart: 1000,
    candidateCount: 10, priced: 5, candidateMs: 16_000, candidateOps: 2,
    warmupBudget: 20, warmedChecked: 10, warmupQueueLength: 20, warmupIndex: 10,
    warmMs: 9000, warmOps: 2,
  });
  assert.strictEqual(eta, 165_000, 'ETA reports the slower measured browser lane');
  console.log('runtime-policy selftest: all assertions passed');
}
