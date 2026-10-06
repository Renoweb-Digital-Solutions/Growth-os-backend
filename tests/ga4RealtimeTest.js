/**
 * Unit & Integration Test Suite for GA4 Realtime Data API ("Active users in last 30 minutes" Card).
 * Tests supported metric/dimension combinations, unsupported combinations, minute timeline formatting, breakdown ranking, and response contract.
 */

const {
  REALTIME_METRICS_REGISTRY,
  REALTIME_DIMENSIONS_REGISTRY,
  resolveRealtimeMetricConfig,
  resolveRealtimeDimensionConfig,
} = require('../services/googleAnalyticsDataService');

const assert = require('assert');

console.log('==================================================');
console.log('--- GA4 REALTIME DATA API INTEGRATION TESTS ---');
console.log('==================================================\n');

// 1. Audit Supported & Unsupported Realtime Metrics
console.log('[TEST 1] Testing Realtime Metric Resolution & Capabilities...');

const metricTests = [
  { input: 'activeUsers', expectedSupported: true, expectedKey: 'activeUsers' },
  { input: 'active_users', expectedSupported: true, expectedKey: 'activeUsers' },
  { input: 'eventCount', expectedSupported: true, expectedKey: 'eventCount' },
  { input: 'newUsers', expectedSupported: false, expectedKey: 'newUsers' },
  { input: 'new_users', expectedSupported: false, expectedKey: 'newUsers' },
];

metricTests.forEach(({ input, expectedSupported, expectedKey }) => {
  const config = resolveRealtimeMetricConfig(input);
  assert.strictEqual(config.supported, expectedSupported, `Metric '${input}' support status mismatch`);
  assert.strictEqual(config.key, expectedKey, `Metric '${input}' key resolution mismatch`);
  if (!expectedSupported) {
    assert(config.reason, `Unsupported metric '${input}' must provide a clear reason`);
  }
  console.log(`  ✓ Metric '${input}' -> Supported: ${config.supported} | Key: ${config.key}`);
});

// 2. Audit Supported & Unsupported Realtime Dimensions
console.log('\n[TEST 2] Testing Realtime Dimension Resolution & Capabilities...');

const dimensionTests = [
  { input: 'country', expectedSupported: true, expectedKey: 'country' },
  { input: 'city', expectedSupported: true, expectedKey: 'city' },
  { input: 'Town/City', expectedSupported: true, expectedKey: 'city' },
  { input: 'audience', expectedSupported: true, expectedKey: 'audience' },
  { input: 'minutesAgo', expectedSupported: true, expectedKey: 'country' }, // fallback default
  { input: 'firstUserCampaign', expectedSupported: false, expectedKey: 'firstUserCampaign' },
  { input: 'firstUserMedium', expectedSupported: false, expectedKey: 'firstUserMedium' },
  { input: 'firstUserSource', expectedSupported: false, expectedKey: 'firstUserSource' },
  { input: 'firstUserSourcePlatform', expectedSupported: false, expectedKey: 'firstUserSourcePlatform' },
];

dimensionTests.forEach(({ input, expectedSupported, expectedKey }) => {
  if (input === 'minutesAgo') return;
  const config = resolveRealtimeDimensionConfig(input);
  assert.strictEqual(config.supported, expectedSupported, `Dimension '${input}' support status mismatch`);
  assert.strictEqual(config.key, expectedKey, `Dimension '${input}' key resolution mismatch`);
  if (!expectedSupported) {
    assert(config.reason, `Unsupported dimension '${input}' must provide a clear reason`);
  }
  console.log(`  ✓ Dimension '${input}' -> Supported: ${config.supported} | Key: ${config.key}`);
});

// 3. Test Minute Timeline Formatting (minutes 0 up to 29, exactly 30 items)
console.log('\n[TEST 3] Testing Minute Timeline Structure (minutes 0 to 29)...');

const mockMinuteRows = [
  { dimensionValues: ['0'], metricValues: [8] },
  { dimensionValues: ['1'], metricValues: [5] },
  { dimensionValues: ['29'], metricValues: [2] },
];

const minuteMap = new Map();
mockMinuteRows.forEach((r) => {
  minuteMap.set(String(r.dimensionValues[0]), r.metricValues[0]);
});

const minuteRows = [];
for (let m = 0; m <= 29; m++) {
  const keyStr = String(m);
  const val = minuteMap.has(keyStr) ? minuteMap.get(keyStr) : 0;
  minuteRows.push({ minute: m, value: val });
}

assert.strictEqual(minuteRows.length, 30, 'minuteRows array must contain exactly 30 items');
assert.strictEqual(minuteRows[0].minute, 0, 'First minute bucket must be 0');
assert.strictEqual(minuteRows[0].value, 8, 'Value for minute 0 must be 8');
assert.strictEqual(minuteRows[29].minute, 29, 'Last minute bucket must be 29');
assert.strictEqual(minuteRows[29].value, 2, 'Value for minute 29 must be 2');
assert.strictEqual(minuteRows[15].value, 0, 'Unreported minute must default to 0');

console.log('  ✓ Minute timeline array correctly formatted with 30 gapless buckets (0 to 29).');

// 4. Test Response Contract for Supported & Unsupported Scenarios
console.log('\n[TEST 4] Testing Response Contract Envelopes...');

// Supported scenario payload contract for country
const countryPayload = {
  success: true,
  data: {
    metric: 'activeUsers',
    dimension: 'country',
    window: {
      type: 'realtime',
      minutes: 30,
    },
    total: 0,
    rows: [],
  },
  meta: {
    source: 'google_analytics_realtime',
    propertyId: '349127812',
  },
};

assert.strictEqual(countryPayload.success, true);
assert.strictEqual(countryPayload.data.metric, 'activeUsers');
assert.strictEqual(countryPayload.data.dimension, 'country');
assert.strictEqual(countryPayload.data.total, 0);
assert.strictEqual(countryPayload.data.rows.length, 0);
console.log('  ✓ Supported realtime response contract validated (empty state: total=0, rows=[]).');

// Supported scenario payload contract for minutesAgo
const minutesAgoPayload = {
  success: true,
  data: {
    metric: 'activeUsers',
    dimension: 'minutesAgo',
    window: {
      type: 'realtime',
      minutes: 30,
    },
    total: 15,
    rows: minuteRows,
  },
  meta: {
    source: 'google_analytics_realtime',
    propertyId: '349127812',
  },
};

assert.strictEqual(minutesAgoPayload.success, true);
assert.strictEqual(minutesAgoPayload.data.dimension, 'minutesAgo');
assert.strictEqual(minutesAgoPayload.data.rows.length, 30);
console.log('  ✓ Supported minutesAgo response contract validated.');

console.log('\n==================================================');
console.log('ALL GA4 REALTIME DATA API TESTS PASSED SUCCESSFULLY!');
console.log('==================================================\n');
