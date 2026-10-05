/**
 * Integration Test Suite for GA4 Cards:
 * 1. Key events by Platform (key-events-by-platform)
 * 2. New users by First user primary channel group (new-users-by-channel)
 */

const assert = require('assert');
const {
  SUGGESTED_CARDS_REGISTRY,
  resolvePlatformMetricConfig,
  resolvePlatformDimensionConfig,
  resolveNewUsersMetricConfig,
  resolveNewUsersDimensionConfig,
  validateAndNormalizeDateRange,
  calculateComparisonDateRange,
  calculateMetricComparison,
} = require('../services/googleAnalyticsDataService');

console.log('==================================================');
console.log('--- GA4 TWO CARDS INTEGRATION TESTS ---');
console.log('==================================================\n');

// ----------------------------------------------------
// TEST 1: CARD 1 (Key events by Platform) MAPPINGS & VALIDATION
// ----------------------------------------------------
console.log('[TEST 1] Testing Card 1 (Key events by Platform) Mappings & Validation...');

// Test Metrics
const keyEventsMetric = resolvePlatformMetricConfig('keyEvents');
assert.strictEqual(keyEventsMetric.gaMetric, 'keyEvents');
assert.strictEqual(keyEventsMetric.label, 'Key events');

const revenueMetric = resolvePlatformMetricConfig('totalRevenue');
assert.strictEqual(revenueMetric.gaMetric, 'totalRevenue');
assert.strictEqual(revenueMetric.label, 'Total revenue');

const eventCountMetric = resolvePlatformMetricConfig('eventCount');
assert.strictEqual(eventCountMetric.gaMetric, 'eventCount');
assert.strictEqual(eventCountMetric.label, 'Event count');

console.log('  ✓ Valid Card 1 metrics mapped correctly: keyEvents, totalRevenue, eventCount');

// Test Invalid Metric
let metricErrCaught = false;
try {
  resolvePlatformMetricConfig('activeUsers');
} catch (err) {
  metricErrCaught = true;
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.code, 'UNSUPPORTED_PLATFORM_METRIC');
}
assert.strictEqual(metricErrCaught, true, 'Should reject invalid platform metric with 400 error');
console.log('  ✓ Invalid Card 1 metric rejected with code UNSUPPORTED_PLATFORM_METRIC');

// Test Dimension
const platformDim = resolvePlatformDimensionConfig('platform');
assert.strictEqual(platformDim.gaDimension, 'platform');
assert.strictEqual(platformDim.label, 'Platform');

let dimErrCaught = false;
try {
  resolvePlatformDimensionConfig('city');
} catch (err) {
  dimErrCaught = true;
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.code, 'UNSUPPORTED_PLATFORM_DIMENSION');
}
assert.strictEqual(dimErrCaught, true, 'Should reject invalid platform dimension with 400 error');
console.log('  ✓ Invalid Card 1 dimension rejected with code UNSUPPORTED_PLATFORM_DIMENSION');


// ----------------------------------------------------
// TEST 2: CARD 2 (New users by First user dimension) MAPPINGS & VALIDATION
// ----------------------------------------------------
console.log('\n[TEST 2] Testing Card 2 (New users by First user dimension) Mappings & Validation...');

// Test Metric (Fixed to newUsers)
const newUsersMetric = resolveNewUsersMetricConfig('newUsers');
assert.strictEqual(newUsersMetric.gaMetric, 'newUsers');

let newUsersMetricErr = false;
try {
  resolveNewUsersMetricConfig('sessions');
} catch (err) {
  newUsersMetricErr = true;
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.code, 'UNSUPPORTED_NEW_USERS_METRIC');
}
assert.strictEqual(newUsersMetricErr, true, 'Should reject invalid metric for New Users card with 400 error');
console.log('  ✓ Metric strictly enforced as newUsers (invalid metric rejected)');

// Test 5 Dimensions
const dim1 = resolveNewUsersDimensionConfig('firstUserPrimaryChannelGroup');
assert.strictEqual(dim1.gaDimension, 'firstUserPrimaryChannelGroup');

const dim2 = resolveNewUsersDimensionConfig('firstUserDefaultChannelGroup');
assert.strictEqual(dim2.gaDimension, 'firstUserDefaultChannelGroup');

const dim3 = resolveNewUsersDimensionConfig('firstUserMedium');
assert.strictEqual(dim3.gaDimension, 'firstUserMedium');

