/**
 * Live Runtime Verification Script for GA4 Traffic Acquisition "Sessions by [dimension]" Card Data API.
 * Connects to MongoDB, retrieves the user's active GA4 property, and executes actual GA4 Data API Core Reporting requests.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const { getTrafficAcquisition } = require('../services/googleAnalyticsDataService');

async function runAcquisitionRuntimeVerification() {
  console.log('==================================================');
  console.log('--- GA4 TRAFFIC ACQUISITION CARD RUNTIME API VERIFICATION ---');
  console.log('==================================================\n');

  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/gromentum';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');

    const activeProperty = await GoogleAnalyticsProperty.findOne({ isSelected: true, isActive: true });
    if (!activeProperty) {
      console.log('No active property selected in DB. Searching for any active property...');
      const anyProp = await GoogleAnalyticsProperty.findOne({ isActive: true });
      if (!anyProp) {
        console.log('No GA4 property found in local database. Skipping live network call.');
        await mongoose.disconnect();
        return;
      }
      activeProperty = anyProp;
    }

    console.log(`✓ Active GA4 Property: ${activeProperty.displayName} (ID: ${activeProperty.propertyId}, TimeZone: ${activeProperty.timeZone})\n`);
    const userId = activeProperty.userId;

    const metricsToTest = ['sessions', 'engagedSessions'];
    const dimensionsToTest = [
      'sessionPrimaryChannelGroup',
      'sessionDefaultChannelGroup',
      'sessionMedium',
      'sessionCampaignName',
      'sessionSource',
    ];
    const presetsToTest = ['7D', '28D'];

    for (const preset of presetsToTest) {
      console.log(`==================================================`);
      console.log(`--- RUNNING ACQUISITION TESTS FOR PRESET: ${preset} ---`);
      console.log(`==================================================\n`);

      for (const metric of metricsToTest) {
        for (const dimension of dimensionsToTest) {
          console.log(`--- Testing Metric: '${metric}' × Dimension: '${dimension}' [Preset: ${preset}] ---`);
          const res = await getTrafficAcquisition(userId, {
            propertyId: activeProperty.propertyId,
            metric,
            dimension,
            rangePreset: preset,
            comparisonType: 'previous_period',
          });

          console.log(`  ✓ Metric: ${res.data.metric} (${res.data.metricLabel})`);
          console.log(`  ✓ Dimension: ${res.data.dimension} (${res.data.dimensionLabel}) -> GA4 Dim: ${res.data.gaDimension}`);
          console.log(`  ✓ Range: ${res.data.dateRange.startDate} to ${res.data.dateRange.endDate}`);
          console.log(`  ✓ Total: ${res.data.total} (Previous Total: ${res.data.totalComparison?.previous ?? 'N/A'}, Change: ${res.data.totalComparison?.changePct ?? 'N/A'}%)`);
          console.log(`  ✓ Rows Count: ${res.data.count}`);
          if (res.data.rows.length > 0) {
            console.log(`  ✓ Top Row: "${res.data.rows[0].dimensionValue}" -> Current: ${res.data.rows[0].current}, Previous: ${res.data.rows[0].previous}, Change: ${res.data.rows[0].changePct}%`);
          } else {
            console.log(`  ✓ Rows: [] (Zero GA4 data for this combination)`);
          }
          console.log('--------------------------------------------------');
        }
      }
    }

    // Test Invalid Metric & Invalid Dimension error handling
    console.log('\n--- TESTING UNSUPPORTED METRIC ERROR HANDLING ---');
    try {
      await getTrafficAcquisition(userId, {
        propertyId: activeProperty.propertyId,
        metric: 'invalidMetric',
        dimension: 'medium',
      });
      console.log('❌ Unexpected: invalidMetric did not throw!');
    } catch (errM) {
      console.log(`✓ Handled invalid metric correctly -> Code: ${errM.code}, Message: ${errM.message}`);
    }

    console.log('\n--- TESTING UNSUPPORTED DIMENSION ERROR HANDLING ---');
    try {
      await getTrafficAcquisition(userId, {
        propertyId: activeProperty.propertyId,
        metric: 'sessions',
        dimension: 'invalidDimension',
      });
      console.log('❌ Unexpected: invalidDimension did not throw!');
    } catch (errD) {
      console.log(`✓ Handled invalid dimension correctly -> Code: ${errD.code}, Message: ${errD.message}`);
    }

    await mongoose.disconnect();
    console.log('\n==================================================');
    console.log('GA4 ACQUISITION CARD RUNTIME API VERIFICATION COMPLETED');
    console.log('==================================================');
  } catch (err) {
    console.error('Acquisition Runtime Verification Error:', err);
    try { await mongoose.disconnect(); } catch (e) {}
  }
}

runAcquisitionRuntimeVerification();
