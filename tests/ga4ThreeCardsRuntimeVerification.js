/**
 * Live Runtime Verification Script for 3 Suggested-for-You GA4 Cards:
 * 1. Active users by First user source / medium (active-users-by-source-medium)
 * 2. Views by Page title and screen class (views-by-page-title)
 * 3. Active users by Town/City (active-users-by-city)
 *
 * Connects to MongoDB, retrieves the active GA4 property, and runs live GA4 Data API Core Reporting requests
 * across 7D, 28D, 90D, 30D, Last 90 days, This year, and Custom date ranges.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const { getSuggestedCards } = require('../services/googleAnalyticsDataService');

async function runThreeCardsRuntimeVerification() {
  console.log('==================================================');
  console.log('--- GA4 THREE CARDS RUNTIME API VERIFICATION ---');
  console.log('==================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/gromentum';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');

    const activeProperty = await GoogleAnalyticsProperty.findOne({ isActive: true });
    if (!activeProperty) {
      console.log('No GA4 property found in database. Skipping live call.');
      await mongoose.disconnect();
      return;
    }

    console.log(`✓ Active GA4 Property: ${activeProperty.displayName} (ID: ${activeProperty.propertyId}, TimeZone: ${activeProperty.timeZone})\n`);
    const userId = activeProperty.userId;

    const cardsToVerify = [
      { key: 'active-users-by-source-medium', metric: 'activeUsers', dimension: 'firstUserSourceMedium' },
      { key: 'views-by-page-title', metric: 'screenPageViews', dimension: 'pageTitle' },
      { key: 'active-users-by-city', metric: 'activeUsers', dimension: 'city' },
    ];

    const rangesToVerify = [
      { name: '7D', preset: '7D' },
      { name: '28D', preset: '28D' },
      { name: '90D', preset: '90D' },
      { name: '30D', preset: '30D' },
      { name: 'Last 90 days', preset: 'Last 90 days' },
      { name: 'This year', preset: 'This year' },
      { name: 'Custom (14D)', startDate: '2026-09-01', endDate: '2026-09-14', preset: 'Custom' },
    ];

    for (const cardConfig of cardsToVerify) {
      console.log('==================================================');
      console.log(`--- AUDITING CARD: '${cardConfig.key}' ---`);
      console.log('==================================================\n');

      for (const r of rangesToVerify) {
        const res = await getSuggestedCards(userId, {
          propertyId: activeProperty.propertyId,
          cardKey: cardConfig.key,
          preset: r.preset,
          startDate: r.startDate,
          endDate: r.endDate,
          comparisonType: 'previous_period',
        });

        const d = res.data;

        console.log(`CARD:      ${d.card} ("${d.title}")`);
        console.log(`metric:    ${d.metric} (${d.metricLabel})`);
        console.log(`dimension: ${d.dimension} (${d.dimensionLabel})`);
        console.log(`current:   ${d.dateRange.startDate} to ${d.dateRange.endDate}`);
        console.log(`previous:  ${d.comparison.startDate} to ${d.comparison.endDate}`);
        console.log(`total:     ${d.total} (Previous Total: ${d.totalComparison?.previous})`);
        console.log(`returned rows (${d.rows.length}):`);
        d.rows.forEach((row, idx) => {
          console.log(`  #${idx + 1} "${row.dimensionValue}": current = ${row.current}, previous = ${row.previous}, changePct = ${row.changePct}%`);
        });

        if (d.rows.length > 5) {
          console.error(`❌ FAIL: Card '${d.card}' returned more than 5 rows!`);
        } else {
          console.log(`✓ PASS: Rows count <= 5 (Count: ${d.rows.length})`);
        }
        console.log('--------------------------------------------------\n');
      }
    }

    await mongoose.disconnect();
    console.log('==================================================');
    console.log('GA4 THREE CARDS RUNTIME API VERIFICATION COMPLETED');
    console.log('==================================================');
  } catch (err) {
    console.error('Three Cards Runtime Verification Error:', err);
    try { await mongoose.disconnect(); } catch (e) {}
  }
}

runThreeCardsRuntimeVerification();
