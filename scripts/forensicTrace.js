/**
 * Forensic Trace Script for GA4 Acquisition Data Mismatch & Date Range Verification
 */

const mongoose = require('mongoose');
require('dotenv').config();

const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const googleService = require('../services/googleSearchConsoleService');
const {
  resolveSelectedProperty,
  validateAndNormalizeDateRange,
  calculateComparisonDateRange,
  runGA4Report,
  getTrafficAcquisition
} = require('../services/googleAnalyticsDataService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/renoweb-growth-os';

async function runForensicTrace() {
  console.log('==================================================');
  console.log('--- GA4 FORENSIC TRACE & DATA AUDIT ---');
  console.log('==================================================\n');

  try {
    await mongoose.connect(MONGODB_URI);
    const activeProperty = await GoogleAnalyticsProperty.findOne({ isActive: true });
    
    if (!activeProperty) {
      console.error('No active GA4 property found.');
      process.exit(1);
    }

    const userId = activeProperty.userId;
    const propertyId = activeProperty.propertyId;
    const propertyName = activeProperty.propertyName || activeProperty.displayName;
    const timeZone = activeProperty.timeZone;

    console.log(`[PROPERTY VERIFICATION]`);
    console.log(`Property ID: ${propertyId}`);
    console.log(`Property Name: ${propertyName}`);
    console.log(`Property TimeZone: ${timeZone}\n`);

    const accessToken = await googleService.getValidAccessToken(userId);

    // Test date ranges
    const presetsToTest = ['7D', '28D', '90D'];

    for (const preset of presetsToTest) {
      console.log(`==================================================`);
      console.log(`TESTING PRESET: ${preset}`);
      console.log(`==================================================`);

      const { startDateStr, endDateStr } = validateAndNormalizeDateRange(
        null,
        null,
        preset,
        timeZone
      );

      const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
        startDateStr,
        endDateStr,
        'previous_period'
      );

      // Calculate calendar days
      const d1 = new Date(startDateStr);
      const d2 = new Date(endDateStr);
      const numDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;

      console.log(`[DATE RESOLUTION]`);
      console.log(`Preset: ${preset}`);
      console.log(`Current Start Date: ${startDateStr}`);
      console.log(`Current End Date: ${endDateStr}`);
      console.log(`Calendar Days: ${numDays}`);
      console.log(`Previous Start Date: ${compStartDateStr}`);
      console.log(`Previous End Date: ${compEndDateStr}\n`);

      // PART 1 TRACE: Engaged sessions + sessionPrimaryChannelGroup
      console.log(`[PART 1 TRACE: Engaged Sessions + sessionPrimaryChannelGroup]`);
      
      const ga4ReqBody = {
        propertyId,
        dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
        dimensions: [{ name: 'sessionPrimaryChannelGroup' }],
        metrics: [{ name: 'engagedSessions' }],
        orderBys: [{ metric: { metricName: 'engagedSessions' }, desc: true }],
        limit: 10
      };

      console.log(`GA4 Request Body: ${JSON.stringify(ga4ReqBody, null, 2)}`);

      const rawGa4Response = await runGA4Report({
        accessToken,
        propertyId,
        dateRanges: ga4ReqBody.dateRanges,
        dimensions: ['sessionPrimaryChannelGroup'],
        metrics: ['engagedSessions'],
        orderBys: ga4ReqBody.orderBys,
        limit: 10,
        skipCache: true
      });

      console.log(`Raw GA4 Totals array: ${JSON.stringify(rawGa4Response.totals)}`);
      console.log(`Raw GA4 Row Count: ${rawGa4Response.rowCount}`);
      console.log(`Raw GA4 Rows:`);
      rawGa4Response.rows.forEach(r => {
        console.log(`  ${r.dimensionValues[0]}: ${r.metricValues[0]}`);
      });

      // GrowthOS transformed endpoint call
      const growthosResponse = await getTrafficAcquisition(userId, {
        metric: 'engagedSessions',
        dimension: 'sessionPrimaryChannelGroup',
        rangePreset: preset
      });

      console.log(`\nGrowthOS Transformed Total: ${growthosResponse.data.total}`);
      console.log(`GrowthOS Rows:`);
      growthosResponse.data.rows.forEach(r => {
        console.log(`  ${r.dimensionValue}: ${r.current}`);
      });
      console.log('\n');
    }

    // PART 11 TEST OTHER METRICS
    console.log(`==================================================`);
    console.log(`PART 11: METRIC SWITCH TEST (28D)`);
    console.log(`==================================================`);
    for (const metric of ['sessions', 'engagedSessions']) {
      const res = await getTrafficAcquisition(userId, {
        metric,
        dimension: 'sessionPrimaryChannelGroup',
        rangePreset: '28D'
      });
      console.log(`Metric: ${metric} | Total: ${res.data.total} | Top Rows: ${res.data.rows.slice(0, 3).map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('\n');

    // PART 12 TEST OTHER DIMENSIONS
    console.log(`==================================================`);
    console.log(`PART 12: DIMENSION SWITCH TEST (28D - Engaged Sessions)`);
    console.log(`==================================================`);
    const dimensionsToTest = [
      'sessionPrimaryChannelGroup',
      'sessionDefaultChannelGroup',
      'sessionMedium',
      'sessionCampaignName',
      'sessionSource'
    ];
    for (const dimension of dimensionsToTest) {
      const res = await getTrafficAcquisition(userId, {
        metric: 'engagedSessions',
        dimension,
        rangePreset: '28D'
      });
      console.log(`Dimension: ${dimension} (GA4: ${res.data.gaDimension}) | Total: ${res.data.total} | Top Rows: ${res.data.rows.slice(0, 3).map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Forensic trace failed:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runForensicTrace();
