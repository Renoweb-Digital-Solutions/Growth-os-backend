const mongoose = require('mongoose');
require('dotenv').config();

const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const googleService = require('../services/googleSearchConsoleService');
const { runGA4Report } = require('../services/googleAnalyticsDataService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/renoweb-growth-os';

async function findMatch() {
  await mongoose.connect(MONGODB_URI);
  const activeProperty = await GoogleAnalyticsProperty.findOne({ isActive: true });
  const userId = activeProperty.userId;
  const propertyId = activeProperty.propertyId;
  const accessToken = await googleService.getValidAccessToken(userId);

  console.log(`Property ID: ${propertyId}, TimeZone: ${activeProperty.timeZone}`);

  // Let's test different date ranges around Sept-Oct 2026
  // e.g. Last 28 days ending today, yesterday, 2 days ago, 3 days ago... or 30 days... or different metrics!
  const today = new Date('2026-10-06');

  for (let offset = 0; offset <= 30; offset++) {
    const end = new Date(today);
    end.setDate(end.getDate() - offset);
    const start = new Date(end);
    start.setDate(start.getDate() - 27);

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    // Query engagedSessions + sessionPrimaryChannelGroup
    const resEngaged = await runGA4Report({
      accessToken,
      propertyId,
      dateRanges: [{ startDate: startStr, endDate: endStr }],
      dimensions: ['sessionPrimaryChannelGroup'],
      metrics: ['engagedSessions'],
      limit: 10,
      skipCache: true
    });

    // Query sessions + sessionPrimaryChannelGroup
    const resSessions = await runGA4Report({
      accessToken,
      propertyId,
      dateRanges: [{ startDate: startStr, endDate: endStr }],
      dimensions: ['sessionPrimaryChannelGroup'],
      metrics: ['sessions'],
      limit: 10,
      skipCache: true
    });

    const directEngaged = resEngaged.rows.find(r => r.dimensionValues[0] === 'Direct')?.metricValues[0] || 0;
    const directSessions = resSessions.rows.find(r => r.dimensionValues[0] === 'Direct')?.metricValues[0] || 0;

    console.log(`Offset ${offset} (${startStr} to ${endStr}):`);
    console.log(`  engagedSessions: Total=${resEngaged.totals?.[0] || 'N/A'}, Direct=${directEngaged}, OrganicSearch=${resEngaged.rows.find(r => r.dimensionValues[0] === 'Organic Search')?.metricValues[0] || 0}`);
    console.log(`  sessions:        Total=${resSessions.totals?.[0] || 'N/A'}, Direct=${directSessions}, OrganicSearch=${resSessions.rows.find(r => r.dimensionValues[0] === 'Organic Search')?.metricValues[0] || 0}`);

    if (directEngaged === 161 || directSessions === 161 || resEngaged.totals?.[0] === 271 || resSessions.totals?.[0] === 271) {
      console.log('>>> MATCH FOUND! <<<');
    }
  }

  await mongoose.disconnect();
}

findMatch();
