/**
 * Runtime Verification Script for GA4 Realtime Data API.
 * Connects to MongoDB, retrieves the user's active property, and executes actual GA4 Realtime Data API requests.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const { getRealtimeData } = require('../services/googleAnalyticsDataService');

async function runRuntimeVerification() {
  console.log('==================================================');
  console.log('--- GA4 REALTIME RUNTIME API VERIFICATION ---');
  console.log('==================================================\n');

  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/gromentum';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');

    // Find active selected property
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

    // Test A: activeUsers + minutesAgo
    console.log('--- EXECUTING RUNTIME TEST A: activeUsers + minutesAgo ---');
    const resA = await getRealtimeData(userId, {
      propertyId: activeProperty.propertyId,
      metric: 'activeUsers',
      dimension: 'minutesAgo',
    });
    console.log('API Response A Data:', JSON.stringify(resA.data, null, 2));
    console.log('API Response A Meta:', JSON.stringify(resA.meta, null, 2));
    console.log('--------------------------------------------------\n');

    // Test B: activeUsers + country
    console.log('--- EXECUTING RUNTIME TEST B: activeUsers + country ---');
    const resB = await getRealtimeData(userId, {
      propertyId: activeProperty.propertyId,
      metric: 'activeUsers',
      dimension: 'country',
    });
    console.log('API Response B Data:', JSON.stringify(resB.data, null, 2));
    console.log('API Response B Meta:', JSON.stringify(resB.meta, null, 2));
    console.log('--------------------------------------------------\n');

    // Test C: Unsupported metric (newUsers)
    console.log('--- EXECUTING RUNTIME TEST C: Unsupported Metric (newUsers) ---');
    try {
      await getRealtimeData(userId, {
        propertyId: activeProperty.propertyId,
        metric: 'newUsers',
        dimension: 'country',
      });
      console.log('❌ Unexpected: newUsers did not throw an error!');
    } catch (errC) {
      console.log(`✓ Handled unsupported metric correctly -> Code: ${errC.code}, Message: ${errC.message}`);
    }
    console.log('--------------------------------------------------\n');

    // Test D: Unsupported dimension (firstUserCampaign)
    console.log('--- EXECUTING RUNTIME TEST D: Unsupported Dimension (firstUserCampaign) ---');
    try {
      await getRealtimeData(userId, {
        propertyId: activeProperty.propertyId,
        metric: 'activeUsers',
        dimension: 'firstUserCampaign',
      });
      console.log('❌ Unexpected: firstUserCampaign did not throw an error!');
    } catch (errD) {
      console.log(`✓ Handled unsupported dimension correctly -> Code: ${errD.code}, Message: ${errD.message}`);
    }
    console.log('--------------------------------------------------\n');

    await mongoose.disconnect();
    console.log('==================================================');
    console.log('GA4 REALTIME RUNTIME API VERIFICATION COMPLETED');
    console.log('==================================================');
  } catch (err) {
    console.error('Runtime Verification Error:', err);
    try { await mongoose.disconnect(); } catch (e) {}
  }
}

runRuntimeVerification();
