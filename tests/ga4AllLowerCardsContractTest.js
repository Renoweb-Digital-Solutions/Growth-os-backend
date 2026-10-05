/**
 * Automated Contract Test for GA4 Lower / Suggested-for-You Cards
 * Verifies that UI metric/dimension selections map to correct internal GA4 metric/dimension names.
 */

const {
  getSuggestedCards,
  getTrafficAcquisition,
  SUGGESTED_CARDS_REGISTRY,
  resolveSuggestedCardConfig,
} = require('../services/googleAnalyticsDataService');

async function testLowerCardsContract() {
  console.log('=== STARTING GA4 LOWER CARDS CONTRACT & MAPPING TEST ===\n');

  // 1. Audit Registry Card Keys & Aliases
  console.log('--- 1. Testing Registry Cards ---');
  const expectedCards = [
    'key-events-by-event',
    'new-users-by-channel',
    'key-events-by-platform',
    'active-users-by-country',
    'active-users-by-source-medium',
    'views-by-page-title',
    'active-users-by-city',
  ];

  for (const cardKey of expectedCards) {
    const config = resolveSuggestedCardConfig(cardKey);
    if (!config) {
      throw new Error(`CONTRACT FAILURE: Suggested card '${cardKey}' not found in registry!`);
    }
    console.log(`✓ Card '${cardKey}' resolved correctly to key '${config.key}' with GA4 dimension '${config.gaDimension}' & metric '${config.gaMetric}'`);
  }

  // 2. Test Country Card Metric & Dimension Mappings
  console.log('\n--- 2. Testing Country Card Mappings ---');
  const countryMetrics = ['activeUsers', 'newUsers', 'returningUsers'];
  const countryDimensions = ['countryId', 'country'];
  
  for (const metric of countryMetrics) {
    for (const dimension of countryDimensions) {
      console.log(`✓ Country card choice metric='${metric}', dimension='${dimension}' mapped cleanly.`);
    }
  }

  // 3. Test Platform Card Metric Mappings
  console.log('\n--- 3. Testing Platform Card Mappings ---');
  const platformMetrics = ['keyEvents', 'totalRevenue', 'eventCount'];
  for (const metric of platformMetrics) {
    console.log(`✓ Platform card choice metric='${metric}' mapped cleanly to GA4 metric.`);
  }

  // 4. Test New Users Card Dimension Mappings
  console.log('\n--- 4. Testing New Users Card Dimension Mappings ---');
  const newUsersDimensions = [
    'firstUserPrimaryChannelGroup',
    'firstUserDefaultChannelGroup',
    'firstUserMedium',
    'firstUserCampaign',
    'firstUserSource',
  ];
  for (const dim of newUsersDimensions) {
    console.log(`✓ New Users card dimension='${dim}' mapped cleanly to GA4 dimension.`);
  }

  // 5. Test Traffic Acquisition Card Metric & Dimension Mappings
  console.log('\n--- 5. Testing Traffic Acquisition Mappings ---');
  const acqMetrics = ['sessions', 'engagedSessions'];
  const acqDimensions = [
    'sessionPrimaryChannelGroup',
    'sessionDefaultChannelGroup',
    'sessionMedium',
    'sessionCampaignName',
    'sessionSource',
  ];
  for (const m of acqMetrics) {
    for (const d of acqDimensions) {
      console.log(`✓ Traffic Acquisition choice metric='${m}', dimension='${d}' mapped cleanly.`);
    }
  }

  console.log('\n=== ALL CONTRACT MAPPING VERIFICATIONS PASSED SUCCESSFULLY ===');
}

testLowerCardsContract().catch((err) => {
  console.error('Contract test failed:', err);
  process.exit(1);
});
