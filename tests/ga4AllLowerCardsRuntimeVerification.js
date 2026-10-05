/**
 * Live GA4 Data API Master Runtime Verification Script for ALL 8 Lower Cards in GrowthOS:
 *
 * 1. Active users by Country (active-users-by-country)
 * 2. Sessions by Session primary channel group (sessions-by-dimension / traffic acquisition)
 * 3. Active users by First user source / medium (active-users-by-source-medium)
 * 4. Views by Page title and screen class (views-by-page-title)
 * 5. Active users by Town/City (active-users-by-city)
 * 6. Key events by Platform (key-events-by-platform)
 * 7. New users by First user primary channel group (new-users-by-channel)
 * 8. Key events by Event name (key-events-by-event)
 */

const mongoose = require('mongoose');
require('dotenv').config();

const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const {
  fetchSingleSuggestedCardData,
  getTrafficAcquisition,
} = require('../services/googleAnalyticsDataService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/renoweb-growth-os';

async function runMasterRuntimeVerification() {
  console.log('==================================================');
  console.log('--- GA4 ALL LOWER CARDS LIVE RUNTIME VERIFICATION ---');
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

    const datePresetsToTest = ['28D', '90D', 'Custom'];

    // 1. Active users by Country
    console.log('--------------------------------------------------');
    console.log('CARD 1: Active users by Country (active-users-by-country)');
    console.log('--------------------------------------------------');
    for (const preset of datePresetsToTest) {
      const result = await fetchSingleSuggestedCardData(userId, { key: 'active-users-by-country' }, {
        metric: 'activeUsers',
        dimension: 'country',
        preset,
        ...(preset === 'Custom' ? { startDate: '2026-09-01', endDate: '2026-09-14' } : {}),
      });
      console.log(`[${preset}] Total: ${result.total} | Rows (${result.rows.length}): ${result.rows.map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('');

    // 2. Sessions by Session primary channel group
    console.log('--------------------------------------------------');
    console.log('CARD 2: Sessions by Session primary channel group (acquisition)');
    console.log('--------------------------------------------------');
    for (const preset of datePresetsToTest) {
      const result = await getTrafficAcquisition(userId, {
        metric: 'sessions',
        dimension: 'sessionPrimaryChannelGroup',
        rangePreset: preset,
        ...(preset === 'Custom' ? { startDate: '2026-09-01', endDate: '2026-09-14' } : {}),
      });
      console.log(`[${preset}] Total: ${result.data.total} | Rows (${result.data.rows.length}): ${result.data.rows.map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('');

    // 3. Active users by First user source / medium
    console.log('--------------------------------------------------');
    console.log('CARD 3: Active users by First user source / medium (active-users-by-source-medium)');
    console.log('--------------------------------------------------');
    for (const preset of datePresetsToTest) {
      const result = await fetchSingleSuggestedCardData(userId, { key: 'active-users-by-source-medium' }, {
        preset,
        ...(preset === 'Custom' ? { startDate: '2026-09-01', endDate: '2026-09-14' } : {}),
      });
      console.log(`[${preset}] Total: ${result.total} | Top Rows (${result.rows.length}): ${result.rows.slice(0, 3).map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('');

    // 4. Views by Page title and screen class
    console.log('--------------------------------------------------');
    console.log('CARD 4: Views by Page title and screen class (views-by-page-title)');
    console.log('--------------------------------------------------');
    for (const preset of datePresetsToTest) {
      const result = await fetchSingleSuggestedCardData(userId, { key: 'views-by-page-title' }, {
        preset,
        ...(preset === 'Custom' ? { startDate: '2026-09-01', endDate: '2026-09-14' } : {}),
      });
      console.log(`[${preset}] Total: ${result.total} | Top Rows (${result.rows.length}): ${result.rows.slice(0, 3).map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('');

    // 5. Active users by Town/City
    console.log('--------------------------------------------------');
    console.log('CARD 5: Active users by Town/City (active-users-by-city)');
    console.log('--------------------------------------------------');
    for (const preset of datePresetsToTest) {
      const result = await fetchSingleSuggestedCardData(userId, { key: 'active-users-by-city' }, {
        preset,
        ...(preset === 'Custom' ? { startDate: '2026-09-01', endDate: '2026-09-14' } : {}),
      });
      console.log(`[${preset}] Total: ${result.total} | Top Rows (${result.rows.length}): ${result.rows.slice(0, 3).map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('');

    // 6. Key events by Platform
    console.log('--------------------------------------------------');
    console.log('CARD 6: Key events by Platform (key-events-by-platform)');
    console.log('--------------------------------------------------');
    for (const preset of datePresetsToTest) {
      const result = await fetchSingleSuggestedCardData(userId, { key: 'key-events-by-platform' }, {
        metric: 'eventCount',
        dimension: 'platform',
        preset,
        ...(preset === 'Custom' ? { startDate: '2026-09-01', endDate: '2026-09-14' } : {}),
      });
      console.log(`[${preset}] Total: ${result.total} | Rows (${result.rows.length}): ${result.rows.map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('');

    // 7. New users by First user primary channel group
    console.log('--------------------------------------------------');
    console.log('CARD 7: New users by First user primary channel group (new-users-by-channel)');
    console.log('--------------------------------------------------');
    for (const preset of datePresetsToTest) {
      const result = await fetchSingleSuggestedCardData(userId, { key: 'new-users-by-channel' }, {
        dimension: 'firstUserPrimaryChannelGroup',
        preset,
        ...(preset === 'Custom' ? { startDate: '2026-09-01', endDate: '2026-09-14' } : {}),
      });
      console.log(`[${preset}] Total: ${result.total} | Rows (${result.rows.length}): ${result.rows.slice(0, 4).map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('');

    // 8. Key events by Event name
    console.log('--------------------------------------------------');
    console.log('CARD 8: Key events by Event name (key-events-by-event)');
    console.log('--------------------------------------------------');
    for (const preset of datePresetsToTest) {
      const result = await fetchSingleSuggestedCardData(userId, { key: 'key-events-by-event' }, {
        preset,
        ...(preset === 'Custom' ? { startDate: '2026-09-01', endDate: '2026-09-14' } : {}),
      });
      console.log(`[${preset}] Total: ${result.total} | Rows (${result.rows.length}): ${result.rows.slice(0, 3).map(r => `${r.dimensionValue}:${r.current}`).join(', ')}`);
    }
    console.log('');

    console.log('==================================================');
    console.log('MASTER RUNTIME VERIFICATION COMPLETED SUCCESSFULLY!');
    console.log('==================================================');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[MASTER RUNTIME VERIFICATION ERROR]', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runMasterRuntimeVerification();
