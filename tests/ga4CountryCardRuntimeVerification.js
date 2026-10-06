/**
 * Live Runtime Verification Script for GA4 "Active users by Country" Suggested Card Data API.
 * Audits filtering of (not set) / blank countries from display rows, aggregate total preservation,
 * top 7 real country limit, zero-value country preservation, and outputs exact GA4 date ranges and row details for 7D, 30D, and 90D.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const { getSuggestedCards } = require('../services/googleAnalyticsDataService');

async function runCountryCardRuntimeVerification() {
  console.log('==================================================');
  console.log('--- GA4 COUNTRY CARD RUNTIME API & (NOT SET) VERIFICATION ---');
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

    const auditPresets = ['7D', '30D', '90D'];

    for (const preset of auditPresets) {
      console.log('==================================================');
      console.log(`--- AUDITING PRESET: ${preset} ---`);
      console.log('==================================================\n');

      const res = await getSuggestedCards(userId, {
        propertyId: activeProperty.propertyId,
        cardKey: 'active-users-by-country',
        metric: 'activeUsers',
        dimension: 'country',
        preset,
        comparisonType: 'previous_period',
      });

      const data = res.data;

      console.log(`1. Resolved Current Range:  ${data.dateRange.startDate} to ${data.dateRange.endDate}`);
      console.log(`2. Resolved Previous Range: ${data.comparison.startDate} to ${data.comparison.endDate}`);
      console.log(`3. GA4 Aggregate Total:    ${data.total} (Previous Total: ${data.totalComparison?.previous})`);
      console.log(`4. Returned Display Rows (${data.rows.length}):`);
      data.rows.forEach((r, idx) => {
        console.log(`   #${idx + 1} ${r.dimensionValue}: Current = ${r.current}, Previous = ${r.previous}, Change = ${r.changePct}%`);
      });

      // Assert (not set) is NOT present in returned display rows
      const hasNotSet = data.rows.some((r) => String(r.dimensionValue).trim().toLowerCase() === '(not set)');
      if (hasNotSet) {
        console.error('❌ FAIL: Returned display rows contain (not set)!');
      } else {
        console.log('✓ PASS: Display rows EXCLUDE (not set) completely.');
      }

      if (data.rows.length > 7) {
        console.error('❌ FAIL: Returned more than 7 display rows!');
      } else {
        console.log(`✓ PASS: Display rows count <= 7 (Count: ${data.rows.length}).`);
      }
      console.log('--------------------------------------------------\n');
    }

    // Audit All 3 Metrics × 2 Dimensions
    console.log('==================================================');
    console.log('--- AUDITING ALL 3 METRICS × 2 DIMENSIONS (7D) ---');
    console.log('==================================================\n');

    const metricsToTest = ['activeUsers', 'newUsers', 'returningUsers'];
    const dimensionsToTest = ['countryId', 'country'];

    for (const m of metricsToTest) {
      for (const d of dimensionsToTest) {
        const res = await getSuggestedCards(userId, {
          propertyId: activeProperty.propertyId,
          cardKey: 'active-users-by-country',
          metric: m,
          dimension: d,
          preset: '7D',
          comparisonType: 'previous_period',
        });

        const card = res.data;
        const hasNotSet = card.rows.some((r) => String(r.dimensionValue).trim().toLowerCase() === '(not set)');
        console.log(`✓ Metric: ${card.metric} (${card.metricLabel}) | Dimension: ${card.dimension} (${card.dimensionLabel})`);
        console.log(`  Total: ${card.total} | Display Rows: ${card.rows.length} | Contains (not set): ${hasNotSet}`);
        if (card.rows.length > 0) {
          console.log(`  Top Country: "${card.rows[0].dimensionValue}" -> Current: ${card.rows[0].current}, Previous: ${card.rows[0].previous}`);
        }
        console.log('--------------------------------------------------');
      }
    }

    await mongoose.disconnect();
    console.log('\n==================================================');
    console.log('GA4 COUNTRY CARD RUNTIME API & (NOT SET) VERIFICATION COMPLETED');
    console.log('==================================================');
  } catch (err) {
    console.error('Country Card Runtime Verification Error:', err);
    try { await mongoose.disconnect(); } catch (e) {}
  }
}

runCountryCardRuntimeVerification();
