const mongoose = require('mongoose');
require('dotenv').config();

const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const googleService = require('../services/googleSearchConsoleService');
const { fetchGA4DataApi } = require('../services/googleAnalyticsDataService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/renoweb-growth-os';

async function testAllFilters() {
  await mongoose.connect(MONGODB_URI);
  const activeProperty = await GoogleAnalyticsProperty.findOne({ isActive: true });
  const userId = activeProperty.userId;
  const propertyId = activeProperty.propertyId;
  const accessToken = await googleService.getValidAccessToken(userId);

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

  // Test 1: Standard request with engagedSessions
  const req1 = {
    dateRanges: [{ startDate: '2026-09-08', endDate: '2026-10-05' }],
    dimensions: [{ name: 'sessionPrimaryChannelGroup' }],
    metrics: [{ name: 'engagedSessions' }],
    metricAggregations: ['TOTAL'],
  };

  const res1 = await fetchGA4DataApi(url, accessToken, {
    method: 'POST',
    body: JSON.stringify(req1)
  });

  console.log('=== TEST 1: engagedSessions raw API ===');
  console.log('Totals:', JSON.stringify(res1.totals));
  console.log('Rows:', res1.rows.map(r => `${r.dimensionValues[0].value}: ${r.metricValues[0].value}`));

  // Test 2: Standard request with sessions
  const req2 = {
    dateRanges: [{ startDate: '2026-09-08', endDate: '2026-10-05' }],
    dimensions: [{ name: 'sessionPrimaryChannelGroup' }],
    metrics: [{ name: 'sessions' }],
    metricAggregations: ['TOTAL'],
  };

  const res2 = await fetchGA4DataApi(url, accessToken, {
    method: 'POST',
    body: JSON.stringify(req2)
  });

  console.log('\n=== TEST 2: sessions raw API ===');
  console.log('Totals:', JSON.stringify(res2.totals));
  console.log('Rows:', res2.rows.map(r => `${r.dimensionValues[0].value}: ${r.metricValues[0].value}`));

  // Test 3: Both metrics together
  const req3 = {
    dateRanges: [{ startDate: '2026-09-08', endDate: '2026-10-05' }],
    dimensions: [{ name: 'sessionPrimaryChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'engagementRate' }],
    metricAggregations: ['TOTAL'],
  };

  const res3 = await fetchGA4DataApi(url, accessToken, {
    method: 'POST',
    body: JSON.stringify(req3)
  });

  console.log('\n=== TEST 3: Both metrics raw API ===');
  console.log('Totals:', JSON.stringify(res3.totals));
  res3.rows.forEach(r => {
    const channel = r.dimensionValues[0].value;
    const sess = r.metricValues[0].value;
    const engSess = r.metricValues[1].value;
    const rate = r.metricValues[2].value;
    console.log(`Channel: ${channel.padEnd(16)} | sessions: ${sess.padStart(4)} | engagedSessions: ${engSess.padStart(4)} | engagementRate: ${(parseFloat(rate)*100).toFixed(1)}%`);
  });

  await mongoose.disconnect();
}

testAllFilters().catch(console.error);
