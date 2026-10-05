/**
 * Deep Forensic Investigation Script
 * GA4 UI vs GA4 Data API metric & dimension analysis for Property 518756690
 */

const mongoose = require('mongoose');
require('dotenv').config();

const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const googleService = require('../services/googleSearchConsoleService');
const { runGA4Report, validateAndNormalizeDateRange } = require('../services/googleAnalyticsDataService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/renoweb-growth-os';

async function deepInvestigation() {
  console.log('==================================================');
  console.log('--- DEEP GA4 FORENSIC INVESTIGATION ---');
  console.log('==================================================\n');

  await mongoose.connect(MONGODB_URI);
  const activeProperty = await GoogleAnalyticsProperty.findOne({ isActive: true });
  const userId = activeProperty.userId;
  const propertyId = activeProperty.propertyId;
  const timeZone = activeProperty.timeZone;
  const accessToken = await googleService.getValidAccessToken(userId);

  console.log(`Property ID: ${propertyId} (${activeProperty.propertyName || activeProperty.displayName})`);
  console.log(`Time Zone: ${timeZone}\n`);

  const datePresets = ['7D', '28D', '90D'];

  for (const preset of datePresets) {
    const { startDateStr, endDateStr } = validateAndNormalizeDateRange(null, null, preset, timeZone);
    console.log(`==================================================`);
    console.log(`DATE PRESET: ${preset} (${startDateStr} to ${endDateStr})`);
    console.log(`==================================================`);

    // Fetch all metrics together on sessionPrimaryChannelGroup
    const multiMetricRes = await runGA4Report({
      accessToken,
      propertyId,
      dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
      dimensions: ['sessionPrimaryChannelGroup'],
      metrics: ['sessions', 'engagedSessions', 'activeUsers', 'totalUsers', 'engagementRate'],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
      skipCache: true
    });

    console.log(`[MULTI-METRIC REPORT FOR sessionPrimaryChannelGroup]`);
    console.log(`Totals Array: ${JSON.stringify(multiMetricRes.totals)}`);
    console.log(`Metric Headers: ${multiMetricRes.metricHeaders.map(h => h.name).join(', ')}`);
    console.log(`Rows:`);
    multiMetricRes.rows.forEach(r => {
      console.log(`  ${r.dimensionValues[0].padEnd(20)} | sessions: ${String(r.metricValues[0]).padStart(4)} | engagedSessions: ${String(r.metricValues[1]).padStart(4)} | activeUsers: ${String(r.metricValues[2]).padStart(4)} | totalUsers: ${String(r.metricValues[3]).padStart(4)} | engagementRate: ${(r.metricValues[4]*100).toFixed(1)}%`);
    });

    console.log('\n');

    // Compare sessionPrimaryChannelGroup vs sessionDefaultChannelGroup vs firstUserPrimaryChannelGroup
    for (const dim of ['sessionPrimaryChannelGroup', 'sessionDefaultChannelGroup', 'firstUserPrimaryChannelGroup', 'firstUserDefaultChannelGroup']) {
      const dimRes = await runGA4Report({
        accessToken,
        propertyId,
        dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
        dimensions: [dim],
        metrics: ['sessions', 'engagedSessions', 'activeUsers'],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
        skipCache: true
      });
      console.log(`Dimension [${dim}] Totals: sessions=${dimRes.totals?.[0]}, engagedSessions=${dimRes.totals?.[1]}, activeUsers=${dimRes.totals?.[2]}`);
    }

    console.log('\n');
  }

  await mongoose.disconnect();
  process.exit(0);
}

deepInvestigation().catch(err => {
  console.error('Deep investigation error:', err);
  mongoose.disconnect();
  process.exit(1);
});
