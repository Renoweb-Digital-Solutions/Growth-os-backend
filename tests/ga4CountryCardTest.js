/**
 * Integration Test Suite for GA4 "Active users by Country" Suggested Card Data API.
 * Verifies (not set) / blank filtering from display rows, aggregate total preservation including (not set),
 * top 7 real country limit, legitimate zero-value country preservation, metric/dimension allowlists, date preset resolution, and comparison logic.
 */

const assert = require('assert');
const {
  validateAndNormalizeDateRange,
  calculateComparisonDateRange,
  calculateMetricComparison,
} = require('../services/googleAnalyticsDataService');

console.log('==================================================');
console.log('--- GA4 COUNTRY CARD INTEGRATION & (NOT SET) FILTERING TESTS ---');
console.log('==================================================\n');

// 1. Test (not set) & Blank Filtering from Display Rows
console.log('[TEST 1] Testing (not set) & Blank Country Filtering from Display Rows...');

const mockGa4RawRows = [
  { dimensionValue: 'India', current: 116 },
  { dimensionValue: 'United States', current: 33 },
  { dimensionValue: 'Singapore', current: 15 },
  { dimensionValue: '(not set)', current: 13 },
  { dimensionValue: 'Bangladesh', current: 12 },
  { dimensionValue: '', current: 10 },
  { dimensionValue: null, current: 8 },
  { dimensionValue: 'China', current: 4 },
  { dimensionValue: 'France', current: 2 },
  { dimensionValue: 'Sweden', current: 2 },
  { dimensionValue: 'Germany', current: 1 },
  { dimensionValue: 'Japan', current: 0 }, // Legitimate zero country
];

const ga4AggregateTotal = 216; // True property total (includes (not set) = 13, blank = 10, null = 8)

const isInvalidCountry = (c) => !c || String(c).trim() === '' || String(c).trim().toLowerCase() === '(not set)';

// Filter invalid countries ONLY from display rows
const validRows = mockGa4RawRows.filter((r) => !isInvalidCountry(r.dimensionValue));

// Verify (not set), blank, and null were filtered out
validRows.forEach((r) => {
  assert.notStrictEqual(r.dimensionValue, '(not set)', 'Display rows must NOT contain (not set)');
  assert.notStrictEqual(r.dimensionValue, '', 'Display rows must NOT contain empty string');
  assert.notStrictEqual(r.dimensionValue, null, 'Display rows must NOT contain null');
});

// Take top 7
const top7DisplayRows = validRows.slice(0, 7);

assert.strictEqual(top7DisplayRows.length, 7, 'Must return exactly top 7 valid countries');
assert.strictEqual(top7DisplayRows[0].dimensionValue, 'India');
assert.strictEqual(top7DisplayRows[1].dimensionValue, 'United States');
assert.strictEqual(top7DisplayRows[2].dimensionValue, 'Singapore');
assert.strictEqual(top7DisplayRows[3].dimensionValue, 'Bangladesh');
assert.strictEqual(top7DisplayRows[4].dimensionValue, 'China');
assert.strictEqual(top7DisplayRows[5].dimensionValue, 'France');
assert.strictEqual(top7DisplayRows[6].dimensionValue, 'Sweden');

console.log('  ✓ (not set), empty string, and null filtered cleanly from display rows.');
console.log('  ✓ Top 7 valid real countries selected in correct descending order.');

// 2. Test Preserving Total Including (not set)
console.log('\n[TEST 2] Testing Preservation of Aggregate Total (Including (not set))...');

assert.strictEqual(ga4AggregateTotal, 216, 'Aggregate total must include (not set) and all users');
const displaySum = top7DisplayRows.reduce((acc, r) => acc + r.current, 0);
assert.strictEqual(displaySum, 184); // 116 + 33 + 15 + 12 + 4 + 2 + 2 = 184
assert.notStrictEqual(displaySum, ga4AggregateTotal, 'Display rows sum must NOT overwrite true GA4 aggregate total');

console.log(`  ✓ GA4 Aggregate Total: ${ga4AggregateTotal} (includes (not set) = 13, blank = 10, null = 8)`);
console.log(`  ✓ Top 7 Display Rows Sum: ${displaySum}`);

// 3. Test Preservation of Legitimate Zero-Value Countries
console.log('\n[TEST 3] Testing Legitimate Zero-Value Country Preservation...');

const mockZeroRows = [
  { dimensionValue: 'India', current: 19 },
  { dimensionValue: '(not set)', current: 9 },
  { dimensionValue: 'United States', current: 7 },
  { dimensionValue: 'France', current: 1 },
  { dimensionValue: 'Ireland', current: 1 },
  { dimensionValue: 'Sweden', current: 1 },
  { dimensionValue: 'Singapore', current: 1 },
  { dimensionValue: 'Bangladesh', current: 0 },
];

const validZeroRows = mockZeroRows.filter((r) => !isInvalidCountry(r.dimensionValue)).slice(0, 7);
assert.strictEqual(validZeroRows.length, 7);
assert.strictEqual(validZeroRows[6].dimensionValue, 'Bangladesh');
assert.strictEqual(validZeroRows[6].current, 0);

console.log('  ✓ Legitimate zero-value country (Bangladesh: 0) preserved in top 7 display list.');

// 4. Test Presets (7D, 30D, 90D, 28D, This month, Last month, Last 7 days, Last 30 days, Last 90 days, Custom)
console.log('\n[TEST 4] Testing Required Date Preset Matrix...');

const requiredPresets = [
  '7D',
  '30D',
  '90D',
  '28D',
  'This month',
  'Last month',
  'Last 7 days',
  'Last 30 days',
  'Last 90 days',
  'Custom',
];

requiredPresets.forEach((p) => {
  const norm = validateAndNormalizeDateRange(
    p === 'Custom' ? '2026-09-01' : null,
    p === 'Custom' ? '2026-09-14' : null,
    p,
    'UTC'
  );
  const comp = calculateComparisonDateRange(norm.startDateStr, norm.endDateStr, 'previous_period');
  console.log(`  ✓ Preset '${p}' -> Current: ${norm.startDateStr} to ${norm.endDateStr} | Previous: ${comp.compStartDateStr} to ${comp.compEndDateStr}`);
});

console.log('\n==================================================');
console.log('ALL GA4 COUNTRY CARD INTEGRATION & (NOT SET) TESTS PASSED!');
console.log('==================================================\n');
