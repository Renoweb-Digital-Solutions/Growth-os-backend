const assert = require('assert');
const {
  validateAndNormalizeDateRange,
  calculateComparisonDateRange,
  resolveTrendGranularity,
  getGA4YearWeek,
  generateTrendBuckets,
  formatTrendPointsWithBuckets,
} = require('../services/googleAnalyticsDataService');

const parseDateStr = (str) => {
  const [year, month, day] = str.split('-').map(Number);
  return { year, month, day };
};

console.log('--- RUNNING ALL 18 GA4 PRESET TREND GRANULARITY INTEGRATION TESTS ---');

const presetsToTest = [
  { preset: '24H', expectedGranularity: 'hour' },
  { preset: '7D', expectedGranularity: 'day' },
  { preset: '28D', expectedGranularity: 'day' },
  { preset: '90D', expectedGranularity: 'week' },
  { preset: 'Today', expectedGranularity: 'day' },
  { preset: 'Yesterday', expectedGranularity: 'day' },
  { preset: 'This week', expectedGranularity: 'day' },
  { preset: 'Last week', expectedGranularity: 'day' },
  { preset: 'Last 7 days', expectedGranularity: 'day' },
  { preset: 'Last 28 days', expectedGranularity: 'day' },
  { preset: 'Last 30 days', expectedGranularity: 'day' },
  { preset: 'This month', expectedGranularity: 'day' },
  { preset: 'Last month', expectedGranularity: 'day' },
  { preset: 'Last 90 days', expectedGranularity: 'week' },
  { preset: 'Quarter to date', expectedGranularity: 'day' }, // QTD tested for short range; also test long QTD
  { preset: 'This year', expectedGranularity: 'month' },
  { preset: 'Last calendar year', expectedGranularity: 'month' },
];

presetsToTest.forEach(({ preset }) => {
  const normalized = validateAndNormalizeDateRange(null, null, preset, 'America/New_York');
  const granularity = resolveTrendGranularity(normalized.preset, normalized.startDateStr, normalized.endDateStr);

  const startParts = parseDateStr(normalized.startDateStr);
  const endParts = parseDateStr(normalized.endDateStr);
  const startUtc = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day));
  const endUtc = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day));
  const days = Math.round((endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  let expectedGranularity = 'day';
  if (normalized.preset === '24H') {
    expectedGranularity = 'hour';
  } else if (normalized.preset === 'This year' || normalized.preset === 'Last calendar year') {
    expectedGranularity = 'month';
  } else if (days > 30) {
    expectedGranularity = 'week';
  }

  assert.strictEqual(granularity, expectedGranularity, `Preset '${preset}' (${days} days) must resolve to '${expectedGranularity}', got '${granularity}'`);

  const buckets = generateTrendBuckets(
    normalized.startDateStr,
    normalized.endDateStr,
    granularity,
    true,
    'previous_period'
  );

  assert.ok(buckets.currentBuckets.length > 0, `Preset '${preset}' current buckets must not be empty`);
  assert.strictEqual(
    buckets.currentBuckets.length,
    buckets.previousBuckets.length,
    `Preset '${preset}' current (${buckets.currentBuckets.length}) and previous (${buckets.previousBuckets.length}) bucket counts must match`
  );

  console.log(`✓ Preset '${preset}' passed (${days} days) -> Granularity: ${granularity} | Current buckets: ${buckets.currentBuckets.length} | Prev buckets: ${buckets.previousBuckets.length}`);
});

// Explicit Granularity Threshold Tests (<=30 days -> day, >30 days -> week)
console.log('\n--- TESTING 30-DAY THRESHOLD EXPLICIT GRANULARITY TESTS ---');

// Last month 30-day case (e.g. September 2026: 2026-09-01 to 2026-09-30 = 30 days)
const lastMonth30Gran = resolveTrendGranularity('Last month', '2026-09-01', '2026-09-30');
assert.strictEqual(lastMonth30Gran, 'day', 'Last month with 30 days must be day');
console.log('✓ Last month with 30 days -> day');

// Last month 31-day case (e.g. August 2026: 2026-08-01 to 2026-08-31 = 31 days)
const lastMonth31Gran = resolveTrendGranularity('Last month', '2026-08-01', '2026-08-31');
assert.strictEqual(lastMonth31Gran, 'week', 'Last month with 31 days must be week');
console.log('✓ Last month with 31 days -> week');

// Custom 30-day range
const custom30Gran = resolveTrendGranularity('Custom', '2026-09-01', '2026-09-30');
assert.strictEqual(custom30Gran, 'day', 'Custom 30-day range must be day');
console.log('✓ Custom 30-day range -> day');

// Custom 31-day range
const custom31Gran = resolveTrendGranularity('Custom', '2026-08-01', '2026-08-31');
assert.strictEqual(custom31Gran, 'week', 'Custom 31-day range must be week');
console.log('✓ Custom 31-day range -> week');

// Custom 45-day range
const custom45Gran = resolveTrendGranularity('Custom', '2026-08-01', '2026-09-14');
assert.strictEqual(custom45Gran, 'week', 'Custom 45-day range must be week');
console.log('✓ Custom 45-day range -> week');

// Custom 60-day range
const custom60Gran = resolveTrendGranularity('Custom', '2026-08-01', '2026-09-29');
assert.strictEqual(custom60Gran, 'week', 'Custom 60-day range must be week');
console.log('✓ Custom 60-day range -> week');

// 90D range (90 days)
const range90Gran = resolveTrendGranularity('90D', '2026-07-07', '2026-10-04');
assert.strictEqual(range90Gran, 'week', '90D range must be week');
console.log('✓ 90D range -> week');

// 120D range (120 days)
const range120Gran = resolveTrendGranularity('Custom', '2026-06-01', '2026-09-28');
assert.strictEqual(range120Gran, 'week', '120D range must be week');
console.log('✓ 120D range -> week');

// QTD <= 30 days (4 days)
const qtdShortGran = resolveTrendGranularity('Quarter to date', '2026-10-01', '2026-10-04');
assert.strictEqual(qtdShortGran, 'day', 'QTD <= 30 days must be day');
console.log('✓ QTD <= 30 days -> day');

// QTD > 30 days (60 days)
const qtdLongGran = resolveTrendGranularity('Quarter to date', '2026-10-01', '2026-11-29');
assert.strictEqual(qtdLongGran, 'week', 'QTD > 30 days must be week');
console.log('✓ QTD > 30 days -> week');

console.log('\n==================================================');
console.log('ALL 18 PRESET & THRESHOLD INTEGRATION TESTS PASSED!');
console.log('==================================================');
