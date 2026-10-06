const assert = require('assert');
const {
  validateAndNormalizeDateRange,
  resolveTrendGranularity,
  generateTrendBuckets,
} = require('../services/googleAnalyticsDataService');

console.log('--- RUNNING GA4 WEEKLY PREVIOUS-PERIOD ALIGNMENT BUG FIX TESTS ---');

// ============================================================================
// TEST 1: 90D WEEKLY PREVIOUS-PERIOD EXACT INDEX ALIGNMENT (Jul 7 - Oct 4, 2026)
// ============================================================================
console.log('\n[TEST 1] Testing 90D exact weekly index alignment...');

const norm90d = validateAndNormalizeDateRange('2026-07-07', '2026-10-04', '90D', 'UTC');
const gran90d = resolveTrendGranularity(norm90d.preset, norm90d.startDateStr, norm90d.endDateStr);
assert.strictEqual(gran90d, 'week');

const buckets90d = generateTrendBuckets(
  norm90d.startDateStr,
  norm90d.endDateStr,
  gran90d,
  true,
  'previous_period'
);

assert.strictEqual(
  buckets90d.currentBuckets.length,
  buckets90d.previousBuckets.length,
  `Current (${buckets90d.currentBuckets.length}) and previous (${buckets90d.previousBuckets.length}) bucket counts must match`
);

// Map of current labels to expected previous labels based on GA4 reference mapping
const expectedAlignmentMap = {
  'Jul 5 – Jul 11': 'Apr 5 – Apr 11',
  'Jul 12 – Jul 18': 'Apr 12 – Apr 18',
  'Jul 19 – Jul 25': 'Apr 19 – Apr 25',
  'Jul 26 – Aug 1': 'Apr 26 – May 2',
  'Aug 2 – Aug 8': 'May 3 – May 9',
  'Aug 9 – Aug 15': 'May 10 – May 16',
  'Aug 16 – Aug 22': 'May 17 – May 23',
  'Aug 23 – Aug 29': 'May 24 – May 30',
  'Aug 30 – Sep 5': 'May 31 – Jun 6',
  'Sep 6 – Sep 12': 'Jun 7 – Jun 13',
  'Sep 13 – Sep 19': 'Jun 14 – Jun 20',
  'Sep 20 – Sep 26': 'Jun 21 – Jun 27',
  'Sep 27 – Oct 3': 'Jun 28 – Jul 4',
  'Oct 4 – Oct 10': 'Jul 5 – Jul 11',
};

buckets90d.currentBuckets.forEach((cBucket, index) => {
  const pBucket = buckets90d.previousBuckets[index];
  const expectedPrevLabel = expectedAlignmentMap[cBucket.label];

  if (expectedPrevLabel) {
    assert.strictEqual(
      pBucket.label,
      expectedPrevLabel,
      `Current bucket '${cBucket.label}' at index ${index} must pair with '${expectedPrevLabel}', got '${pBucket.label}'`
    );
    console.log(`  ✓ Index ${index}: Current [${cBucket.label}] ↔ Previous [${pBucket.label}] matches reference`);
  }
});


// ============================================================================
// TEST 2: LAST 90 DAYS PRESET ALIGNMENT
// ============================================================================
console.log('\n[TEST 2] Testing Last 90 days preset alignment...');

const normLast90 = validateAndNormalizeDateRange(null, null, 'Last 90 days', 'UTC');
const granLast90 = resolveTrendGranularity(normLast90.preset, normLast90.startDateStr, normLast90.endDateStr);
assert.strictEqual(granLast90, 'week');

const bucketsLast90 = generateTrendBuckets(
  normLast90.startDateStr,
  normLast90.endDateStr,
  granLast90,
  true,
  'previous_period'
);

assert.strictEqual(bucketsLast90.currentBuckets.length, bucketsLast90.previousBuckets.length);

// Verify every bucket is shifted back by exactly 13 weeks (91 days)
bucketsLast90.currentBuckets.forEach((cBucket, i) => {
  const pBucket = bucketsLast90.previousBuckets[i];
  const cSunDate = new Date(`${cBucket.date}T00:00:00Z`);
  const pSunDate = new Date(`${pBucket.date}T00:00:00Z`);
  const diffDays = Math.round((cSunDate.getTime() - pSunDate.getTime()) / (24 * 60 * 60 * 1000));
  assert.strictEqual(diffDays, 91, `Bucket ${i} previous start must be exactly 91 days prior to current start`);
});
console.log(`✓ Last 90 days verified: All ${bucketsLast90.currentBuckets.length} buckets shifted by exactly 91 days (13 weeks)`);


// ============================================================================
// TEST 3: WEEKLY CUSTOM RANGE ALIGNMENT (~92 days)
// ============================================================================
console.log('\n[TEST 3] Testing weekly custom range alignment (92 days)...');

const normCustom = validateAndNormalizeDateRange('2026-06-01', '2026-08-31', 'Custom', 'UTC');
const granCustom = resolveTrendGranularity(normCustom.preset, normCustom.startDateStr, normCustom.endDateStr);
assert.strictEqual(granCustom, 'week');

const bucketsCustom = generateTrendBuckets(
  normCustom.startDateStr,
  normCustom.endDateStr,
  granCustom,
  true,
  'previous_period'
);

assert.strictEqual(bucketsCustom.currentBuckets.length, bucketsCustom.previousBuckets.length);

bucketsCustom.currentBuckets.forEach((cBucket, i) => {
  const pBucket = bucketsCustom.previousBuckets[i];
  const cSunDate = new Date(`${cBucket.date}T00:00:00Z`);
  const pSunDate = new Date(`${pBucket.date}T00:00:00Z`);
  const diffDays = Math.round((cSunDate.getTime() - pSunDate.getTime()) / (24 * 60 * 60 * 1000));
  assert.strictEqual(diffDays, 91, `Custom weekly bucket ${i} previous start must be exactly 91 days prior`);
});
console.log(`✓ Weekly Custom Range verified: All ${bucketsCustom.currentBuckets.length} buckets shifted by exactly 91 days`);


// ============================================================================
// TEST 4: QUARTER TO DATE / LONG RANGE (WHEN RESOLVED TO WEEKLY)
// ============================================================================
console.log('\n[TEST 4] Testing Quarter to Date / long range when resolved to weekly...');

// Custom / QTD range spanning 151 days => week
const normQtd = validateAndNormalizeDateRange('2026-01-01', '2026-05-31', 'Custom', 'UTC');
const granQtd = resolveTrendGranularity(normQtd.preset, normQtd.startDateStr, normQtd.endDateStr);
assert.strictEqual(granQtd, 'week');

const bucketsQtd = generateTrendBuckets(
  normQtd.startDateStr,
  normQtd.endDateStr,
  granQtd,
  true,
  'previous_period'
);

assert.strictEqual(bucketsQtd.currentBuckets.length, bucketsQtd.previousBuckets.length);
console.log(`✓ Weekly QTD / long range verified: Current and previous bucket count = ${bucketsQtd.currentBuckets.length}`);

console.log('\n==================================================');
console.log('ALL GA4 WEEKLY ALIGNMENT TESTS PASSED SUCCESSFULLY!');
console.log('==================================================');
