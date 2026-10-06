const assert = require('assert');
const {
  ALLOWED_KPI_METRICS,
  calculateMetricComparison,
  formatMetricValue,
  validateAndNormalizeDateRange,
  calculateComparisonDateRange,
} = require('../services/googleAnalyticsDataService');

console.log('--- STARTING GA4 BACKEND EXTENSION UNIT TESTS ---');

// ============================================================================
// TEST 1: KPI PREVIOUS-PERIOD COMPARISON & ZERO-DENOMINATOR HANDLING
// ============================================================================
console.log('\n[TEST 1] Testing KPI Comparison & Zero-Denominator Handling...');

// Case 1A: Normal comparison (current = 38, previous = 76 => changePct = -50%)
const comp1 = calculateMetricComparison(38, 76, 'INTEGER');
assert.strictEqual(comp1.value, 38);
assert.strictEqual(comp1.previous, 76);
assert.strictEqual(comp1.changePct, -50);
assert.strictEqual(comp1.changeDiff, -38);
assert.strictEqual(comp1.comparisonStatus, 'CALCULATED');
console.log('✓ Case 1A passed: Standard INTEGER comparison (38 vs 76 => -50%)');

// Case 1B: Raw decimal comparison for rate metrics (current = 0.3333, previous = 0.5 => changePct = -33.34%)
const comp2 = calculateMetricComparison(0.3333, 0.5, 'PERCENTAGE');
assert.strictEqual(comp2.value, 0.3333);
assert.strictEqual(comp2.previous, 0.5);
assert.strictEqual(comp2.changePct, -33.34);
assert.strictEqual(comp2.comparisonStatus, 'CALCULATED');
console.log('✓ Case 1B passed: Raw decimal PERCENTAGE comparison (0.3333 vs 0.5 => -33.34%)');

// Case 1C: Zero denominator with current = 0, previous = 0 => changePct = 0, NO_PREVIOUS_BASE
const comp3 = calculateMetricComparison(0, 0, 'INTEGER');
assert.strictEqual(comp3.value, 0);
assert.strictEqual(comp3.previous, 0);
assert.strictEqual(comp3.changePct, 0);
assert.strictEqual(comp3.comparisonStatus, 'NO_PREVIOUS_BASE');
console.log('✓ Case 1C passed: Zero denominator (0 vs 0 => changePct = 0, NO_PREVIOUS_BASE)');

// Case 1D: Zero denominator with current = 15, previous = 0 => changePct = null (NOT Infinity/NaN/100%)
const comp4 = calculateMetricComparison(15, 0, 'INTEGER');
assert.strictEqual(comp4.value, 15);
assert.strictEqual(comp4.previous, 0);
assert.strictEqual(comp4.changePct, null);
assert.notStrictEqual(comp4.changePct, Infinity);
assert.notStrictEqual(comp4.changePct, NaN);
assert.notStrictEqual(comp4.changePct, 100);
assert.strictEqual(comp4.comparisonStatus, 'NO_PREVIOUS_BASE');
console.log('✓ Case 1D passed: Zero denominator (15 vs 0 => changePct = null, NO_PREVIOUS_BASE)');


// ============================================================================
// TEST 2: CANONICAL 13 KPI METRICS REGISTRY VALIDATION
// ============================================================================
console.log('\n[TEST 2] Verifying Canonical 13 GA4 KPI Metrics Registry...');

const expected13Keys = [
  'activeUsers',
  'averageEngagementTimePerActiveUser',
  'engagedSessions',
  'engagementRate',
  'eventCount',
  'keyEvents',
  'newUsers',
  'sessions',
  'screenPageViews',
  'screenPageViewsPerUser',
  'firstVisits',
  'bounceRate',
  'totalUsers',
];

expected13Keys.forEach((key) => {
  const config = ALLOWED_KPI_METRICS[key];
  assert.ok(config, `Metric '${key}' must exist in ALLOWED_KPI_METRICS`);
  assert.strictEqual(config.key, key, `Metric config key must equal canonical key '${key}'`);
});
console.log('✓ Test 2 passed: All 13 canonical KPI metrics exist in registry');


// ============================================================================
// TEST 3: EXPRESSION METRIC (averageEngagementTimePerActiveUser)
// ============================================================================
console.log('\n[TEST 3] Verifying Expression Metric mapping for averageEngagementTimePerActiveUser...');
const avgTimeConfig = ALLOWED_KPI_METRICS['averageEngagementTimePerActiveUser'];
assert.strictEqual(avgTimeConfig.gaMetric.name, 'averageEngagementTimePerUser');
assert.strictEqual(avgTimeConfig.gaMetric.expression, 'userEngagementDuration/activeUsers');
assert.strictEqual(avgTimeConfig.type, 'DURATION');
console.log('✓ Test 3 passed: Expression metric correctly configured with userEngagementDuration/activeUsers');


