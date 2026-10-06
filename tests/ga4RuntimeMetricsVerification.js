/**
 * Comprehensive verification script for GA4 Overview Performance Trend QTD & All 13 Supported Trend Metrics.
 * Verifies date range resolution, comparison period, granularity, bucket alignment, and metric-specific payload formatting.
 */

const {
  ALLOWED_KPI_METRICS,
  validateAndNormalizeDateRange,
  calculateComparisonDateRange,
  resolveTrendGranularity,
  generateTrendBuckets,
  formatTrendPointsWithBuckets,
  formatMetricValue,
} = require('../services/googleAnalyticsDataService');

const assert = require('assert');

console.log('==================================================');
console.log('--- GA4 PERFORMANCE TREND ALL-METRICS QTD VERIFICATION ---');
console.log('==================================================\n');

// 1. All 13 supported canonical metrics list
const SUPPORTED_TREND_METRICS = [
  'activeUsers',
  'totalUsers',
  'newUsers',
  'sessions',
  'engagedSessions',
  'engagementRate',
  'bounceRate',
  'eventCount',
  'keyEvents',
  'screenPageViews',
  'screenPageViewsPerUser',
  'averageEngagementTimePerActiveUser',
  'firstVisits',
];

// Verify registry contains all 13 metrics
SUPPORTED_TREND_METRICS.forEach((m) => {
  assert(ALLOWED_KPI_METRICS[m], `Metric '${m}' must exist in ALLOWED_KPI_METRICS registry`);
});

console.log(`✓ Confirmed all ${SUPPORTED_TREND_METRICS.length} trend metrics are present in registry.\n`);

// 2. Test QTD date normalization under 3 request scenarios:
// Scenario A: Request with rangePreset="Quarter to date" and no explicit dates
// Scenario B: Request with rangePreset="qtd" and explicit frontend params startDate="2026-10-01" & endDate="2026-10-05" (today's date)
// Scenario C: Request with rangePreset="Quarter to date" and frontend params startDate="2026-10-01" & endDate="2026-10-05"

const mockTimeZone = 'UTC'; // Current simulated date is 2026-10-05

console.log('--- TESTING QTD DATE RESOLUTION ACROSS INCOMING QUERY PATTERNS ---');

const scenarios = [
  { name: 'Default QTD (No explicit dates)', startDate: null, endDate: null, preset: 'Quarter to date' },
  { name: 'Frontend QTD with endDate=2026-10-05 (today)', startDate: '2026-10-01', endDate: '2026-10-05', preset: 'qtd' },
  { name: 'Frontend Quarter to date with endDate=2026-10-05', startDate: '2026-10-01', endDate: '2026-10-05', preset: 'Quarter to date' },
];

scenarios.forEach((sc) => {
  const norm = validateAndNormalizeDateRange(sc.startDate, sc.endDate, sc.preset, mockTimeZone);
  assert.strictEqual(norm.startDateStr, '2026-10-01', `${sc.name}: startDateStr must be 2026-10-01`);
  assert.strictEqual(norm.endDateStr, '2026-10-04', `${sc.name}: endDateStr must be capped at yesterday (2026-10-04)`);
  console.log(`✓ ${sc.name} -> Resolved Range: ${norm.startDateStr} to ${norm.endDateStr} (Preset: ${norm.preset})`);
});

console.log('\n--- VERIFYING ALL 13 METRICS FOR DEFAULT QTD TREND EXECUTION ---\n');

// Mock data generator for each specific metric to ensure values are distinct and not hardcoded to activeUsers
const generateMockGA4RowsForMetric = (metricKey, buckets) => {
  const metricConfig = ALLOWED_KPI_METRICS[metricKey];
  const type = metricConfig.type;

  // Generate distinct synthetic values based on metric name index
  const baseMultiplier = SUPPORTED_TREND_METRICS.indexOf(metricKey) + 1;

  const rows = buckets.map((b, idx) => {
    let numVal = (idx + 1) * 10 * baseMultiplier;
    if (type === 'PERCENTAGE') {
      numVal = Number((0.25 + idx * 0.05).toFixed(4));
    } else if (type === 'FLOAT') {
      numVal = Number((1.5 + idx * 0.2).toFixed(4));
    } else if (type === 'DURATION') {
      numVal = Number((45.5 + idx * 5.0).toFixed(4));
    }

    return {
      dimensionValues: [b.key],
      metricValues: [numVal],
    };
  });

  return { rows };
};

const normQTD = validateAndNormalizeDateRange(null, null, 'Quarter to date', mockTimeZone);
const compRange = calculateComparisonDateRange(normQTD.startDateStr, normQTD.endDateStr, 'previous_period');
const granularity = resolveTrendGranularity(normQTD.preset, normQTD.startDateStr, normQTD.endDateStr);

const { currentBuckets, previousBuckets, currentReportRange, previousReportRange } = generateTrendBuckets(
  normQTD.startDateStr,
  normQTD.endDateStr,
  granularity,
  true,
  'previous_period'
);

// Assert shared date resolution parameters
assert.strictEqual(normQTD.startDateStr, '2026-10-01', 'Current start date must be 2026-10-01');
assert.strictEqual(normQTD.endDateStr, '2026-10-04', 'Current end date must be 2026-10-04');
assert.strictEqual(compRange.compStartDateStr, '2026-09-27', 'Previous start date must be 2026-09-27');
assert.strictEqual(compRange.compEndDateStr, '2026-09-30', 'Previous end date must be 2026-09-30');
assert.strictEqual(granularity, 'day', 'QTD <= 30 days granularity must be day');
assert.strictEqual(currentBuckets.length, 4, 'Current buckets count must be exactly 4');
assert.strictEqual(previousBuckets.length, 4, 'Previous buckets count must be exactly 4');

