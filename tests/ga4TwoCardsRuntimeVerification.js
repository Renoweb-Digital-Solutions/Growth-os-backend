/**
 * Fast Live GA4 Data API Runtime Verification Script for:
 * 1. Key events by Platform (key-events-by-platform)
 * 2. New users by First user primary channel group (new-users-by-channel)
 *
 * Connects to MongoDB, resolves active GA4 property (518756690 / Renowebhq),
 * and executes real queries against Google Analytics Data API.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const { fetchSingleSuggestedCardData } = require('../services/googleAnalyticsDataService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/renoweb-growth-os';

async function runRuntimeVerification() {
  console.log('==================================================');
  console.log('--- GA4 TWO CARDS LIVE RUNTIME VERIFICATION ---');
  console.log('==================================================\n');

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[DB] Connected to MongoDB.');

    const activeProperty = await GoogleAnalyticsProperty.findOne({ isActive: true });
    if (!activeProperty) {
      console.error('[ERROR] No active GA4 property found in database.');
      process.exit(1);
    }

    const userId = activeProperty.userId;
    console.log(`[GA4] Active Property ID: ${activeProperty.propertyId} (${activeProperty.propertyName || activeProperty.displayName})`);
    console.log(`[GA4] Owner User ID: ${userId}\n`);

    // ----------------------------------------------------
    // CARD 1: Key events by Platform (All 3 Metrics)
    // ----------------------------------------------------
    console.log('--------------------------------------------------');
    console.log('CARD 1: Key events by Platform');
    console.log('--------------------------------------------------');

    const card1Metrics = ['keyEvents', 'totalRevenue', 'eventCount'];
    const card1Presets = ['28D', '90D'];

    for (const metric of card1Metrics) {
      for (const preset of card1Presets) {
        const queryParams = {
          card: 'key-events-by-platform',
          metric,
          dimension: 'platform',
          preset,
        };

        const result = await fetchSingleSuggestedCardData(userId, { key: 'key-events-by-platform', defaultPreset: '28D' }, queryParams);

        console.log(`CARD: ${result.card}`);
        console.log(`METRIC: ${result.metric} (${result.metricLabel})`);
        console.log(`DIMENSION: ${result.dimension} (${result.dimensionLabel})`);
        console.log(`CURRENT RANGE: ${result.dateRange.startDate} to ${result.dateRange.endDate}`);
        console.log(`PREVIOUS RANGE: ${result.comparison.startDate} to ${result.comparison.endDate}`);
        console.log(`TOTAL: ${result.total} (Previous: ${result.totalComparison ? result.totalComparison.previous : 0}, Change: ${result.totalComparison ? result.totalComparison.changePct : 0}%)`);
        console.log(`TOP ROWS (${result.rows.length}):`);
        if (result.rows.length === 0) {
          console.log('  [No rows returned by GA4 for this window]');
        } else {
          result.rows.forEach((r, idx) => {
            console.log(`  ${idx + 1}. ${r.platform || r.dimensionValue} -> Current: ${r.current} | Previous: ${r.previous} | Change: ${r.changePct !== null ? r.changePct + '%' : 'N/A'}`);
          });
        }
        console.log('');
      }
    }

    // ----------------------------------------------------
    // CARD 2: New users by First user dimension (All 5 Dimensions)
    // ----------------------------------------------------
    console.log('--------------------------------------------------');
    console.log('CARD 2: New users by First user primary channel group');
    console.log('--------------------------------------------------');

    const card2Dimensions = [
      'firstUserPrimaryChannelGroup',
      'firstUserDefaultChannelGroup',
      'firstUserMedium',
      'firstUserCampaignName',
      'firstUserSource',
    ];
    const card2Presets = ['28D', '90D'];

    for (const dimension of card2Dimensions) {
      for (const preset of card2Presets) {
        const queryParams = {
          card: 'new-users-by-channel',
          metric: 'newUsers',
          dimension,
          preset,
        };

        const result = await fetchSingleSuggestedCardData(userId, { key: 'new-users-by-channel', defaultPreset: '28D' }, queryParams);

        console.log(`CARD: ${result.card}`);
        console.log(`METRIC: ${result.metric} (${result.metricLabel})`);
        console.log(`DIMENSION: ${result.dimension} (${result.dimensionLabel})`);
        console.log(`CURRENT RANGE: ${result.dateRange.startDate} to ${result.dateRange.endDate}`);
        console.log(`PREVIOUS RANGE: ${result.comparison.startDate} to ${result.comparison.endDate}`);
        console.log(`TOTAL: ${result.total} (Previous: ${result.totalComparison ? result.totalComparison.previous : 0}, Change: ${result.totalComparison ? result.totalComparison.changePct : 0}%)`);
        console.log(`TOP 8 ROWS (${result.rows.length}):`);
        if (result.rows.length === 0) {
          console.log('  [No rows returned by GA4 for this window]');
        } else {
          result.rows.forEach((r, idx) => {
            console.log(`  ${idx + 1}. ${r.dimensionValue} -> Current: ${r.current} | Previous: ${r.previous} | Change: ${r.changePct !== null ? r.changePct + '%' : 'N/A'}`);
          });
        }
        console.log('');
      }
    }

    console.log('==================================================');
    console.log('LIVE RUNTIME VERIFICATION COMPLETED SUCCESSFULLY!');
    console.log('==================================================');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[RUNTIME VERIFICATION ERROR]', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runRuntimeVerification();