// ============================================================================
// TEST 4: FIRST VISITS METRIC (firstVisits)
// ============================================================================
console.log('\n[TEST 4] Verifying Special Metric mapping for firstVisits...');
const firstVisitsConfig = ALLOWED_KPI_METRICS['firstVisits'];
assert.strictEqual(firstVisitsConfig.isSpecialFirstVisits, true);
assert.strictEqual(firstVisitsConfig.gaMetric.name, 'eventCount');
assert.strictEqual(firstVisitsConfig.dimensionFilter.filter.fieldName, 'eventName');
assert.strictEqual(firstVisitsConfig.dimensionFilter.filter.stringFilter.value, 'first_visit');
console.log('✓ Test 4 passed: Special firstVisits metric correctly configured with eventName == "first_visit" filter');


// ============================================================================
// TEST 5: DATE RANGE NORMALIZATION & 24H PRESET
// ============================================================================
console.log('\n[TEST 5] Testing Date Range Normalization & Presets (24H, 7D, 28D, 3M)...');

const range24h = validateAndNormalizeDateRange(null, null, '24H', 'UTC');
assert.strictEqual(range24h.preset, '24H');

const range7d = validateAndNormalizeDateRange(null, null, '7D', 'UTC');
assert.strictEqual(range7d.preset, '7D');

const range28d = validateAndNormalizeDateRange(null, null, '28D', 'UTC');
assert.strictEqual(range28d.preset, '28D');

const range3m = validateAndNormalizeDateRange(null, null, '3M', 'UTC');
assert.strictEqual(range3m.preset, '3M');

console.log('✓ Test 5 passed: Preset resolution for 24H, 7D, 28D, 3M validated successfully');


// ============================================================================
// TEST 6: TREND GRANULARITY RESOLUTION ACROSS PRESETS & CUSTOM RANGES
// ============================================================================
console.log('\n[TEST 6] Testing Trend Granularity Resolution (Hour, Day, Week, Month)...');

const {
  resolveTrendGranularity,
  getGA4YearWeek,
  generateTrendBuckets,
  formatTrendPointsWithBuckets,
} = require('../services/googleAnalyticsDataService');

// 24H => hour
assert.strictEqual(resolveTrendGranularity('24H', '2026-10-04', '2026-10-05'), 'hour');

// Short daily ranges => day
assert.strictEqual(resolveTrendGranularity('7D', '2026-09-28', '2026-10-04'), 'day');
assert.strictEqual(resolveTrendGranularity('28D', '2026-09-07', '2026-10-04'), 'day');
assert.strictEqual(resolveTrendGranularity('Today', '2026-10-05', '2026-10-05'), 'day');
assert.strictEqual(resolveTrendGranularity('Yesterday', '2026-10-04', '2026-10-04'), 'day');
assert.strictEqual(resolveTrendGranularity('This week', '2026-10-04', '2026-10-05'), 'day');
assert.strictEqual(resolveTrendGranularity('Last week', '2026-09-27', '2026-10-03'), 'day');
assert.strictEqual(resolveTrendGranularity('This month', '2026-10-01', '2026-10-05'), 'day');
assert.strictEqual(resolveTrendGranularity('Last month', '2026-09-01', '2026-09-30'), 'day');
assert.strictEqual(resolveTrendGranularity('Last 30 days', '2026-09-05', '2026-10-04'), 'day');

// ~90D / 3M => week
assert.strictEqual(resolveTrendGranularity('90D', '2026-07-07', '2026-10-04'), 'week');
assert.strictEqual(resolveTrendGranularity('3M', '2026-07-07', '2026-10-04'), 'week');

// Year-scale => month
assert.strictEqual(resolveTrendGranularity('This year', '2026-01-01', '2026-10-05'), 'month');
assert.strictEqual(resolveTrendGranularity('Last calendar year', '2025-01-01', '2025-12-31'), 'month');

// Quarter to date => dynamic based on resolved duration
assert.strictEqual(resolveTrendGranularity('Quarter to date', '2026-10-01', '2026-10-05'), 'day'); // 5 days => day
assert.strictEqual(resolveTrendGranularity('Quarter to date', '2026-01-01', '2026-05-31'), 'week'); // 151 days => week

// Custom ranges => deterministic by duration
assert.strictEqual(resolveTrendGranularity('Custom', '2026-09-01', '2026-09-10'), 'day'); // 10 days => day
assert.strictEqual(resolveTrendGranularity('Custom', '2026-06-01', '2026-08-31'), 'week'); // 92 days => week
assert.strictEqual(resolveTrendGranularity('Custom', '2025-01-01', '2025-12-31'), 'week'); // >30 days => week