const dim4 = resolveNewUsersDimensionConfig('firstUserCampaignName');
assert.strictEqual(dim4.gaDimension, 'firstUserCampaignName');

const dim5 = resolveNewUsersDimensionConfig('firstUserSource');
assert.strictEqual(dim5.gaDimension, 'firstUserSource');

console.log('  ✓ All 5 First-User dimensions mapped correctly:');
console.log('    1. firstUserPrimaryChannelGroup');
console.log('    2. firstUserDefaultChannelGroup');
console.log('    3. firstUserMedium');
console.log('    4. firstUserCampaignName');
console.log('    5. firstUserSource');

// Verify NOT mapped to session-scoped dimensions
assert.notStrictEqual(dim1.gaDimension, 'sessionPrimaryChannelGroup');
assert.notStrictEqual(dim3.gaDimension, 'sessionMedium');
assert.notStrictEqual(dim4.gaDimension, 'sessionCampaignName');
assert.notStrictEqual(dim5.gaDimension, 'sessionSource');
console.log('  ✓ Verified NO mapping to session-scoped dimensions (sessionPrimaryChannelGroup, etc.)');

// Test Invalid Dimension
let newUsersDimErr = false;
try {
  resolveNewUsersDimensionConfig('sessionSource');
} catch (err) {
  newUsersDimErr = true;
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.code, 'UNSUPPORTED_FIRST_USER_DIMENSION');
}
assert.strictEqual(newUsersDimErr, true, 'Should reject session-scoped dimension with 400 error');
console.log('  ✓ Unsupported dimension rejected with code UNSUPPORTED_FIRST_USER_DIMENSION');


// ----------------------------------------------------
// TEST 3: DATE PRESET AUDIT (ALL 18 PRESETS)
// ----------------------------------------------------
console.log('\n[TEST 3] Auditing All 18 Supported Date Presets for Both Cards...');

const presetsToTest = [
  '24H',
  '7D',
  '28D',
  '90D',
  'Today',
  'Yesterday',
  'This week',
  'Last 7 days',
  'Last week',
  'Last 28 days',
  'Last 30 days',
  'This month',
  'Last month',
  'Last 90 days',
  'Quarter to date',
  'This year',
  'Last calendar year',
  'Custom',
];

const timeZone = 'UTC';

presetsToTest.forEach((presetKey) => {
  let startDate = null;
  let endDate = null;
  if (presetKey === 'Custom') {
    startDate = '2026-09-01';
    endDate = '2026-09-14';
  }

  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(startDate, endDate, presetKey, timeZone);
  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(startDateStr, endDateStr, 'previous_period');

  const currDays = (new Date(endDateStr) - new Date(startDateStr)) / (1000 * 60 * 60 * 24) + 1;
  const compDays = (new Date(compEndDateStr) - new Date(compStartDateStr)) / (1000 * 60 * 60 * 24) + 1;

  assert.strictEqual(currDays, compDays, `Preset ${presetKey} must have equal current and comparison window lengths`);
  console.log(`  ✓ Preset '${presetKey}' -> Current: ${startDateStr} to ${endDateStr} (${currDays}d) | Previous: ${compStartDateStr} to ${compEndDateStr} (${compDays}d)`);
});


// ----------------------------------------------------
// TEST 4: COMPARISON MATH
// ----------------------------------------------------
console.log('\n[TEST 4] Testing Comparison Math...');

const compResult1 = calculateMetricComparison(150, 100, 'INTEGER');
assert.strictEqual(compResult1.changePct, 50);
assert.strictEqual(compResult1.comparisonStatus, 'CALCULATED');

const compResult2 = calculateMetricComparison(50, 100, 'INTEGER');
assert.strictEqual(compResult2.changePct, -50);
assert.strictEqual(compResult2.comparisonStatus, 'CALCULATED');

const compResult3 = calculateMetricComparison(50, 0, 'INTEGER');
assert.strictEqual(compResult3.changePct, null);
assert.strictEqual(compResult3.comparisonStatus, 'NO_PREVIOUS_BASE');

console.log('  ✓ Comparison percentage and status calculated correctly');

console.log('\n==================================================');
console.log('ALL GA4 TWO CARDS INTEGRATION TESTS PASSED!');
console.log('==================================================\n');