// Verify Oct 5 does NOT exist in current buckets
const hasOct5 = currentBuckets.some((b) => b.date === '2026-10-05' || b.key === '20261005');
assert.strictEqual(hasOct5, false, 'No Oct 5 bucket must exist in QTD current period');

// Iterate over each supported trend metric and print required runtime payload output
const verificationResults = [];

SUPPORTED_TREND_METRICS.forEach((metricKey) => {
  const config = ALLOWED_KPI_METRICS[metricKey];

  const currentMockReport = generateMockGA4RowsForMetric(metricKey, currentBuckets);
  const previousMockReport = generateMockGA4RowsForMetric(metricKey, previousBuckets);

  const currentPoints = formatTrendPointsWithBuckets(currentMockReport, currentBuckets, config.key, config.type);
  const previousPoints = formatTrendPointsWithBuckets(previousMockReport, previousBuckets, config.key, config.type);

  // Assertions for each metric
  assert.strictEqual(currentPoints.length, 4, `Metric ${metricKey}: current points length must be 4`);
  assert.strictEqual(previousPoints.length, 4, `Metric ${metricKey}: previous points length must be 4`);

  // Verify dates are correct
  assert.strictEqual(currentPoints[0].date, '2026-10-01');
  assert.strictEqual(currentPoints[3].date, '2026-10-04');
  assert.strictEqual(previousPoints[0].date, '2026-09-27');
  assert.strictEqual(previousPoints[3].date, '2026-09-30');

  // Verify point has metric-specific key and value
  currentPoints.forEach((pt) => {
    assert(pt[config.key] !== undefined, `Point must contain metric property '${config.key}'`);
    assert.strictEqual(typeof pt.value, 'number', 'Point value must be numeric');
  });

  const resultLog = {
    metric: metricKey,
    gaMetricName: config.gaMetric.name,
    type: config.type,
    currentRange: `${currentReportRange.startDate} -> ${currentReportRange.endDate}`,
    previousRange: `${previousReportRange.startDate} -> ${previousReportRange.endDate}`,
    granularity,
    currentBucketCount: currentPoints.length,
    previousBucketCount: previousPoints.length,
    firstCurrentBucket: `${currentPoints[0].date} (${currentPoints[0].label}) = ${currentPoints[0].value}`,
    lastCurrentBucket: `${currentPoints[3].date} (${currentPoints[3].label}) = ${currentPoints[3].value}`,
    firstPreviousBucket: `${previousPoints[0].date} (${previousPoints[0].label}) = ${previousPoints[0].value}`,
    lastPreviousBucket: `${previousPoints[3].date} (${previousPoints[3].label}) = ${previousPoints[3].value}`,
  };

  verificationResults.push(resultLog);

  console.log(`metric: ${resultLog.metric}`);
  console.log(`currentRange: ${resultLog.currentRange}`);
  console.log(`previousRange: ${resultLog.previousRange}`);
  console.log(`granularity: ${resultLog.granularity}`);
  console.log(`currentBucketCount: ${resultLog.currentBucketCount}`);
  console.log(`previousBucketCount: ${resultLog.previousBucketCount}`);
  console.log(`firstCurrentBucket: ${resultLog.firstCurrentBucket}`);
  console.log(`lastCurrentBucket: ${resultLog.lastCurrentBucket}`);
  console.log(`firstPreviousBucket: ${resultLog.firstPreviousBucket}`);
  console.log(`lastPreviousBucket: ${resultLog.lastPreviousBucket}`);
  console.log('--------------------------------------------------');
});

console.log('\n--- VERIFYING ALL PRESET GRANULARITY RULES ---\n');

const granularityRules = [
  { preset: '7D', expected: 'day' },
  { preset: '28D', expected: 'day' },
  { preset: 'Last 30 days', expected: 'day' },
  { preset: '31D (custom)', startDate: '2026-09-01', endDate: '2026-10-01', expected: 'week' },
  { preset: '90D', expected: 'week' },
  { preset: '120D (custom)', startDate: '2026-06-01', endDate: '2026-09-28', expected: 'week' },
  { preset: 'This year', expected: 'month' },
  { preset: 'Last calendar year', expected: 'month' },
];

granularityRules.forEach((rule) => {
  let startStr, endStr;
  if (rule.startDate && rule.endDate) {
    startStr = rule.startDate;
    endStr = rule.endDate;
  } else {
    const norm = validateAndNormalizeDateRange(null, null, rule.preset, mockTimeZone);
    startStr = norm.startDateStr;
    endStr = norm.endDateStr;
  }

  const gran = resolveTrendGranularity(rule.preset, startStr, endStr);
  assert.strictEqual(gran, rule.expected, `Granularity for ${rule.preset} must be ${rule.expected}`);
  console.log(`✓ ${rule.preset} (${startStr} to ${endStr}) -> granularity: ${gran}`);
});

console.log('\n==================================================');
console.log('ALL 13 TREND METRIC QTD RUNTIME VERIFICATIONS PASSED SUCCESSFULLY!');
console.log('==================================================\n');