console.log('✓ Test 6 passed: Granularity rules for hour, day, week, month verified for all presets');


// ============================================================================
// TEST 7: SUNDAY-SATURDAY WEEK BOUNDARIES & YEAR-WEEK CALCULATION
// ============================================================================
console.log('\n[TEST 7] Testing Sunday-Saturday Week Boundaries & GA4 yearWeek Keys...');

// Aug 30, 2026 is Sunday
const yearWeekAug30 = getGA4YearWeek(2026, 8, 30);
assert.strictEqual(yearWeekAug30, '202636');

// Dec 28, 2025 is Sunday (belongs to 2026 Week 01 in GA4 because Jan 1 2026 is Thursday)
const yearWeekDec28 = getGA4YearWeek(2025, 12, 28);
assert.strictEqual(yearWeekDec28, '202601');

const weeklyBuckets = generateTrendBuckets('2026-08-30', '2026-11-27', 'week', true, 'previous_period');
assert.strictEqual(weeklyBuckets.trendDimension, 'yearWeek');
assert.strictEqual(weeklyBuckets.currentBuckets.length, 13);
assert.strictEqual(weeklyBuckets.previousBuckets.length, 13);
assert.strictEqual(weeklyBuckets.currentBuckets[0].date, '2026-08-30');
assert.strictEqual(weeklyBuckets.currentBuckets[0].endDate, '2026-09-05');
assert.strictEqual(weeklyBuckets.currentBuckets[0].label, 'Aug 30 – Sep 5');

// Previous period weekly bucket alignment check (May 31 - Jun 6)
assert.strictEqual(weeklyBuckets.previousBuckets[0].date, '2026-05-31');
assert.strictEqual(weeklyBuckets.previousBuckets[0].endDate, '2026-06-06');
assert.strictEqual(weeklyBuckets.previousBuckets[0].label, 'May 31 – Jun 6');

console.log('✓ Test 7 passed: Weekly Sunday-Saturday boundaries and comparison alignment verified');


// ============================================================================
// TEST 8: MONTHLY GRANULARITY & COMPARISON ALIGNMENT
// ============================================================================
console.log('\n[TEST 8] Testing Monthly Granularity & Comparison Alignment...');

const monthlyBuckets = generateTrendBuckets('2026-01-01', '2026-10-05', 'month', true, 'previous_period');
assert.strictEqual(monthlyBuckets.trendDimension, 'yearMonth');
assert.strictEqual(monthlyBuckets.currentBuckets.length, 10);
assert.strictEqual(monthlyBuckets.previousBuckets.length, 10);

assert.strictEqual(monthlyBuckets.currentBuckets[0].label, 'Jan 2026');
assert.strictEqual(monthlyBuckets.currentBuckets[9].label, 'Oct 2026');
assert.strictEqual(monthlyBuckets.previousBuckets[0].label, 'Mar 2025');
assert.strictEqual(monthlyBuckets.previousBuckets[9].label, 'Dec 2025');

console.log('✓ Test 8 passed: Monthly buckets and comparison alignment verified');


// ============================================================================
// TEST 9: TREND POINT FORMATTING WITH BUCKETS
// ============================================================================
console.log('\n[TEST 9] Testing Trend Point Formatting with Buckets...');

const mockReportResult = {
  rows: [
    { dimensionValues: [{ value: '202636' }], metricValues: [1500] },
    { dimensionValues: [{ value: '202637' }], metricValues: [1750] },
  ],
};

const formattedTrend = formatTrendPointsWithBuckets(mockReportResult, weeklyBuckets.currentBuckets, 'activeUsers', 'INTEGER');
assert.strictEqual(formattedTrend.length, 13);
assert.strictEqual(formattedTrend[0].value, 1500);
assert.strictEqual(formattedTrend[0].activeUsers, 1500);
assert.strictEqual(formattedTrend[0].date, '2026-08-30');
assert.strictEqual(formattedTrend[0].endDate, '2026-09-05');
assert.strictEqual(formattedTrend[0].label, 'Aug 30 – Sep 5');

// Missing buckets default to 0 formatted metric
assert.strictEqual(formattedTrend[2].value, 0);
assert.strictEqual(formattedTrend[2].activeUsers, 0);

console.log('✓ Test 9 passed: Trend points properly formatted with structured bucket metadata');

console.log('\n==================================================');
console.log('ALL GA4 BACKEND UNIT TESTS PASSED SUCCESSFULLY!');
console.log('==================================================');

