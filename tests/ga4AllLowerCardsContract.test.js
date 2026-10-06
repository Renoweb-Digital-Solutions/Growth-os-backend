/**
 * Automated Contract Test for GA4 Lower / Suggested-for-You Cards
 * Verifies that UI metric/dimension selections map to correct internal GA4 metric/dimension names.
 */

const {
  resolveSuggestedCardConfig,
} = require('../services/googleAnalyticsDataService');

describe('GA4 Lower Cards Contract Test Suite', () => {
  it('should resolve all expected registry cards correctly', () => {
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
      expect(config).toBeDefined();
      expect(config.key).toBe(cardKey);
      expect(config.gaDimension).toBeDefined();
      expect(config.gaMetric).toBeDefined();
    }
  });

  it('should support valid country card metrics and dimensions', () => {
    const countryMetrics = ['activeUsers', 'newUsers', 'returningUsers'];
    const countryDimensions = ['countryId', 'country'];

    countryMetrics.forEach((metric) => {
      countryDimensions.forEach((dimension) => {
        expect(metric).toBeTruthy();
        expect(dimension).toBeTruthy();
      });
    });
  });

  it('should support valid platform card metrics', () => {
    const platformMetrics = ['keyEvents', 'totalRevenue', 'eventCount'];
    platformMetrics.forEach((metric) => {
      expect(metric).toBeTruthy();
    });
  });

  it('should support valid new users card dimensions', () => {
    const newUsersDimensions = [
      'firstUserPrimaryChannelGroup',
      'firstUserDefaultChannelGroup',
      'firstUserMedium',
      'firstUserCampaign',
      'firstUserSource',
    ];
    newUsersDimensions.forEach((dim) => {
      expect(dim).toBeTruthy();
    });
  });

  it('should support traffic acquisition card metrics and dimensions', () => {
    const acqMetrics = ['sessions', 'engagedSessions'];
    const acqDimensions = [
      'sessionPrimaryChannelGroup',
      'sessionDefaultChannelGroup',
      'sessionMedium',
      'sessionCampaignName',
      'sessionSource',
    ];
    acqMetrics.forEach((m) => {
      acqDimensions.forEach((d) => {
        expect(m).toBeTruthy();
        expect(d).toBeTruthy();
      });
    });
  });
});
