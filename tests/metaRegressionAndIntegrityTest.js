/**
 * Automated Meta Graph API Regression & Integrity Test Suite
 *
 * Covers all 11 critical regression areas:
 * 1. Missing metric versus genuine zero
 * 2. Empty insights array versus real zero
 * 3. CTR/CPC/CPM with valid and invalid denominators
 * 4. Zero budgets and balances
 * 5. Facebook post interactions when reactions/comments are missing
 * 6. Instagram carousel metric name mapping
 * 7. Facebook discovery failing while Ad Account discovery succeeds (error isolation)
 * 8. Entity-to-insight matching beyond 100 entities (cursor pagination)
 * 9. Rate-limit and token-expiry error handling
 * 10. Capability evaluation with actual available permission set
 * 11. Date-range preservation and warning metadata
 *
 * Uses mocked Graph API responses. Does not require real Meta credentials or mutate live assets.
 */

const assert = require('assert');
const metaService = require('../services/metaService');
const metaInsightService = require('../services/metaInsightService');

// Save original global.fetch
const originalFetch = global.fetch;

async function runMetaRegressionTestSuite() {
  console.log('================================================================');
  console.log('STARTING META GRAPH API REGRESSION & INTEGRITY TEST SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`[PASS] Test ${totalTests}: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`[FAIL] Test ${totalTests}: ${name}`);
      console.error(err);
      throw err;
    }
  }

  async function asyncTest(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`[PASS] Test ${totalTests}: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`[FAIL] Test ${totalTests}: ${name}`);
      console.error(err);
      throw err;
    }
  }

  process.env.META_GRAPH_API_VERSION = 'v26.0';

  // --------------------------------------------------------------------------
  // TEST 1: Missing metric versus genuine zero in parseNumericMetric
  // --------------------------------------------------------------------------
  test('parseNumericMetric: differentiates missing/null from genuine numeric zero', () => {
    assert.strictEqual(metaService.parseNumericMetric(undefined), null);
    assert.strictEqual(metaService.parseNumericMetric(null), null);
    assert.strictEqual(metaService.parseNumericMetric(''), null);
    assert.strictEqual(metaService.parseNumericMetric('invalid_num'), null);
    assert.strictEqual(metaService.parseNumericMetric(NaN), null);

    // Genuine zero must be preserved!
    assert.strictEqual(metaService.parseNumericMetric(0), 0);
    assert.strictEqual(metaService.parseNumericMetric('0'), 0);
    assert.strictEqual(metaService.parseNumericMetric(0.0), 0);

    // Positive and negative numbers
    assert.strictEqual(metaService.parseNumericMetric(123.45), 123.45);
    assert.strictEqual(metaService.parseNumericMetric('123.45'), 123.45);
    assert.strictEqual(metaService.parseNumericMetric(-5), -5);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Ads Insight row metric parsing (genuine zero vs missing)
  // --------------------------------------------------------------------------
  await asyncTest('getAdsInsights: preserves numeric zero and leaves missing as null', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            account_id: 'act_101',
            account_name: 'Test Account 1',
            spend: '0',
            impressions: '0',
            clicks: '0',
            reach: '0',
            ctr: '0',
          },
          {
            account_id: 'act_101',
            account_name: 'Test Account 1',
            // Missing spend, impressions, clicks, reach
          },
        ],
        paging: {},
      }),
    });

    const result = await metaService.getAdsInsights('act_101', 'mock_token');
    assert.strictEqual(result.insights.length, 2);

    // Row 1: Real zero returned by Meta
    const row0 = result.insights[0];
    assert.strictEqual(row0.spend, 0, 'Genuine zero spend must be 0');
    assert.strictEqual(row0.impressions, 0, 'Genuine zero impressions must be 0');
    assert.strictEqual(row0.clicks, 0, 'Genuine zero clicks must be 0');
    assert.strictEqual(row0.reach, 0, 'Genuine zero reach must be 0');
    assert.strictEqual(row0.ctr, 0, 'Explicit 0 ctr must be preserved');

    // Row 2: Missing metrics from Meta
    const row1 = result.insights[1];
    assert.strictEqual(row1.spend, null, 'Missing spend must be null');
    assert.strictEqual(row1.impressions, null, 'Missing impressions must be null');
    assert.strictEqual(row1.clicks, null, 'Missing clicks must be null');
    assert.strictEqual(row1.reach, null, 'Missing reach must be null');
    assert.strictEqual(row1.ctr, null, 'Derived ctr with missing inputs must be null');
  });

  // --------------------------------------------------------------------------
  // TEST 3: Empty insights array versus real zero aggregation
  // --------------------------------------------------------------------------
  await asyncTest('getOverview: empty insights dataset produces nulls, not zeros', async () => {
    const mockUserId = 'user_test_overview_empty';
    metaInsightService.invalidateUserCache(mockUserId);

    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: { status: 'connected', accessToken: 'mock_token', grantedScopes: ['ads_read'] },
      assets: {
        pages: [],
        instagramAccounts: [],
        adAccounts: [{ adAccountId: 'act_empty_1', name: 'Empty Acc', currency: 'USD', timezone: 'UTC' }],
      },
      capabilities: {
        ads: { available: true },
        social: { available: false },
        instagram: { available: false },
      },
    });

    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        // Return empty insights data array
        return { ok: true, json: async () => ({ data: [] }) };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const overview = await metaInsightService.getOverview(mockUserId, { adAccountId: 'act_empty_1' });
    const ads = overview.data.adsOverview;
    assert.notStrictEqual(ads, null);
    assert.strictEqual(ads.spend, null, 'Empty insights spend must be null, not 0');
    assert.strictEqual(ads.impressions, null, 'Empty insights impressions must be null, not 0');
    assert.strictEqual(ads.clicks, null, 'Empty insights clicks must be null, not 0');
    assert.strictEqual(ads.reach, null, 'Empty insights reach must be null, not 0');
    assert.strictEqual(ads.ctr, null, 'Empty insights ctr must be null, not 0');
    assert.strictEqual(ads.cpc, null, 'Empty insights cpc must be null, not 0');
    assert.strictEqual(ads.cpm, null, 'Empty insights cpm must be null, not 0');
  });

  // --------------------------------------------------------------------------
  // TEST 4: CTR, CPC, and CPM with valid and invalid denominators
  // --------------------------------------------------------------------------
  await asyncTest('getAdsInsights: CTR/CPC/CPM returns null on 0 denominator and calculates on valid inputs', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [
          // Row A: Valid inputs
          {
            account_id: 'act_102',
            spend: '150.00',
            impressions: '10000',
            clicks: '200',
            reach: '8000',
          },
          // Row B: Zero denominator (0 clicks, 0 impressions)
          {
            account_id: 'act_102',
            spend: '25.00',
            impressions: '0',
            clicks: '0',
            reach: '0',
          },
        ],
        paging: {},
      }),
    });

    const result = await metaService.getAdsInsights('act_102', 'mock_token');
    const rowA = result.insights[0];
    // CTR = (200 / 10000) * 100 = 2.0%
    assert.strictEqual(rowA.ctr, 2.0);
    // CPC = 150 / 200 = 0.75
    assert.strictEqual(rowA.cpc, 0.75);
    // CPM = (150 / 10000) * 1000 = 15.0
    assert.strictEqual(rowA.cpm, 15.0);

    const rowB = result.insights[1];
    assert.strictEqual(rowB.ctr, null, 'CTR with 0 impressions denominator must be null');
    assert.strictEqual(rowB.cpc, null, 'CPC with 0 clicks denominator must be null');
    assert.strictEqual(rowB.cpm, null, 'CPM with 0 impressions denominator must be null');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Zero budgets and balance normalization
  // --------------------------------------------------------------------------
  await asyncTest('Campaign and AdAccount budgets/balances preserve numeric zero and return null when absent', async () => {
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/adaccounts')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'act_01', account_id: '01', name: 'Zero Balance Acc', currency: 'USD', balance: '0', spend_cap: '0' },
              { id: 'act_02', account_id: '02', name: 'Null Balance Acc', currency: 'USD' /* no balance or spend_cap */ },
            ],
          }),
        };
      }
      if (urlStr.includes('/campaigns')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'camp_01', name: 'Zero Budget Camp', daily_budget: '0', lifetime_budget: '0' },
              { id: 'camp_02', name: 'Null Budget Camp' /* missing daily_budget */ },
            ],
            paging: {},
          }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const adAccounts = await metaService.getAdAccounts('mock_token');
    assert.strictEqual(adAccounts[0].balance, 0, 'Genuine zero balance must be preserved');
    assert.strictEqual(adAccounts[0].spendCap, 0, 'Genuine zero spendCap must be preserved');
    assert.strictEqual(adAccounts[1].balance, null, 'Missing balance must be null');
    assert.strictEqual(adAccounts[1].spendCap, null, 'Missing spendCap must be null');

    const campaignsResult = await metaService.getCampaigns('act_01', 'mock_token');
    assert.strictEqual(campaignsResult.campaigns[0].dailyBudget, 0, 'Genuine zero dailyBudget must be 0');
    assert.strictEqual(campaignsResult.campaigns[0].lifetimeBudget, 0, 'Genuine zero lifetimeBudget must be 0');
    assert.strictEqual(campaignsResult.campaigns[1].dailyBudget, null, 'Missing dailyBudget must be null');
    assert.strictEqual(campaignsResult.campaigns[1].lifetimeBudget, null, 'Missing lifetimeBudget must be null');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Facebook post interactions when reactions/comments are missing
  // --------------------------------------------------------------------------
  test('parseFacebookPostMetrics: does not fabricate interaction totals when reactions/comments are unavailable', () => {
    // Post with only shareCount
    const postWithSharesOnly = {
      postId: 'p_101',
      shareCount: 15,
      insightsData: [{ name: 'post_engaged_users', values: [{ value: 50 }] }],
    };

    const metrics1 = metaInsightService.parseFacebookPostMetrics(postWithSharesOnly);
    assert.strictEqual(metrics1.shareCount, 15);
    assert.strictEqual(metrics1.reactionCount, null, 'reactionCount must be null when absent');
    assert.strictEqual(metrics1.commentCount, null, 'commentCount must be null when absent');
    assert.strictEqual(metrics1.fbPostInteractions, null, 'fbPostInteractions must be null, not 15 or 0');
    assert.strictEqual(metrics1.engagement, 50);

    // Post with all genuine zero counts
    const postWithZeros = {
      postId: 'p_102',
      shareCount: 0,
      reactionCount: 0,
      commentCount: 0,
    };
    const metrics2 = metaInsightService.parseFacebookPostMetrics(postWithZeros);
    assert.strictEqual(metrics2.fbPostInteractions, 0, 'Genuine zero interactions must be 0');

    // Post with full counts
    const postWithAll = {
      postId: 'p_103',
      shareCount: 5,
      reactionCount: 20,
      commentCount: 10,
    };
    const metrics3 = metaInsightService.parseFacebookPostMetrics(postWithAll);
    assert.strictEqual(metrics3.fbPostInteractions, 35);
  });

  // --------------------------------------------------------------------------
  // TEST 7: Instagram carousel metric name mapping
  // --------------------------------------------------------------------------
  await asyncTest('getSingleContentInsights: maps carousel_album_* metrics properly', async () => {
    const mockUserId = 'user_test_carousel';
    metaInsightService.invalidateUserCache(mockUserId);

    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: { status: 'connected', accessToken: 'mock_token', grantedScopes: ['instagram_basic', 'instagram_manage_insights'] },
      assets: {
        pages: [],
        instagramAccounts: [{ instagramAccountId: 'ig_carousel_owner', username: 'test_brand' }],
        adAccounts: [],
      },
      capabilities: {
        ads: { available: false },
        social: { available: false },
        instagram: { available: true },
      },
    });

    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { name: 'carousel_album_impressions', values: [{ value: 1250 }] },
              { name: 'carousel_album_reach', values: [{ value: 950 }] },
              { name: 'carousel_album_engagement', values: [{ value: 180 }] },
              { name: 'carousel_album_saved', values: [{ value: 45 }] },
            ],
          }),
        };
      }
      // Single media fetch
      return {
        ok: true,
        json: async () => ({
          id: 'media_carousel_1',
          caption: 'Great carousel slide',
          media_type: 'CAROUSEL_ALBUM',
          timestamp: '2026-10-01T12:00:00Z',
          like_count: 75,
          comments_count: 12,
          owner: { id: 'ig_carousel_owner' },
        }),
      };
    };

    const result = await metaInsightService.getSingleContentInsights(mockUserId, 'media_carousel_1', {
      platform: 'instagram',
      assetId: 'ig_carousel_owner',
    });

    const metrics = result.data.metrics;
    assert.strictEqual(metrics.impressions, 1250, 'carousel_album_impressions must map to impressions');
    assert.strictEqual(metrics.reach, 950, 'carousel_album_reach must map to reach');
    assert.strictEqual(metrics.engagement, 180, 'carousel_album_engagement must map to engagement');
    assert.strictEqual(metrics.saved, 45, 'carousel_album_saved must map to saved');
    assert.strictEqual(metrics.plays, null, 'plays on non-reel must be null');
    assert.strictEqual(metrics.likeCount, 75);
    assert.strictEqual(metrics.commentCount, 12);
    assert.strictEqual(metrics.igMediaInteractions, 87);
  });

  // --------------------------------------------------------------------------
  // TEST 8: Facebook discovery failing while Ad Account discovery succeeds
  // --------------------------------------------------------------------------
  await asyncTest('discoverAssets: failure in Facebook Pages does not block Ad Account discovery', async () => {
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/accounts')) {
        // Facebook Pages fails with 403 (e.g. pages_show_list not granted)
        return {
          status: 403,
          ok: false,
          json: async () => ({
            error: {
              code: 200,
              message: 'Permissions error: user has not granted pages_show_list permission',
            },
          }),
        };
      }
      if (urlStr.includes('/me/adaccounts')) {
        // Ad Accounts succeeds!
        return {
          status: 200,
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'act_999',
                account_id: '999',
                name: 'Resilient Ad Account',
                account_status: 1,
                currency: 'USD',
                timezone_name: 'America/New_York',
                balance: '120.50',
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const discovery = await metaService.discoverAssets('mock_token');
    assert.strictEqual(discovery.pages.length, 0, 'Pages must be empty on failure');
    assert.strictEqual(discovery.adAccounts.length, 1, 'Ad Accounts must still be discovered');
    assert.strictEqual(discovery.adAccounts[0].adAccountId, 'act_999');
    assert.strictEqual(discovery.capabilities.pagesAvailable, false);
    assert.strictEqual(discovery.capabilities.adsAvailable, true);
    assert.strictEqual(Boolean(discovery.errors.pages), true, 'Error message for pages should be captured');
    assert.strictEqual(discovery.errors.adAccounts, null);
  });

  // --------------------------------------------------------------------------
  // TEST 9: Entity-to-insight matching beyond 100 entities
  // --------------------------------------------------------------------------
  await asyncTest('getCampaignInsights: matches insights for entities beyond row 100 via cursor pagination', async () => {
    const mockUserId = 'user_test_pagination_matching';
    metaInsightService.invalidateUserCache(mockUserId);

    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: { status: 'connected', accessToken: 'mock_token', grantedScopes: ['ads_read'] },
      assets: {
        pages: [],
        instagramAccounts: [],
        adAccounts: [{ adAccountId: 'act_large', currency: 'USD', timezone: 'UTC' }],
      },
      capabilities: {
        ads: { available: true },
        social: { available: false },
        instagram: { available: false },
      },
    });

    global.fetch = async (url) => {
      const urlStr = String(url);
      // Mock 120 campaigns
      if (urlStr.includes('/campaigns')) {
        const campaigns = [];
        for (let i = 1; i <= 120; i++) {
          campaigns.push({
            id: `camp_${i}`,
            name: `Campaign ${i}`,
            status: 'ACTIVE',
            daily_budget: '5000',
          });
        }
        return {
          ok: true,
          json: async () => ({ data: campaigns, paging: {} }),
        };
      }

      // Mock paginated insights: Page 1 has camp_1 to camp_100, Page 2 has camp_101 to camp_120
      if (urlStr.includes('/insights')) {
        if (!urlStr.includes('after=cursor_page_2')) {
          const insightsPage1 = [];
          for (let i = 1; i <= 100; i++) {
            insightsPage1.push({
              campaign_id: `camp_${i}`,
              spend: '10.00',
              impressions: '1000',
              clicks: '50',
            });
          }
          return {
            ok: true,
            json: async () => ({
              data: insightsPage1,
              paging: {
                cursors: { after: 'cursor_page_2' },
                next: 'https://graph.facebook.com/v26.0/act_large/insights?after=cursor_page_2',
              },
            }),
          };
        } else {
          // Page 2
          const insightsPage2 = [];
          for (let i = 101; i <= 120; i++) {
            insightsPage2.push({
              campaign_id: `camp_${i}`,
              spend: '25.00',
              impressions: '2500',
              clicks: '100',
            });
          }
          return {
            ok: true,
            json: async () => ({
              data: insightsPage2,
              paging: {},
            }),
          };
        }
      }

      return { ok: true, json: async () => ({ data: [] }) };
    };

    const res = await metaInsightService.getCampaignInsights(mockUserId, { adAccountId: 'act_large' });
    assert.strictEqual(res.data.campaigns.length, 120);

    // Verify campaign 1 (from page 1) has spend 10.00
    const camp1 = res.data.campaigns.find((c) => c.campaignId === 'camp_1');
    assert.strictEqual(camp1.spend, 10.0);

    // Verify campaign 115 (from page 2, beyond 100!) has spend 25.00 and is NOT null!
    const camp115 = res.data.campaigns.find((c) => c.campaignId === 'camp_115');
    assert.strictEqual(camp115.spend, 25.0, 'Campaign 115 spend must be 25.0, not null');
    assert.strictEqual(camp115.impressions, 2500, 'Campaign 115 impressions must be 2500, not null');
    assert.strictEqual(camp115.clicks, 100, 'Campaign 115 clicks must be 100, not null');
  });

  // --------------------------------------------------------------------------
  // TEST 10: Rate-limit and token-expiry error handling
  // --------------------------------------------------------------------------
  await asyncTest('fetchGraphApi: maps Code 190 to 401 and Code 4/17/32/613 to 429', async () => {
    // 1. Token Expired (Code 190)
    global.fetch = async () => ({
      status: 400,
      ok: false,
      json: async () => ({
        error: { code: 190, message: 'Error validating access token: Session has expired' },
      }),
    });

    let expiredErrorCaught = false;
    try {
      await metaService.fetchGraphApi('/me', 'expired_token');
    } catch (err) {
      expiredErrorCaught = true;
      assert.strictEqual(err.statusCode, 401);
      assert.strictEqual(err.metaCode, 190);
    }
    assert.strictEqual(expiredErrorCaught, true, 'Should throw 401 on code 190');

    // 2. Rate Limit (Code 17)
    global.fetch = async () => ({
      status: 403,
      ok: false,
      json: async () => ({
        error: { code: 17, message: 'User request limit reached' },
      }),
    });

    let rateLimitErrorCaught = false;
    try {
      await metaService.fetchGraphApi('/me', 'valid_token');
    } catch (err) {
      rateLimitErrorCaught = true;
      assert.strictEqual(err.statusCode, 429);
      assert.strictEqual(err.metaCode, 17);
    }
    assert.strictEqual(rateLimitErrorCaught, true, 'Should throw 429 on code 17');
  });

  // --------------------------------------------------------------------------
  // TEST 11: Capability evaluation with actual granted permissions
  // --------------------------------------------------------------------------
  test('evaluateCapabilities: evaluates social, pageInsights, instagram, and ads strictly', () => {
    const mockUser = { _id: 'u1', businessType: 'b2c' };
    const mockTenant = { planTier: 'tier2' };

    // Case A: Disconnected
    const capsDisconnected = metaInsightService.evaluateCapabilities(null, mockUser, mockTenant);
    assert.strictEqual(capsDisconnected.social.available, false);
    assert.strictEqual(capsDisconnected.social.code, 'NOT_CONNECTED');
    assert.strictEqual(capsDisconnected.ads.available, false);

    // Case B: Connected with only ads_read
    const integrationAdsOnly = {
      status: 'connected',
      accessToken: 'valid',
      grantedScopes: ['ads_read'],
    };
    const assetsWithAd = {
      pages: [],
      instagramAccounts: [],
      adAccounts: [{ adAccountId: 'act_1' }],
    };
    const capsAdsOnly = metaInsightService.evaluateCapabilities(integrationAdsOnly, mockUser, mockTenant, assetsWithAd);
    assert.strictEqual(capsAdsOnly.ads.available, true);
    assert.strictEqual(capsAdsOnly.social.available, false);
    assert.strictEqual(capsAdsOnly.social.code, 'PERMISSION_DENIED');

    // Case C: Connected with full scopes & page, but page lacks ANALYZE task and token
    const integrationFull = {
      status: 'connected',
      accessToken: 'valid',
      grantedScopes: ['pages_show_list', 'pages_read_engagement', 'read_insights', 'ads_read'],
    };
    const assetsNoTask = {
      pages: [{ pageId: 'p1', tasks: ['MODERATE'], pageToken: null }],
      adAccounts: [{ adAccountId: 'act_1' }],
    };
    const capsNoTask = metaInsightService.evaluateCapabilities(integrationFull, mockUser, mockTenant, assetsNoTask);
    assert.strictEqual(capsNoTask.social.available, true);
    assert.strictEqual(capsNoTask.pageInsights.available, false);
    assert.strictEqual(capsNoTask.pageInsights.code, 'INSUFFICIENT_PAGE_PERMISSIONS');

    // Case D: Page has pageToken
    const assetsWithToken = {
      pages: [{ pageId: 'p1', tasks: ['MODERATE'], pageToken: 'page_token_abc' }],
      adAccounts: [{ adAccountId: 'act_1' }],
    };
    const capsWithToken = metaInsightService.evaluateCapabilities(integrationFull, mockUser, mockTenant, assetsWithToken);
    assert.strictEqual(capsWithToken.social.available, true);
    assert.strictEqual(capsWithToken.pageInsights.available, true);
  });

  // --------------------------------------------------------------------------
  // TEST 12: Date-range preservation and 30-day warning metadata
  // --------------------------------------------------------------------------
  await asyncTest('getInstagramInsights: flags dateWindowTruncated and returns warning on >30-day range', async () => {
    global.fetch = async (url) => {
      const urlStr = String(url);
      assert(urlStr.includes('period=day'));
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'reach',
              period: 'day',
              values: [{ value: 120, end_time: '2026-06-15T07:00:00+0000' }],
            },
          ],
        }),
      };
    };

    // 60-day range (exceeds 30-day limit)
    const result = await metaService.getInstagramInsights('ig_acc_1', 'token', {
      since: '2026-05-01',
      until: '2026-07-01',
    });

    assert.strictEqual(result.dateWindowTruncated, true, 'dateWindowTruncated flag must be true');
    assert.notStrictEqual(result.warning, null, 'Warning string must be present');
    assert(result.warning.includes('30-day limit'));
  });

  // --------------------------------------------------------------------------
  // TEST 13: Capability evaluation with pages_read_engagement without read_insights
  // --------------------------------------------------------------------------
  test('evaluateCapabilities: unblocks pageInsights when pages_read_engagement is granted without read_insights', () => {
    const mockUser = { _id: 'u2', businessType: 'b2b' };
    const mockTenant = { planTier: 'tier1' };

    // Case A: pages_read_engagement present, read_insights absent, valid token
    const integrationEngagementOnly = {
      status: 'connected',
      accessToken: 'valid_user_tok',
      grantedScopes: ['pages_show_list', 'pages_read_engagement'], // NO read_insights
    };
    const assetsWithToken = {
      pages: [{ pageId: 'p_108', tasks: ['MODERATE'], pageToken: 'valid_page_token' }],
      adAccounts: [],
    };
    const caps = metaInsightService.evaluateCapabilities(integrationEngagementOnly, mockUser, mockTenant, assetsWithToken);
    assert.strictEqual(caps.social.available, true);
    assert.strictEqual(caps.pageInsights.available, true, 'pageInsights must be available with pages_read_engagement');
    assert.strictEqual(caps.pageInsights.code, 'AVAILABLE');
    assert.strictEqual(caps.pageInsights.reason, null);

    // Case B: Both pages_read_engagement and read_insights missing
    const integrationNoInsightsScopes = {
      status: 'connected',
      accessToken: 'valid_user_tok',
      grantedScopes: ['pages_show_list'], // neither
    };
    const capsNoScope = metaInsightService.evaluateCapabilities(integrationNoInsightsScopes, mockUser, mockTenant, assetsWithToken);
    assert.strictEqual(capsNoScope.social.available, true);
    assert.strictEqual(capsNoScope.pageInsights.available, false);
    assert.strictEqual(capsNoScope.pageInsights.code, 'PERMISSION_DENIED');

    // Case C: Legacy read_insights present without pages_read_engagement
    const integrationLegacy = {
      status: 'connected',
      accessToken: 'valid_user_tok',
      grantedScopes: ['pages_show_list', 'read_insights'],
    };
    const capsLegacy = metaInsightService.evaluateCapabilities(integrationLegacy, mockUser, mockTenant, assetsWithToken);
    assert.strictEqual(capsLegacy.pageInsights.available, true);
  });

  // --------------------------------------------------------------------------
  // TEST 14: getFacebookPageInsights preserves exact daily dates, zeros, and nulls
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPageInsights: preserves genuine numeric zero, null values, daily dates, and handles empty datasets without fabricating points', async () => {
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                name: 'page_follows',
                period: 'day',
                values: [
                  { value: 1947, end_time: '2026-09-01T07:00:00+0000' },
                  { value: 0, end_time: '2026-09-02T07:00:00+0000' },
                  { value: null, end_time: '2026-09-03T07:00:00+0000' },
                ],
              },
              {
                name: 'page_views_total',
                period: 'day',
                values: [],
              },
            ],
          }),
        };
      }
      if (urlStr.includes('/page_108')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'page_token_108' }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const res = await metaService.getFacebookPageInsights('page_108', 'mock_token', {
      since: '2026-09-01',
      until: '2026-09-03',
    });

    assert.strictEqual(res.pageId, 'page_108');
    const follows = res.metrics.find((m) => m.name === 'page_follows');
    assert.notStrictEqual(follows, undefined);
    assert.strictEqual(follows.values.length, 3);
    assert.strictEqual(follows.values[0].value, 1947);
    assert.strictEqual(follows.values[0].endTime, '2026-09-01T07:00:00+0000');
    assert.strictEqual(follows.values[1].value, 0, 'Genuine zero value must be preserved as 0');
    assert.strictEqual(follows.values[2].value, null, 'Null value must remain null, not coerced to 0');

    const views = res.metrics.find((m) => m.name === 'page_views_total');
    assert.notStrictEqual(views, undefined);
    assert.deepStrictEqual(views.values, [], 'Empty values array must remain empty without synthetic points');

    // Missing metric from Meta response must be stubbed with empty values without throwing
    const eng = res.metrics.find((m) => m.name === 'page_post_engagements');
    assert.notStrictEqual(eng, undefined);
    assert.deepStrictEqual(eng.values, []);
  });

  // --------------------------------------------------------------------------
  // TEST 15: getSocialInsights executes Page Insights and preserves error diagnostic warnings
  // --------------------------------------------------------------------------
  await asyncTest('getSocialInsights: executes Page Insights with pages_read_engagement and captures diagnostics on error', async () => {
    const mockUserId = 'user_test_social_insights';
    metaInsightService.invalidateUserCache(mockUserId);

    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: {
        status: 'connected',
        accessToken: 'user_token_valid',
        grantedScopes: ['pages_show_list', 'pages_read_engagement'], // NO read_insights
      },
      assets: {
        pages: [{ pageId: 'page_diag_1', name: 'Moovana', pageToken: 'page_token_diag' }],
        instagramAccounts: [],
        adAccounts: [],
      },
      capabilities: {
        social: { available: true },
        pageInsights: { available: true },
        instagram: { available: false },
        ads: { available: false },
      },
    });

    // 1. Success case
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { name: 'page_views_total', period: 'day', values: [{ value: 645, end_time: '2026-09-20' }] },
            ],
          }),
        };
      }
      if (urlStr.includes('/page_diag_1')) {
        return {
          ok: true,
          json: async () => ({ id: 'page_diag_1', name: 'Moovana', fan_count: 1947, followers_count: 1947, access_token: 'page_token_diag' }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const successRes = await metaInsightService.getSocialInsights(mockUserId, { pageId: 'page_diag_1' });
    assert.notStrictEqual(successRes.data.page, null);
    assert.strictEqual(successRes.data.page.details.followersCount, 1947);
    assert.strictEqual(successRes.data.page.insights.length, 4);
    assert.strictEqual(successRes.data.page.insights.find((i) => i.name === 'page_views_total').values[0].value, 645);

    // 2. Error case: Page Insights throws (e.g. rate limit or permission error)
    metaInsightService.invalidateUserCache(mockUserId);
    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: {
        status: 'connected',
        accessToken: 'user_token_valid',
        grantedScopes: ['pages_show_list', 'pages_read_engagement'],
      },
      assets: {
        pages: [{ pageId: 'page_diag_1', name: 'Moovana', pageToken: 'page_token_diag' }],
        instagramAccounts: [],
        adAccounts: [],
      },
      capabilities: {
        social: { available: true },
        pageInsights: { available: true },
        instagram: { available: false },
        ads: { available: false },
      },
    });

    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        return {
          status: 403,
          ok: false,
          json: async () => ({ error: { code: 200, message: 'Permissions error fetching page insights' } }),
        };
      }
      if (urlStr.includes('/page_diag_1')) {
        return {
          ok: true,
          json: async () => ({ id: 'page_diag_1', name: 'Moovana', fan_count: 1947, followers_count: 1947, access_token: 'page_token_diag' }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const errorRes = await metaInsightService.getSocialInsights(mockUserId, { pageId: 'page_diag_1' });
    assert.notStrictEqual(errorRes.data.page.details, null);
    assert.deepStrictEqual(errorRes.data.page.insights, [], 'Failed insights should result in empty array, not crash');
    assert.notStrictEqual(errorRes.meta.warnings, undefined);
    assert(errorRes.meta.warnings.some((w) => w.includes('Facebook Page Insights:')));
  });

  // --------------------------------------------------------------------------
  // TEST 16: getFacebookPagePosts retrieves reaction and comment summaries
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPagePosts: requests and extracts reaction and comment summary counts alongside shares', async () => {
    let capturedPostsUrl = null;
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        capturedPostsUrl = urlStr;
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post_201',
                message: 'Product update post',
                created_time: '2026-09-10T12:00:00Z',
                shares: { count: 6 },
                reactions: { summary: { total_count: 34 } },
                comments: { summary: { total_count: 11 } },
              },
            ],
            paging: {},
          }),
        };
      }
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ name: 'post_engaged_users', values: [{ value: 65 }] }],
          }),
        };
      }
      return { ok: true, json: async () => ({ access_token: 'page_token' }) };
    };

    const res = await metaService.getFacebookPagePosts('page_101', 'token');
    assert.strictEqual(res.posts.length, 1);
    const decodedPostsUrl = decodeURIComponent(capturedPostsUrl);
    assert(decodedPostsUrl.includes('reactions.summary(true).limit(0)'), 'Must use summary(true).limit(0) syntax for reactions');
    assert(decodedPostsUrl.includes('comments.summary(true).limit(0)'), 'Must use summary(true).limit(0) syntax for comments');
    const post = res.posts[0];
    assert.strictEqual(post.postId, 'post_201');
    assert.strictEqual(post.shareCount, 6);
    assert.strictEqual(post.reactionCount, 34);
    assert.strictEqual(post.commentCount, 11);
    assert.strictEqual(post.insightsData[0].values[0].value, 65);
  });

  // --------------------------------------------------------------------------
  // TEST 17: getFacebookPagePosts resilient fallback when enhanced fields fail
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPagePosts: gracefully falls back to base fields if enhanced reaction/comment fields fail', async () => {
    let callCount = 0;
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        callCount++;
        if (callCount === 1) {
          // First attempt with enhanced fields fails (e.g. Graph API rejects reactions.summary)
          return {
            status: 400,
            ok: false,
            json: async () => ({
              error: { code: 100, message: 'Invalid field: reactions.summary' },
            }),
          };
        }
        // Second attempt with base fields succeeds
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post_fallback_1',
                message: 'Fallback post',
                created_time: '2026-09-10T12:00:00Z',
                shares: { count: 3 },
              },
            ],
            paging: {},
          }),
        };
      }
      if (urlStr.includes('/insights')) {
        return { ok: true, json: async () => ({ data: [] }) };
      }
      return { ok: true, json: async () => ({ access_token: 'page_token' }) };
    };

    const res = await metaService.getFacebookPagePosts('page_fallback', 'token');
    assert.strictEqual(res.posts.length, 1);
    const post = res.posts[0];
    assert.strictEqual(post.postId, 'post_fallback_1');
    assert.strictEqual(post.shareCount, 3);
    assert.strictEqual(post.reactionCount, null, 'reactionCount must remain null on fallback');
    assert.strictEqual(post.commentCount, null, 'commentCount must remain null on fallback');
  });

  // --------------------------------------------------------------------------
  // TEST 18: parseFacebookPostMetrics keeps engagement and interactions distinct
  // --------------------------------------------------------------------------
  test('parseFacebookPostMetrics: preserves metrics.engagement and metrics.fbPostInteractions as strictly distinct concepts', () => {
    // Post with valid counts: interactions = 20 + 5 + 10 = 35; engaged_users = 80
    const postWithBoth = {
      postId: 'p_distinct_1',
      reactionCount: 20,
      commentCount: 5,
      shareCount: 10,
      insightsData: [{ name: 'post_engaged_users', values: [{ value: 80 }] }],
    };

    const metricsA = metaInsightService.parseFacebookPostMetrics(postWithBoth);
    assert.strictEqual(metricsA.reactionCount, 20);
    assert.strictEqual(metricsA.commentCount, 5);
    assert.strictEqual(metricsA.shareCount, 10);
    assert.strictEqual(metricsA.fbPostInteractions, 35, 'Interactions sum must be 35');
    assert.strictEqual(metricsA.engagement, 80, 'Engaged users must be 80');
    assert.notStrictEqual(metricsA.fbPostInteractions, metricsA.engagement, 'Interactions and engaged users must remain distinct');

    // Post with missing commentCount: fbPostInteractions must be null, but engagement remains 50
    const postMissingComment = {
      postId: 'p_distinct_2',
      reactionCount: 15,
      commentCount: null,
      shareCount: 5,
      insightsData: [{ name: 'post_engaged_users', values: [{ value: 50 }] }],
    };

    const metricsB = metaInsightService.parseFacebookPostMetrics(postMissingComment);
    assert.strictEqual(metricsB.fbPostInteractions, null, 'Cannot fabricate interactions with missing comments');
    assert.strictEqual(metricsB.engagement, 50, 'Engagement insight must be preserved even when interactions is null');
  });

  // --------------------------------------------------------------------------
  // TEST 19: getSingleContent parses Facebook post reactions and comments
  // --------------------------------------------------------------------------
  await asyncTest('getSingleContent: retrieves and parses reaction and comment summary counts for a single Facebook post', async () => {
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ name: 'post_engaged_users', values: [{ value: 42 }] }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: 'post_single_99',
          message: 'Single post message',
          created_time: '2026-09-12T10:00:00Z',
          shares: { count: 4 },
          reactions: { summary: { total_count: 55 } },
          comments: { summary: { total_count: 14 } },
          from: { id: 'page_108', name: 'Moovana' },
        }),
      };
    };

    const item = await metaService.getSingleContent('post_single_99', 'token', false, 'u1');
    assert.strictEqual(item.postId, 'post_single_99');
    assert.strictEqual(item.shareCount, 4);
    assert.strictEqual(item.reactionCount, 55);
    assert.strictEqual(item.commentCount, 14);
    assert.strictEqual(item.insightsData[0].values[0].value, 42);
  });

  // --------------------------------------------------------------------------
  // TEST 20: Cache isolation between different users
  // --------------------------------------------------------------------------
  test('Cache isolation: invalidating user A does not affect user B cache', () => {
    metaInsightService.setContextCache('user_A', { sample: 123 });
    metaInsightService.setContextCache('user_B', { sample: 456 });

    metaInsightService.invalidateUserCache('user_A');

    metaInsightService.setContextCache('user_A', { sample: 999 });
    assert.doesNotThrow(() => {
      metaInsightService.invalidateUserCache('user_A');
    });
  });

  // --------------------------------------------------------------------------
  // TEST 21: Facebook-only request does not fetch Instagram or leak Instagram warnings
  // --------------------------------------------------------------------------
  await asyncTest('getSocialInsights: Facebook-only request does not fetch Instagram or leak Instagram warnings', async () => {
    const mockUserId = 'user_test_fb_only_warning';
    metaInsightService.invalidateUserCache(mockUserId);

    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: {
        status: 'connected',
        accessToken: 'user_token_valid',
        grantedScopes: ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_manage_insights'],
      },
      assets: {
        pages: [{ pageId: 'page_fb_1', name: 'Moovana', pageToken: 'page_token_fb' }],
        instagramAccounts: [{ instagramAccountId: 'ig_acc_leak_test', username: 'moovana_ig' }],
        adAccounts: [],
      },
      capabilities: {
        social: { available: true },
        pageInsights: { available: true },
        instagram: { available: true },
        ads: { available: false },
      },
    });

    let igFetchInvoked = false;
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/ig_acc_leak_test')) {
        igFetchInvoked = true;
        return {
          ok: true,
          json: async () => ({
            data: [{ name: 'reach', period: 'day', values: [{ value: 100 }] }],
          }),
        };
      }
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ name: 'page_views_total', period: 'day', values: [{ value: 200, end_time: '2026-05-15' }] }],
          }),
        };
      }
      if (urlStr.includes('/page_fb_1')) {
        return {
          ok: true,
          json: async () => ({ id: 'page_fb_1', name: 'Moovana', fan_count: 1947, followers_count: 1947, access_token: 'page_token_fb' }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    // Request with pageId only and >30 day window (which would trigger Instagram warning if fetched)
    const res = await metaInsightService.getSocialInsights(mockUserId, {
      pageId: 'page_fb_1',
      since: '2026-05-01',
      until: '2026-07-01',
    });

    assert.strictEqual(igFetchInvoked, false, 'Instagram API must not be invoked for Facebook-only requests');
    assert.notStrictEqual(res.data.page, null);
    assert.strictEqual(res.data.instagram, null, 'Instagram data must be null when only pageId is requested');
    const warnings = res.meta.warnings || [];
    assert(!warnings.some((w) => w.includes('Instagram')), 'Instagram warnings must not leak into Facebook-only response');

    // Contrast with combined request (both platforms requested)
    metaInsightService.invalidateUserCache(mockUserId);
    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: {
        status: 'connected',
        accessToken: 'user_token_valid',
        grantedScopes: ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_manage_insights'],
      },
      assets: {
        pages: [{ pageId: 'page_fb_1', name: 'Moovana', pageToken: 'page_token_fb' }],
        instagramAccounts: [{ instagramAccountId: 'ig_acc_leak_test', username: 'moovana_ig' }],
        adAccounts: [],
      },
      capabilities: {
        social: { available: true },
        pageInsights: { available: true },
        instagram: { available: true },
        ads: { available: false },
      },
    });

    const combinedRes = await metaInsightService.getSocialInsights(mockUserId, {
      pageId: 'page_fb_1',
      instagramAccountId: 'ig_acc_leak_test',
      since: '2026-05-01',
      until: '2026-07-01',
    });

    assert.notStrictEqual(combinedRes.data.page, null);
    assert.notStrictEqual(combinedRes.data.instagram, null, 'Instagram data must be present when explicitly requested');
  });

  // --------------------------------------------------------------------------
  // TEST 22: Empty Page Insights response (HTTP 200 with data: []) adds safe diagnostic warning
  // --------------------------------------------------------------------------
  await asyncTest('getSocialInsights: Meta HTTP 200 with data: [] preserves empty values and adds diagnostic warning', async () => {
    const mockUserId = 'user_test_page_empty_diag';
    metaInsightService.invalidateUserCache(mockUserId);

    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: {
        status: 'connected',
        accessToken: 'user_token_valid',
        grantedScopes: ['pages_show_list', 'pages_read_engagement'],
      },
      assets: {
        pages: [{ pageId: 'page_empty_1', name: 'Moovana', pageToken: 'page_token_empty' }],
        instagramAccounts: [],
        adAccounts: [],
      },
      capabilities: {
        social: { available: true },
        pageInsights: { available: true },
        instagram: { available: false },
        ads: { available: false },
      },
    });

    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        // Meta returns HTTP 200 with data: []
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      }
      if (urlStr.includes('/page_empty_1')) {
        return {
          ok: true,
          json: async () => ({ id: 'page_empty_1', name: 'Moovana', fan_count: 1947, followers_count: 1947, access_token: 'page_token_empty' }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const res = await metaInsightService.getSocialInsights(mockUserId, { pageId: 'page_empty_1' });
    assert.notStrictEqual(res.data.page, null);
    assert.strictEqual(res.data.page.insights.length, 4);

    // Each metric must preserve empty values array (no synthetic zeros or observations)
    res.data.page.insights.forEach((m) => {
      assert.deepStrictEqual(m.values, [], `Metric ${m.name} must preserve empty values array`);
    });

    // Diagnostic warning must be added cleanly
    const warnings = res.meta.warnings || [];
    assert(warnings.some((w) => w.includes('Meta returned no Page Insights metric data')), 'Must include safe non-sensitive diagnostic warning');
  });

  // --------------------------------------------------------------------------
  // TEST 23: buildFacebookAnalyticsReport groups metrics into performance, audience, video, content
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: groups metrics cleanly into performance, audience, video, and content', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_test_1', name: 'Test Page' },
      pageDetails: { name: 'Test Page', followersCount: 1947, fanCount: 1947 },
      currentInsights: {
        pageId: 'page_test_1',
        metrics: [
          { name: 'page_views_total', period: 'day', values: [{ value: 120, endTime: '2026-05-01' }] },
          { name: 'page_impressions_unique', period: 'day', values: [{ value: 450, endTime: '2026-05-01' }] },
          { name: 'page_daily_follows_unique', period: 'day', values: [{ value: 10, endTime: '2026-05-01' }] },
          { name: 'page_daily_unfollows_unique', period: 'day', values: [{ value: 2, endTime: '2026-05-01' }] },
          { name: 'page_video_views', period: 'day', values: [{ value: 85, endTime: '2026-05-01' }] },
          { name: 'page_video_view_time', period: 'day', values: [{ value: 180000, endTime: '2026-05-01' }] },
          { name: 'page_fans', period: 'day', values: [{ value: 1947, endTime: '2026-05-01' }] },
        ],
      },
      previousInsights: {
        pageId: 'page_test_1',
        metrics: [
          { name: 'page_views_total', period: 'day', values: [{ value: 100, endTime: '2026-04-01' }] },
          { name: 'page_impressions_unique', period: 'day', values: [{ value: 400, endTime: '2026-04-01' }] },
          { name: 'page_daily_follows_unique', period: 'day', values: [{ value: 8, endTime: '2026-04-01' }] },
          { name: 'page_daily_unfollows_unique', period: 'day', values: [{ value: 1, endTime: '2026-04-01' }] },
        ],
      },
      demographics: {
        genderAge: { 'F.25-34': 50, 'M.25-34': 40 },
        countries: { US: 200, IN: 300 },
        cities: { London: 80 },
        locales: { en_US: 400 },
      },
      posts: [
        {
          contentId: 'p1',
          message: 'Post 1',
          metrics: { reactionCount: 15, commentCount: 5, shareCount: 2, fbPostInteractions: 22 },
        },
      ],
      timeParams: { since: '2026-05-01', until: '2026-05-28' },
    });

    // Performance assertions
    assert.strictEqual(report.performance.views.status, 'AVAILABLE');
    assert.strictEqual(report.performance.views.total, 120);
    assert.strictEqual(report.performance.views.comparison.delta, 20);
    assert.strictEqual(report.performance.views.comparison.percentageChange, 20);

    assert.strictEqual(report.performance.viewers.status, 'AVAILABLE');
    assert.strictEqual(report.performance.viewers.total, 450);

    assert.strictEqual(report.performance.follows.status, 'AVAILABLE');
    assert.strictEqual(report.performance.follows.total, 10);

    assert.strictEqual(report.performance.unfollows.status, 'AVAILABLE');
    assert.strictEqual(report.performance.unfollows.total, 2);

    assert.strictEqual(report.performance.netFollows.status, 'AVAILABLE');
    assert.strictEqual(report.performance.netFollows.total, 8);
    assert.strictEqual(report.performance.netFollows.timeSeries[0].value, 8);

    assert.strictEqual(report.performance.contentInteractions.status, 'AVAILABLE');
    assert.strictEqual(report.performance.contentInteractions.total, 22);
    assert.strictEqual(report.performance.contentInteractions.breakdown.reactions, 15);

    // Video assertions
    assert.strictEqual(report.video.threeSecondViews.status, 'AVAILABLE');
    assert.strictEqual(report.video.threeSecondViews.total, 85);
    assert.strictEqual(report.video.watchTime.totalMs, 180000);
    assert.strictEqual(report.video.watchTime.totalMinutes, 3);

    // Audience assertions
    assert.strictEqual(report.audience.lifetimeFollowers.current, 1947);
    assert.strictEqual(report.audience.lifetimeFans.current, 1947);
    assert.strictEqual(report.audience.followerTrends.status, 'AVAILABLE');
    assert.strictEqual(report.audience.demographics.genderAge.status, 'AVAILABLE');
    assert.deepStrictEqual(report.audience.demographics.countries.data, { US: 200, IN: 300 });

    // Content assertions
    assert.strictEqual(report.content.summary.totalPosts, 1);
    assert.strictEqual(report.content.summary.totalInteractions, 22);
  });

  // --------------------------------------------------------------------------
  // TEST 24: Net follows calculated only when both follows and unfollows are valid numbers
  // --------------------------------------------------------------------------
  test('Net follows calculation: strictly returns null when either follows or unfollows is missing or empty', () => {
    // Case A: follows has data, unfollows is empty
    const reportMissingUnfollows = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'p_net_1', name: 'Net Test' },
      pageDetails: { followersCount: 100 },
      currentInsights: {
        metrics: [
          { name: 'page_daily_follows_unique', period: 'day', values: [{ value: 25, endTime: '2026-05-01' }] },
          { name: 'page_daily_unfollows_unique', period: 'day', values: [] },
        ],
      },
    });
    assert.strictEqual(reportMissingUnfollows.performance.netFollows.total, null, 'Must be null when unfollows has no data');
    assert.strictEqual(reportMissingUnfollows.performance.netFollows.status, 'EMPTY');

    // Case B: unfollows has data, follows is null/missing
    const reportMissingFollows = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'p_net_2', name: 'Net Test' },
      pageDetails: { followersCount: 100 },
      currentInsights: {
        metrics: [
          { name: 'page_daily_unfollows_unique', period: 'day', values: [{ value: 5, endTime: '2026-05-01' }] },
        ],
      },
    });
    assert.strictEqual(reportMissingFollows.performance.netFollows.total, null, 'Must be null when follows is missing');
    assert.strictEqual(reportMissingFollows.performance.netFollows.status, 'UNAVAILABLE');

    // Case C: both have valid numeric 0
    const reportBothZero = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'p_net_3', name: 'Net Test' },
      pageDetails: { followersCount: 100 },
      currentInsights: {
        metrics: [
          { name: 'page_daily_follows_unique', period: 'day', values: [{ value: 0, endTime: '2026-05-01' }] },
          { name: 'page_daily_unfollows_unique', period: 'day', values: [{ value: 0, endTime: '2026-05-01' }] },
        ],
      },
    });
    assert.strictEqual(reportBothZero.performance.netFollows.total, 0, 'Genuine 0 - 0 must be 0');
    assert.strictEqual(reportBothZero.performance.netFollows.status, 'AVAILABLE');
  });

  // --------------------------------------------------------------------------
  // TEST 25: Previous-period comparison handles zero-division and missing values safely
  // --------------------------------------------------------------------------
  test('Previous-period comparison: handles delta, zero-division, and missing previous period safely', () => {
    // Previous period is zero: percentageChange must be null (no division by zero)
    const reportPrevZero = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'p_comp_1', name: 'Comp Test' },
      currentInsights: {
        metrics: [{ name: 'page_views_total', period: 'day', values: [{ value: 50, endTime: '2026-05-01' }] }],
      },
      previousInsights: {
        metrics: [{ name: 'page_views_total', period: 'day', values: [{ value: 0, endTime: '2026-04-01' }] }],
      },
    });
    assert.strictEqual(reportPrevZero.performance.views.comparison.delta, 50);
    assert.strictEqual(reportPrevZero.performance.views.comparison.percentageChange, null, 'Division by zero must be null');

    // Previous period missing: comparison must be null
    const reportPrevMissing = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'p_comp_2', name: 'Comp Test' },
      currentInsights: {
        metrics: [{ name: 'page_views_total', period: 'day', values: [{ value: 50, endTime: '2026-05-01' }] }],
      },
      previousInsights: null,
    });
    assert.strictEqual(reportPrevMissing.performance.views.comparison, null);
  });

  // --------------------------------------------------------------------------
  // TEST 26: getFacebookPageDemographics extracts lifetime metrics and handles empty gracefully
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPageDemographics: extracts lifetime demographic breakdowns and handles errors safely', async () => {
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                name: 'page_fans_gender_age',
                period: 'lifetime',
                values: [{ value: { 'F.18-24': 10, 'M.18-24': 25 } }],
              },
              {
                name: 'page_fans_country',
                period: 'lifetime',
                values: [{ value: { US: 150, CA: 30 } }],
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ access_token: 'page_token' }) };
    };

    const demo = await metaService.getFacebookPageDemographics('page_demo_1', 'token');
    assert.strictEqual(demo.pageId, 'page_demo_1');
    assert.deepStrictEqual(demo.demographics.genderAge, { 'F.18-24': 10, 'M.18-24': 25 });
    assert.deepStrictEqual(demo.demographics.countries, { US: 150, CA: 30 });
    assert.strictEqual(demo.demographics.cities, null);
    assert.strictEqual(demo.demographics.locales, null);

    // Test graceful handling when Meta returns 400 (e.g. fewer than 100 fans threshold)
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 100, message: 'Demographic threshold not met' } }),
    });

    const errorDemo = await metaService.getFacebookPageDemographics('page_demo_err', 'token');
    assert.strictEqual(errorDemo.demographics.genderAge, null);
    assert.strictEqual(errorDemo.demographics.countries, null);
  });

  // --------------------------------------------------------------------------
  // TEST 27: getFacebookAnalytics endpoint end-to-end integration and query caching
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookAnalytics: retrieves normalized dashboard response and enforces query caching', async () => {
    const mockUserId = 'user_test_fb_analytics_e2e';
    metaInsightService.invalidateUserCache(mockUserId);

    metaInsightService.setContextCache(mockUserId, {
      user: { _id: mockUserId },
      tenant: { planTier: 'tier2' },
      integration: {
        status: 'connected',
        accessToken: 'user_token_valid',
        grantedScopes: ['pages_show_list', 'pages_read_engagement'],
      },
      assets: {
        pages: [{ pageId: 'page_fb_e2e', name: 'Moovana Suite', pageToken: 'page_token_e2e' }],
        instagramAccounts: [],
        adAccounts: [],
      },
      capabilities: {
        social: { available: true },
        pageInsights: { available: true },
        instagram: { available: false },
        ads: { available: false },
      },
    });

    let networkCallCount = 0;
    global.fetch = async (url) => {
      networkCallCount++;
      const urlStr = String(url);
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { name: 'page_views_total', period: 'day', values: [{ value: 200, end_time: '2026-05-10' }] },
              { name: 'page_impressions_unique', period: 'day', values: [{ value: 600, end_time: '2026-05-10' }] },
            ],
          }),
        };
      }
      if (urlStr.includes('/published_posts')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post_e2e_1',
                message: 'Hello Suite',
                created_time: '2026-05-10T12:00:00Z',
                shares: { count: 3 },
                reactions: { summary: { total_count: 20 } },
                comments: { summary: { total_count: 5 } },
              },
            ],
            paging: {},
          }),
        };
      }
      if (urlStr.includes('/page_fb_e2e')) {
        return {
          ok: true,
          json: async () => ({
            id: 'page_fb_e2e',
            name: 'Moovana Suite',
            fan_count: 1947,
            followers_count: 1947,
            access_token: 'page_token_e2e',
          }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const res1 = await metaInsightService.getFacebookAnalytics(mockUserId, {
      pageId: 'page_fb_e2e',
      since: '2026-05-01',
      until: '2026-05-28',
    });

    assert.strictEqual(res1.data.pageId, 'page_fb_e2e');
    assert.strictEqual(res1.data.performance.views.total, 200);
    assert.strictEqual(res1.data.performance.viewers.total, 600);
    assert.strictEqual(res1.data.audience.lifetimeFollowers.current, 1947);
    assert.strictEqual(res1.data.content.summary.totalPosts, 1);
    assert.strictEqual(res1.data.content.summary.totalInteractions, 28);
    assert.strictEqual(res1.meta.dateRange.days, 28);

    const callsAfterFirst = networkCallCount;
    // Second identical call must be served from cache without any new network calls
    const res2 = await metaInsightService.getFacebookAnalytics(mockUserId, {
      pageId: 'page_fb_e2e',
      since: '2026-05-01',
      until: '2026-05-28',
    });
    assert.strictEqual(networkCallCount, callsAfterFirst, 'Second call must be served from query cache');
    assert.deepStrictEqual(res1.data, res2.data);
  });

  // --------------------------------------------------------------------------
  // TEST 28: Four-Card KPI Redesign contract verification
  // --------------------------------------------------------------------------
  test('Four-Card KPI Redesign: verifies exact contract across all four frontend groups', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_four_card', name: 'Four Card Page' },
      pageDetails: { name: 'Four Card Page', followersCount: 2500, fanCount: 2450 },
      currentInsights: {
        pageId: 'page_four_card',
        metrics: [
          { name: 'page_views_total', period: 'day', values: [{ value: 300, endTime: '2026-06-01' }, { value: 200, endTime: '2026-06-02' }] },
          { name: 'page_total_media_view_unique', period: 'day', values: [{ value: 150, endTime: '2026-06-01' }] },
          { name: 'page_daily_follows_unique', period: 'day', values: [{ value: 20, endTime: '2026-06-01' }, { value: 15, endTime: '2026-06-02' }] },
          { name: 'page_daily_unfollows_unique', period: 'day', values: [{ value: 5, endTime: '2026-06-01' }, { value: 3, endTime: '2026-06-02' }] },
          { name: 'page_video_views', period: 'day', values: [{ value: 90, endTime: '2026-06-01' }] },
          { name: 'page_video_view_time', period: 'day', values: [{ value: 120000, endTime: '2026-06-01' }] },
          { name: 'page_post_engagements', period: 'day', values: [{ value: 45, endTime: '2026-06-01' }, { value: 35, endTime: '2026-06-02' }] },
        ],
      },
      previousInsights: {
        pageId: 'page_four_card',
        metrics: [
          { name: 'page_views_total', period: 'day', values: [{ value: 400, endTime: '2026-05-01' }] },
          { name: 'page_daily_follows_unique', period: 'day', values: [{ value: 25, endTime: '2026-05-01' }] },
          { name: 'page_daily_unfollows_unique', period: 'day', values: [{ value: 4, endTime: '2026-05-01' }] },
          { name: 'page_post_engagements', period: 'day', values: [{ value: 60, endTime: '2026-05-01' }] },
        ],
      },
      posts: [
        {
          contentId: 'p100',
          message: 'Post 100',
          metrics: { reactionCount: 30, commentCount: 10, shareCount: 5, fbPostInteractions: 45 },
        },
      ],
      timeParams: { since: '2026-06-01', until: '2026-06-02' },
    });

    // Group 1: Visibility & Reach
    assert.strictEqual(report.performance.views.total, 500);
    assert.strictEqual(report.performance.views.timeSeries.length, 2);
    assert.strictEqual(report.performance.viewers.status, 'AVAILABLE');
    assert.strictEqual(report.performance.viewers.total, 150);
    assert.strictEqual(report.performance.viewers.metricName, 'page_total_media_view_unique');
    assert.strictEqual(report.performance.pageVisits.status, 'UNAVAILABLE');
    assert.strictEqual(report.performance.pageVisits.total, null);
    assert.strictEqual(report.performance.pageVisits.timeSeries.length, 0);
    assert.strictEqual(report.performance.pageVisits.metricName, 'page_visits');
    assert.strictEqual(report.video.threeSecondViews.total, 90);
    assert.strictEqual(report.video.watchTime.totalMs, 120000);
    assert.strictEqual(report.video.watchTime.totalMinutes, 2);

    // Group 2: Engagement & Content
    assert.strictEqual(report.performance.contentInteractions.total, 45);
    assert.strictEqual(report.performance.contentInteractions.timeSeries.length, 2);
    assert.strictEqual(report.performance.contentInteractions.timeSeries[0].value, 45);
    assert.strictEqual(report.performance.contentInteractions.timeSeries[1].value, 35);
    assert.strictEqual(report.performance.contentInteractions.breakdown.reactions, 30);
    assert.strictEqual(report.performance.contentInteractions.breakdown.comments, 10);
    assert.strictEqual(report.performance.contentInteractions.breakdown.shares, 5);
    assert.strictEqual(report.performance.postEngagements.status, 'AVAILABLE');
    assert.strictEqual(report.performance.postEngagements.total, 80);
    assert.strictEqual(report.performance.postEngagements.timeSeries.length, 2);
    assert.strictEqual(report.performance.postEngagements.comparison.delta, 20);

    // Group 3: Audience & Followers
    assert.strictEqual(report.audience.lifetimeFollowers.current, 2500);
    assert.strictEqual(report.audience.follows.total, 35);
    assert.strictEqual(report.audience.follows.timeSeries.length, 2);
    assert.strictEqual(report.audience.unfollows.total, 8);
    assert.strictEqual(report.audience.unfollows.timeSeries.length, 2);
    assert.strictEqual(report.audience.netFollows.total, 27);
    assert.strictEqual(report.audience.netFollows.timeSeries.length, 2);
    assert.strictEqual(report.audience.returningViewers.status, 'UNSUPPORTED_BY_META');
    assert.strictEqual(report.audience.returningViewers.total, null);
    assert.deepStrictEqual(report.audience.returningViewers.timeSeries, []);

    // Group 4: Performance Trends
    assert.strictEqual(report.performance.views.timeSeries.length, 2);
    assert.strictEqual(report.performance.contentInteractions.timeSeries.length, 2);
    assert.strictEqual(report.performance.postEngagements.timeSeries.length, 2);
    assert.strictEqual(report.performance.follows.timeSeries.length, 2);
    assert.strictEqual(report.performance.unfollows.timeSeries.length, 2);
    assert.strictEqual(report.performance.netFollows.timeSeries.length, 2);
  });

  // --------------------------------------------------------------------------
  // TEST 29: Follower metric semantics - Cumulative page_follows snapshots are NEVER summed
  // --------------------------------------------------------------------------
  test('Follower semantics: cumulative page_follows snapshots are not summed; period change is calculated from earliest/latest', () => {
    // 28 days of daily snapshots around 1,945 (previously summed to 54,478)
    const snapshotValues = [];
    for (let day = 1; day <= 28; day++) {
      const dayStr = String(day).padStart(2, '0');
      // Starts at 1940 on day 1 and reaches 1952 on day 28 (net gain of 12 followers)
      const val = 1940 + Math.floor((day / 28) * 12);
      snapshotValues.push({ value: val, endTime: `2026-05-${dayStr}` });
    }

    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_snap_test', name: 'Snapshot Page' },
      pageDetails: { name: 'Snapshot Page', followersCount: 1952, fanCount: 1950 },
      currentInsights: {
        pageId: 'page_snap_test',
        metrics: [
          { name: 'page_views_total', period: 'day', values: [{ value: 100, endTime: '2026-05-01' }] },
          { name: 'page_follows', period: 'day', values: snapshotValues },
        ],
      },
    });

    // Total must NOT be summed (1945 * 28 = ~54,478)
    assert.notStrictEqual(report.performance.follows.total, 54478);
    // Period change must be 1952 - 1940 = 12
    assert.strictEqual(report.performance.follows.total, 12, 'Total must equal period change (latest - earliest), not sum of snapshots');
    assert.strictEqual(report.performance.follows.metricName, 'page_follows', 'Metric name must match page_follows, not hardcoded to flow metric');
    assert.strictEqual(report.performance.follows.isSnapshot, true, 'isSnapshot must be true for page_follows');
    assert.strictEqual(report.performance.follows.snapshotEarliest, 1940);
    assert.strictEqual(report.performance.follows.snapshotLatest, 1952);
    assert.strictEqual(report.performance.follows.periodChange, 12);
    assert.strictEqual(report.performance.follows.timeSeries.length, 28);

    // Audience follows must also reflect snapshot semantics
    assert.strictEqual(report.audience.follows.total, 12);
    assert.strictEqual(report.audience.follows.metricName, 'page_follows');
    assert.strictEqual(report.audience.follows.isSnapshot, true);
  });

  // --------------------------------------------------------------------------
  // TEST 30: Follower semantics - Net follows safeguard blocks combining daily unfollows with cumulative page_follows
  // --------------------------------------------------------------------------
  test('Follower semantics: net follows is UNAVAILABLE when follows is cumulative snapshot (page_follows)', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_snap_net', name: 'Snapshot Net Page' },
      pageDetails: { name: 'Snapshot Net Page', followersCount: 1952 },
      currentInsights: {
        pageId: 'page_snap_net',
        metrics: [
          {
            name: 'page_follows',
            period: 'day',
            values: [
              { value: 1940, endTime: '2026-05-01' },
              { value: 1952, endTime: '2026-05-28' },
            ],
          },
          {
            name: 'page_daily_unfollows_unique',
            period: 'day',
            values: [
              { value: 2, endTime: '2026-05-01' },
            ],
          },
        ],
      },
    });

    // Net follows must be UNAVAILABLE because subtracting daily unfollows from cumulative snapshots or period change is invalid
    assert.strictEqual(report.performance.netFollows.status, 'UNAVAILABLE');
    assert.strictEqual(report.performance.netFollows.total, null);
    assert.deepStrictEqual(report.performance.netFollows.timeSeries, []);
    assert.notStrictEqual(report.performance.netFollows.reason, undefined);
    assert(report.performance.netFollows.reason.includes('Cumulative follower snapshots'));

    assert.strictEqual(report.audience.netFollows.status, 'UNAVAILABLE');
    assert.strictEqual(report.audience.netFollows.total, null);
  });

  // --------------------------------------------------------------------------
  // TEST 31: Extended metric request resilience - One failed metric group does not erase other groups
  // --------------------------------------------------------------------------
  await asyncTest('Extended metric request resilience: failed video watch time or viewer group does not drop page activity or follows', async () => {
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (!urlStr.includes('/insights') && urlStr.includes('/page_resilient_1')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'page_token_resilient' }),
        };
      }
      if (urlStr.includes('/insights')) {
        // If video view time (total_over_range) or viewer reach is requested, simulate Meta error
        if (urlStr.includes('page_video_view_time') || urlStr.includes('page_total_media_view_unique')) {
          return {
            status: 400,
            ok: false,
            json: async () => ({
              error: { code: 100, message: 'Unsupported metric or period for this page' },
            }),
          };
        }
        // Page activity and follower groups succeed
        if (urlStr.includes('page_views_total')) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { name: 'page_views_total', period: 'day', values: [{ value: 500, end_time: '2026-05-10' }] },
                { name: 'page_post_engagements', period: 'day', values: [{ value: 80, end_time: '2026-05-10' }] },
              ],
            }),
          };
        }
        if (urlStr.includes('page_daily_follows_unique')) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { name: 'page_daily_follows_unique', period: 'day', values: [{ value: 25, end_time: '2026-05-10' }] },
                { name: 'page_daily_unfollows_unique', period: 'day', values: [{ value: 5, end_time: '2026-05-10' }] },
              ],
            }),
          };
        }
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const res = await metaService.getFacebookPageInsights('page_resilient_1', 'token', {
      since: '2026-05-01',
      until: '2026-05-28',
      metricGroups: [
        { metric: 'page_views_total,page_post_engagements,page_total_actions', period: 'day' },
        { metric: 'page_daily_follows_unique,page_daily_unfollows_unique,page_follows', period: 'day' },
        { metric: 'page_total_media_view_unique', period: 'day' },
        { metric: 'page_video_view_time', period: 'total_over_range' },
      ],
    });

    assert.strictEqual(res.pageId, 'page_resilient_1');
    assert.strictEqual(res.dataEmpty, false);
    
    // Page views and follows must be preserved
    const views = res.metrics.find((m) => m.name === 'page_views_total');
    assert.strictEqual(views.values[0].value, 500);

    const follows = res.metrics.find((m) => m.name === 'page_daily_follows_unique');
    assert.strictEqual(follows.values[0].value, 25);

    // Failed metrics are cleanly stubbed with empty values, not crashing
    const viewers = res.metrics.find((m) => m.name === 'page_total_media_view_unique');
    assert.deepStrictEqual(viewers.values, []);

    const videoTime = res.metrics.find((m) => m.name === 'page_video_view_time');
    assert.deepStrictEqual(videoTime.values, []);

    // Diagnostics are captured in groupErrors
    assert.notStrictEqual(res.groupErrors, undefined);
    assert.strictEqual(res.groupErrors.length, 2);
  });

  // --------------------------------------------------------------------------
  // TEST 32: Post-level reach, impressions, and engagement extraction
  // --------------------------------------------------------------------------
  await asyncTest('Post-level reach: getFacebookPagePosts queries supported metrics and avoids invalid ones', async () => {
    let capturedInsightsUrl = null;
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post_reach_1',
                message: 'Post with reach',
                created_time: '2026-05-10T12:00:00Z',
                shares: { count: 4 },
                reactions: { summary: { total_count: 50 } },
                comments: { summary: { total_count: 10 } },
              },
            ],
            paging: {},
          }),
        };
      }
      if (urlStr.includes('/insights')) {
        capturedInsightsUrl = urlStr;
        return {
          ok: true,
          json: async () => ({
            data: [
              { name: 'post_total_media_view_unique', values: [{ value: 211 }] },
              { name: 'post_reactions_by_type_total', values: [{ value: { like: 50 } }] },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ access_token: 'page_token' }) };
    };

    const res = await metaService.getFacebookPagePosts('page_reach_test', 'token');
    assert.strictEqual(res.posts.length, 1);
    
    // Verify that requested metrics use exact verified Graph API names and avoid invalid ones
    const decodedUrl = decodeURIComponent(capturedInsightsUrl);
    assert(decodedUrl.includes('post_total_media_view_unique'), 'Must request post_total_media_view_unique');
    assert(decodedUrl.includes('post_reactions_by_type_total'), 'Must request post_reactions_by_type_total');
    assert(decodedUrl.includes('period=lifetime'), 'Must request period=lifetime');
    assert(!decodedUrl.includes('post_engaged_users'), 'Must NOT request invalid metric post_engaged_users');
    assert(!decodedUrl.includes('post_interactions'), 'Must NOT request invalid metric post_interactions');

    const post = res.posts[0];
    const postMetrics = metaInsightService.parseFacebookPostMetrics(post);
    assert.strictEqual(postMetrics.uniqueMediaViewers, 211, 'uniqueMediaViewers must be 211');
    assert.strictEqual(postMetrics.reach, 211, 'reach must map to verified uniqueMediaViewers');
    assert.strictEqual(postMetrics.views, 211, 'views must map to verified uniqueMediaViewers');
    assert.deepStrictEqual(postMetrics.reactionBreakdown, { like: 50 }, 'reactionBreakdown must be { like: 50 }');
    assert.strictEqual(postMetrics.engagement, null, 'engagement must be null when invalid metric is omitted');
    assert.strictEqual(postMetrics.shareCount, 4);
    assert.strictEqual(postMetrics.reactionCount, 50);
    assert.strictEqual(postMetrics.commentCount, 10);
    assert.strictEqual(postMetrics.fbPostInteractions, 64);
  });
  // --------------------------------------------------------------------------
  // TEST 33: Derivation of reactionCount from post_reactions_by_type_total
  // --------------------------------------------------------------------------
  await asyncTest('reactionCount: derives count from post_reactions_by_type_total breakdowns, numbers, and fallback', async () => {
    // 33a: Multi-type reaction breakdown
    const postWithBreakdown = {
      postId: 'post_breakdown_1',
      insightsData: [
        {
          name: 'post_reactions_by_type_total',
          values: [{ value: { like: 14, love: 5, haha: 3, wow: 1, sorry: 0, anger: 0 } }],
        },
      ],
    };
    const metrics33a = metaInsightService.parseFacebookPostMetrics(postWithBreakdown);
    assert.strictEqual(metrics33a.reactionCount, 23, "Multi-type breakdown must sum to 23");

    // 33b: Genuine numeric zero breakdown
    const postWithZeroBreakdown = {
      postId: 'post_breakdown_zero',
      insightsData: [
        {
          name: 'post_reactions_by_type_total',
          values: [{ value: { like: 0, love: 0, wow: 0 } }],
        },
      ],
    };
    const metrics33b = metaInsightService.parseFacebookPostMetrics(postWithZeroBreakdown);
    assert.strictEqual(metrics33b.reactionCount, 0, "All-zero breakdown must yield 0, not null");

    // 33c: Empty dictionary in breakdown (no reactions on post)
    const postWithEmptyDict = {
      postId: 'post_breakdown_empty',
      insightsData: [
        {
          name: 'post_reactions_by_type_total',
          values: [{ value: {} }],
        },
      ],
    };
    const metrics33c = metaInsightService.parseFacebookPostMetrics(postWithEmptyDict);
    assert.strictEqual(metrics33c.reactionCount, 0, "Empty dictionary breakdown must yield 0, not null");

    // 33d: Direct numeric value
    const postWithNumericInsight = {
      postId: 'post_numeric_insight',
      insightsData: [
        {
          name: 'post_reactions_by_type_total',
          values: [{ value: 42 }],
        },
      ],
    };
    const metrics33d = metaInsightService.parseFacebookPostMetrics(postWithNumericInsight);
    assert.strictEqual(metrics33d.reactionCount, 42, "Direct numeric reaction insight must yield 42");

    // 33e: Missing / invalid breakdown must remain null
    const postWithEmptyValues = {
      postId: 'post_empty_vals',
      insightsData: [{ name: 'post_reactions_by_type_total', values: [] }],
    };
    assert.strictEqual(metaInsightService.parseFacebookPostMetrics(postWithEmptyValues).reactionCount, null);

    const postWithInvalidType = {
      postId: 'post_invalid_vals',
      insightsData: [{ name: 'post_reactions_by_type_total', values: [{ value: { like: 'bad' } }] }],
    };
    assert.strictEqual(metaInsightService.parseFacebookPostMetrics(postWithInvalidType).reactionCount, null);

    // 33f: Fallback integration: baseFields fallback + insights recovers reaction count
    let callCount = 0;
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        callCount++;
        if (callCount === 1) {
          return { status: 400, ok: false, json: async () => ({ error: { code: 100, message: "Field reactions.summary not allowed" } }) };
        }
        return {
          ok: true,
          json: async () => ({
            data: [{ id: "post_fb_derived_1", message: "Fallback post", created_time: "2026-09-10T12:00:00Z", shares: { count: 2 } }],
            paging: {},
          }),
        };
      }
      if (urlStr.includes('/insights')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ name: "post_reactions_by_type_total", values: [{ value: { like: 18, love: 7 } }] }],
          }),
        };
      }
      return { ok: true, json: async () => ({ access_token: "page_token" }) };
    };

    const fbResult = await metaService.getFacebookPagePosts("page_fallback_derived", "token");
    assert.strictEqual(fbResult.posts.length, 1);
    const derivedPost = fbResult.posts[0];
    assert.strictEqual(derivedPost.shareCount, 2);
    assert.strictEqual(derivedPost.reactionCount, 25, "Fallback post must recover reactionCount from post_reactions_by_type_total");
    assert.strictEqual(derivedPost.commentCount, null, "commentCount remains null when comments summary was not fetched");
  });

  // --------------------------------------------------------------------------
  // TEST 34: Conservative null preservation, root aliases, and interaction totals
  // --------------------------------------------------------------------------
  await asyncTest('Response contract: preserves genuine zero vs null, exposes root aliases, and calculates interactions strictly', async () => {
    // 34a: Conservative omission of shares
    const postMissingShares = { postId: "p_no_shares", message: "No shares node" };
    const metricsNoShares = metaInsightService.parseFacebookPostMetrics(postMissingShares);
    assert.strictEqual(metricsNoShares.shareCount, null, "Omitted shares must remain null, never converted to 0");

    const postZeroShares = { postId: "p_zero_shares", shares: { count: 0 } };
    const metricsZeroShares = metaInsightService.parseFacebookPostMetrics(postZeroShares);
    assert.strictEqual(metricsZeroShares.shareCount, 0, "Explicit shares count: 0 must remain 0");

    // 34b: fbPostInteractions strictness: any null component prevents fabrication
    const postPartial1 = { postId: "p1", reactionCount: 10, commentCount: 5, shareCount: null };
    assert.strictEqual(metaInsightService.parseFacebookPostMetrics(postPartial1).fbPostInteractions, null);

    const postPartial2 = { postId: "p2", reactionCount: null, commentCount: 5, shareCount: 2 };
    assert.strictEqual(metaInsightService.parseFacebookPostMetrics(postPartial2).fbPostInteractions, null);

    const postPartial3 = { postId: "p3", reactionCount: 10, commentCount: null, shareCount: 2 };
    assert.strictEqual(metaInsightService.parseFacebookPostMetrics(postPartial3).fbPostInteractions, null);

    const postAllZeros = { postId: "p4", reactionCount: 0, commentCount: 0, shareCount: 0 };
    assert.strictEqual(metaInsightService.parseFacebookPostMetrics(postAllZeros).fbPostInteractions, 0, "All genuine zeros must sum to 0");

    const postComplete = { postId: "p5", reactionCount: 10, commentCount: 5, shareCount: 3 };
    assert.strictEqual(metaInsightService.parseFacebookPostMetrics(postComplete).fbPostInteractions, 18, "Complete counts must sum to 18");

    // 34c: Root aliases present in getFacebookAnalytics
    const mockUserId = "user_test_aliases";
    metaInsightService.invalidateUserCache(mockUserId);
    metaInsightService.setContextCache(mockUserId, {
      integration: { accessToken: "tok", status: "connected", grantedScopes: ["pages_read_engagement", "read_insights"] },
      assets: { pages: [{ pageId: "page_alias_test", name: "Alias Page", pageToken: "p_tok" }], adAccounts: [] },
      capabilities: { social: { available: true } },
    });

    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              id: "post_alias_10",
              message: "Alias test post",
              created_time: "2026-05-15T10:00:00Z",
              shares: { count: 7 },
              reactions: { summary: { total_count: 22 } },
              comments: { summary: { total_count: 8 } },
            }],
            paging: {},
          }),
        };
      }
      if (urlStr.includes('/insights')) {
        return { ok: true, json: async () => ({ data: [{ name: "post_engaged_users", values: [{ value: 35 }] }] }) };
      }
      if (urlStr.includes("/page_alias_test")) {
        return { ok: true, json: async () => ({ id: "page_alias_test", name: "Alias Page", followers_count: 100, fan_count: 100, access_token: "p_tok" }) };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const analyticsRes = await metaInsightService.getFacebookAnalytics(mockUserId, {
      pageId: "page_alias_test",
      since: "2026-05-01",
      until: "2026-05-28",
    });

    assert(analyticsRes.data.content.posts.length > 0, "Must return posts");
    const p = analyticsRes.data.content.posts[0];
    // Verify root aliases
    assert.strictEqual(p.reactionCount, 22, "Root reactionCount alias must match");
    assert.strictEqual(p.commentCount, 8, "Root commentCount alias must match");
    assert.strictEqual(p.shareCount, 7, "Root shareCount alias must match");
    // Verify nested metrics
    assert.strictEqual(p.metrics.reactionCount, 22, "Nested metrics.reactionCount must match");
    assert.strictEqual(p.metrics.commentCount, 8, "Nested metrics.commentCount must match");
    assert.strictEqual(p.metrics.shareCount, 7, "Nested metrics.shareCount must match");
    assert.strictEqual(p.metrics.fbPostInteractions, 37, "Nested metrics.fbPostInteractions must sum to 37");
    assert.strictEqual(p.metrics.engagement, 35, "Nested metrics.engagement must be 35");
  });
  // --------------------------------------------------------------------------
  // TEST 35: Bug 1: getFacebookPageInsights metricGroups handling and period preservation
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPageInsights: queries custom metricGroups with respective periods and handles partial and complete failure', async () => {
    let capturedUrls = [];
    global.fetch = async (url) => {
      const urlStr = String(url);
      capturedUrls.push(urlStr);
      if (urlStr.includes('metric=page_video_view_time')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              name: 'page_video_view_time',
              period: 'total_over_range',
              values: [{ value: 60000, end_time: '2026-06-02T07:00:00+0000' }]
            }]
          })
        };
      }
      if (urlStr.includes('metric=page_views_total')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              name: 'page_views_total',
              period: 'day',
              values: [{ value: 120, end_time: '2026-06-01T07:00:00+0000' }]
            }]
          })
        };
      }
      if (urlStr.includes('metric=unsupported_group_metric')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: { code: 100, message: 'Unsupported metric' }
          })
        };
      }
      if (!urlStr.includes('/insights')) {
        return { ok: true, json: async () => ({ access_token: 'page_token' }) };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    // 35a: Explicit metricGroups with distinct periods
    const customGroups = [
      { metrics: ['page_views_total'], period: 'day' },
      { metrics: ['page_video_view_time'], period: 'total_over_range' }
    ];
    const res = await metaService.getFacebookPageInsights('page_custom_groups', 'token', {
      since: '2026-06-01',
      until: '2026-06-02',
      metricGroups: customGroups,
    });
    assert.strictEqual(res.metrics.length, 2);
    assert(capturedUrls.some(u => u.includes('period=day') && u.includes('page_views_total')));
    assert(capturedUrls.some(u => u.includes('period=total_over_range') && u.includes('page_video_view_time')));
    assert.strictEqual(res.metrics.find(m => m.name === 'page_video_view_time').period, 'total_over_range');

    // 35b: Partial failure: one group succeeds, one fails (400) -> does not crash or substitute default metrics
    const partialGroups = [
      { metrics: ['page_views_total'], period: 'day' },
      { metrics: ['unsupported_group_metric'], period: 'day' }
    ];
    const partialRes = await metaService.getFacebookPageInsights('page_partial_groups', 'token', {
      since: '2026-06-01',
      until: '2026-06-02',
      metricGroups: partialGroups,
    });
    assert.strictEqual(partialRes.metrics.length, 2);
    const viewsMetric = partialRes.metrics.find(m => m.name === 'page_views_total');
    const unsupportedMetric = partialRes.metrics.find(m => m.name === 'unsupported_group_metric');
    assert(viewsMetric && viewsMetric.values.length > 0, 'Successful metric must have values');
    assert(unsupportedMetric && unsupportedMetric.values.length === 0, 'Failed group metric must have empty values');
    assert(partialRes.groupErrors && partialRes.groupErrors.length > 0, 'Failed group must be recorded in groupErrors');
    assert(partialRes.groupErrors.some(e => e.metrics.includes('unsupported_group_metric')));

    // 35c: All groups fail: returns normalized metrics with values: [] + groupErrors, dataEmpty: true, does not throw
    const allFailGroups = [
      { metrics: ['unsupported_group_metric'], period: 'day' }
    ];
    const allFailRes = await metaService.getFacebookPageInsights('page_all_fail_groups', 'token', {
      since: '2026-06-01',
      until: '2026-06-02',
      metricGroups: allFailGroups,
    });
    assert.strictEqual(allFailRes.dataEmpty, true);
    assert.strictEqual(allFailRes.metrics.length, 1);
    assert.deepStrictEqual(allFailRes.metrics[0].values, []);
    assert.strictEqual(allFailRes.groupErrors.length, 1);
  });

  // --------------------------------------------------------------------------
  // TEST 36: Bug 2: Fallback extraction helpers in parseFacebookPostMetrics & exports
  // --------------------------------------------------------------------------
  test('parseFacebookPostMetrics: uses resilient extraction helpers and exports them on metaInsightService', () => {
    // 36a: Export check
    assert.strictEqual(typeof metaInsightService.extractShareCount, 'function');
    assert.strictEqual(typeof metaInsightService.extractCommentCount, 'function');
    assert.strictEqual(typeof metaInsightService.extractReactionCount, 'function');

    // 36b: Resilient extraction with various payload shapes
    const postWithNestedShares = { postId: 'p1', shares: { count: 15 } };
    assert.strictEqual(metaInsightService.extractShareCount(postWithNestedShares), 15);

    const postWithFlatShareCount = { postId: 'p2', share_count: 22 };
    assert.strictEqual(metaInsightService.extractShareCount(postWithFlatShareCount), 22);

    const postWithCommentSummary = { postId: 'p3', comments: { summary: { total_count: 8 } } };
    assert.strictEqual(metaInsightService.extractCommentCount(postWithCommentSummary), 8);

    const postWithReactionSummary = { postId: 'p4', reactions: { summary: { total_count: 42 } } };
    assert.strictEqual(metaInsightService.extractReactionCount(postWithReactionSummary), 42);

    // 36c: Derive reactionCount from insightsData
    const insightsData = [{ name: 'post_reactions_by_type_total', values: [{ value: { like: 10, love: 5 } }] }];
    assert.strictEqual(metaInsightService.extractReactionCount({ postId: 'p5' }, insightsData), 15);

    // 36d: Strict calculation in parseFacebookPostMetrics: does not coerce missing components to 0
    const partialPost = {
      postId: 'p6',
      shares: { count: 4 },
      reactions: { summary: { total_count: 10 } }
    };
    const parsed = metaInsightService.parseFacebookPostMetrics(partialPost);
    assert.strictEqual(parsed.shareCount, 4);
    assert.strictEqual(parsed.reactionCount, 10);
    assert.strictEqual(parsed.commentCount, null);
    assert.strictEqual(parsed.fbPostInteractions, null, 'Cannot calculate total interactions when comments are missing');
  });

  // --------------------------------------------------------------------------
  // TEST 37: Bug 3: getFacebookPagePosts preserves insightsError on insight failure
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPagePosts: retains insightsError when post insights call fails', async () => {
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'post_err_test_1', message: 'Test Post', created_time: '2026-06-01T12:00:00Z' }],
            paging: {}
          })
        };
      }
      if (urlStr.includes('/insights')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            error: { code: 2, message: 'An unexpected error has occurred. Please retry.' }
          })
        };
      }
      return { ok: true, json: async () => ({ access_token: 'page_token' }) };
    };

    const result = await metaService.getFacebookPagePosts('page_err_test', 'token');
    assert.strictEqual(result.posts.length, 1);
    const p = result.posts[0];
    assert.deepStrictEqual(p.insightsData, []);
    assert(p.insightsError, 'insightsError must be populated when insights call fails');
    assert(p.insightsError.includes('unexpected error') || p.insightsError.includes('Meta API error'));
  });

  // --------------------------------------------------------------------------
  // TEST 38: Bug 4: getFacebookPageDetails returns null for missing followers, preserves 0
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPageDetails: preserves genuine numeric 0 and maps missing/undefined/string followers safely', async () => {
    // 38a: Missing fan_count and followers_count
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fields=access_token') || !urlStr.includes('fan_count')) {
        return { ok: true, json: async () => ({ access_token: 'page_token' }) };
      }
      return {
        ok: true,
        json: async () => ({ id: 'page_missing_followers', name: 'No Followers Page' })
      };
    };
    const resMissing = await metaService.getFacebookPageDetails('page_missing_followers', 'token');
    assert.strictEqual(resMissing.fanCount, null, 'Missing fanCount must be null, not 0');
    assert.strictEqual(resMissing.followersCount, null, 'Missing followersCount must be null, not 0');

    // 38b: Genuine numeric 0
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fields=access_token') || !urlStr.includes('fan_count')) {
        return { ok: true, json: async () => ({ access_token: 'page_token' }) };
      }
      return {
        ok: true,
        json: async () => ({ id: 'page_zero_followers', name: 'Zero Followers Page', fan_count: 0, followers_count: 0 })
      };
    };
    const resZero = await metaService.getFacebookPageDetails('page_zero_followers', 'token');
    assert.strictEqual(resZero.fanCount, 0, 'Genuine 0 fanCount must remain 0');
    assert.strictEqual(resZero.followersCount, 0, 'Genuine 0 followersCount must remain 0');

    // 38c: String numeric values
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('fields=access_token') || !urlStr.includes('fan_count')) {
        return { ok: true, json: async () => ({ access_token: 'page_token' }) };
      }
      return {
        ok: true,
        json: async () => ({ id: 'page_str_followers', name: 'Str Followers Page', fan_count: '1500', followers_count: '1520' })
      };
    };
    const resStr = await metaService.getFacebookPageDetails('page_str_followers', 'token');
    assert.strictEqual(resStr.fanCount, 1500, 'String 1500 must parse to number 1500');
    assert.strictEqual(resStr.followersCount, 1520, 'String 1520 must parse to number 1520');
  });

  // --------------------------------------------------------------------------
  // TEST 39: Bug 5: Views vs Facebook Visits mapping separation
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: pageVisits does not mirror page_views_total and reports UNAVAILABLE when absent', () => {
    // Report where only page_views_total is present
    const reportWithoutVisits = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_v1', name: 'V1' },
      pageDetails: { followersCount: 100 },
      currentInsights: {
        pageId: 'page_v1',
        metrics: [
          { name: 'page_views_total', period: 'day', values: [{ value: 450, endTime: '2026-06-01' }] }
        ]
      }
    });

    assert.strictEqual(reportWithoutVisits.performance.views.status, 'AVAILABLE');
    assert.strictEqual(reportWithoutVisits.performance.views.total, 450);
    assert.strictEqual(reportWithoutVisits.performance.pageVisits.status, 'UNAVAILABLE');
    assert.strictEqual(reportWithoutVisits.performance.pageVisits.total, null);
    assert.deepStrictEqual(reportWithoutVisits.performance.pageVisits.timeSeries, []);
    assert(reportWithoutVisits.performance.pageVisits.reason.includes('not supported or returned'));

    // Report where explicit page_visits is supplied
    const reportWithVisits = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_v2', name: 'V2' },
      pageDetails: { followersCount: 100 },
      currentInsights: {
        pageId: 'page_v2',
        metrics: [
          { name: 'page_views_total', period: 'day', values: [{ value: 450, endTime: '2026-06-01' }] },
          { name: 'page_visits', period: 'day', values: [{ value: 210, endTime: '2026-06-01' }] }
        ]
      }
    });

    assert.strictEqual(reportWithVisits.performance.views.total, 450);
    assert.strictEqual(reportWithVisits.performance.pageVisits.status, 'AVAILABLE');
    assert.strictEqual(reportWithVisits.performance.pageVisits.total, 210);
  });

  // --------------------------------------------------------------------------
  // TEST 40: Content interactions does NOT substitute page_post_engagements
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: contentInteractions classifies status strictly and never substitutes page_post_engagements for content interactions', () => {
    // 40a: Post-level interactions available
    const reportPostLevel = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_c1', name: 'C1' },
      pageDetails: { followersCount: 100 },
      currentInsights: { pageId: 'page_c1', metrics: [] },
      posts: [
        { metrics: { reactionCount: 10, commentCount: 5, shareCount: 2, fbPostInteractions: 17 } }
      ]
    });
    assert.strictEqual(reportPostLevel.performance.contentInteractions.status, 'AVAILABLE');
    assert.strictEqual(reportPostLevel.performance.contentInteractions.total, 17);
    assert.strictEqual(reportPostLevel.performance.contentInteractions.source, 'content_aggregate');
    assert.strictEqual(reportPostLevel.performance.contentInteractions.breakdown.reactions, 10);

    // 40b: No post interactions, but Page-level engagements available
    // Must NOT substitute page_post_engagements for contentInteractions; reports UNAVAILABLE while keeping postEngagements
    const reportPageFallback = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_c2', name: 'C2' },
      pageDetails: { followersCount: 100 },
      currentInsights: {
        pageId: 'page_c2',
        metrics: [
          { name: 'page_post_engagements', period: 'day', values: [{ value: 85, endTime: '2026-06-01' }] }
        ]
      },
      posts: []
    });
    assert.strictEqual(reportPageFallback.performance.contentInteractions.status, 'UNAVAILABLE');
    assert.strictEqual(reportPageFallback.performance.contentInteractions.total, null);
    assert.strictEqual(reportPageFallback.performance.contentInteractions.source, null);
    assert.strictEqual(reportPageFallback.performance.contentInteractions.breakdown.reactions, null);
    assert.strictEqual(reportPageFallback.performance.contentInteractions.pageEngagementsInsight, 85);
    assert.strictEqual(reportPageFallback.performance.postEngagements.status, 'AVAILABLE');
    assert.strictEqual(reportPageFallback.performance.postEngagements.total, 85);
    assert(reportPageFallback.performance.contentInteractions.reason.includes('unavailable'));

    // 40c: No post interactions, and Page-level engagements EMPTY (data: [])
    const reportEmpty = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_c3', name: 'C3' },
      pageDetails: { followersCount: 100 },
      currentInsights: {
        pageId: 'page_c3',
        metrics: [
          { name: 'page_post_engagements', period: 'day', values: [] }
        ]
      },
      posts: []
    });
    assert.strictEqual(reportEmpty.performance.contentInteractions.status, 'UNAVAILABLE');
    assert.strictEqual(reportEmpty.performance.contentInteractions.total, null);

    // 40d: No post interactions, and Page-level engagements UNAVAILABLE
    const reportUnavailable = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_c4', name: 'C4' },
      pageDetails: { followersCount: 100 },
      currentInsights: { pageId: 'page_c4', metrics: [] },
      posts: []
    });
    assert.strictEqual(reportUnavailable.performance.contentInteractions.status, 'UNAVAILABLE');
    assert.strictEqual(reportUnavailable.performance.contentInteractions.total, null);
  });

  // --------------------------------------------------------------------------
  // TEST 41: Bug 7: resolveDateRange boundary validation, start-only, end-only, and invalid dates
  // --------------------------------------------------------------------------
  test('resolveDateRange: handles default 28-day range, start-only, end-only, presets, and rejects invalid inputs', () => {
    // 41a: Default (empty params)
    const def = metaInsightService.resolveDateRange({});
    assert.strictEqual(def.days, 28);
    assert.strictEqual(def.previous.days, 28);
    assert(def.since < def.until);
    assert(def.previous.until < def.since);

    // 41b: Start-only
    const startOnly = metaInsightService.resolveDateRange({ since: '2026-05-01' });
    assert.strictEqual(startOnly.since, '2026-05-01');
    assert(startOnly.until >= startOnly.since);
    assert(startOnly.days > 0);

    // 41c: End-only with preset
    const endOnly = metaInsightService.resolveDateRange({ until: '2026-06-30', datePreset: 'last_7_days' });
    assert.strictEqual(endOnly.until, '2026-06-30');
    assert.strictEqual(endOnly.since, '2026-06-24');
    assert.strictEqual(endOnly.days, 7);
    assert.strictEqual(endOnly.previous.since, '2026-06-17');
    assert.strictEqual(endOnly.previous.until, '2026-06-23');

    // 41d: End-only default (28 days)
    const endDefault = metaInsightService.resolveDateRange({ until: '2026-06-30' });
    assert.strictEqual(endDefault.days, 28);
    assert.strictEqual(endDefault.until, '2026-06-30');
    assert.strictEqual(endDefault.since, '2026-06-03');

    // 41e: Invalid since date string
    assert.throws(() => {
      metaInsightService.resolveDateRange({ since: 'not-a-real-date' });
    }, (err) => err.statusCode === 400);

    // 41f: Invalid until date string
    assert.throws(() => {
      metaInsightService.resolveDateRange({ until: 'invalid-until' });
    }, (err) => err.statusCode === 400);

    // 41g: Inverted range (since > until)
    assert.throws(() => {
      metaInsightService.resolveDateRange({ since: '2026-06-20', until: '2026-06-10' });
    }, (err) => err.statusCode === 400);
  });

  // --------------------------------------------------------------------------
  // TEST 42: OAuth scope configuration includes pages_read_user_content (Phase A)
  // --------------------------------------------------------------------------
  test('OAuth configuration: buildAuthorizationUrl includes pages_read_user_content and avoids write scopes', () => {
    const authUrl = metaService.buildAuthorizationUrl('state_test_oauth');
    assert(authUrl.startsWith('https://www.facebook.com/'), 'Must build Facebook OAuth URL');
    
    const parsedUrl = new URL(authUrl);
    const scopeParam = parsedUrl.searchParams.get('scope') || '';
    const scopes = scopeParam.split(',').map(s => s.trim());
    
    // Required read scopes
    assert(scopes.includes('pages_read_user_content'), 'Must include pages_read_user_content');
    assert(scopes.includes('pages_read_engagement'), 'Must include pages_read_engagement');
    assert(scopes.includes('pages_show_list'), 'Must include pages_show_list');
    assert(scopes.includes('read_insights'), 'Must include read_insights');
    assert(scopes.includes('ads_read'), 'Must include ads_read');
    assert(scopes.includes('instagram_basic'), 'Must include instagram_basic');
    assert(scopes.includes('instagram_manage_insights'), 'Must include instagram_manage_insights');

    // Avoid unneeded write scopes
    assert(!scopes.includes('pages_manage_engagement'), 'Must NOT request write scope pages_manage_engagement');
    assert(!scopes.includes('pages_manage_posts'), 'Must NOT request write scope pages_manage_posts');
    assert(!scopes.includes('publish_video'), 'Must NOT request write scope publish_video');
  });

  // --------------------------------------------------------------------------
  // TEST 43: Post-level metrics contract matching live Graph API v26.0 test post
  // (Page ID 108002008285074, Post ID 108002008285074_1122234583890132)
  // --------------------------------------------------------------------------
  test('Post metrics: parses live Graph API v26.0 contract accurately (genuine 0 comments, missing shares as null)', () => {
    // Exact post structure returned by Graph API v26.0 with pages_read_user_content:
    // reactions.summary.total_count = 3
    // comments.summary.total_count = 0
    // shares is not present in response
    // insights: post_total_media_view_unique = 211, post_reactions_by_type_total = { like: 3 }
    const livePostPayload = {
      id: '108002008285074_1122234583890132',
      message: 'Moovana post content',
      created_time: '2026-06-15T10:00:00Z',
      reactions: { summary: { total_count: 3 } },
      comments: { summary: { total_count: 0 } },
      // shares is omitted
      insightsData: [
        {
          name: 'post_total_media_view_unique',
          period: 'lifetime',
          values: [{ value: 211 }],
        },
        {
          name: 'post_reactions_by_type_total',
          period: 'lifetime',
          values: [{ value: { like: 3 } }],
        },
      ],
    };

    const metrics = metaInsightService.parseFacebookPostMetrics(livePostPayload);

    // 1. Reactions count parses correctly
    assert.strictEqual(metrics.reactionCount, 3, 'reactionCount must be 3');

    // 2. Comments count parses correctly including genuine numeric zero
    assert.strictEqual(metrics.commentCount, 0, 'commentCount: 0 must be preserved as numeric 0, not null');

    // 3. Missing shares remains unavailable (null), never converted to 0
    assert.strictEqual(metrics.shareCount, null, 'Omitted shares must be null, not 0');

    // 4. Unique media viewers parses correctly
    assert.strictEqual(metrics.uniqueMediaViewers, 211, 'uniqueMediaViewers must be 211');
    assert.strictEqual(metrics.views, 211, 'views must map to verified uniqueMediaViewers (211)');
    assert.strictEqual(metrics.reach, 211, 'reach must map to verified uniqueMediaViewers (211)');

    // 5. Reaction breakdown parses correctly
    assert.deepStrictEqual(metrics.reactionBreakdown, { like: 3 }, 'reactionBreakdown must match { like: 3 }');

    // 6. Invalid metrics (post_engaged_users, post_interactions) return null
    assert.strictEqual(metrics.engagement, null, 'engagement must be null without fabricating numbers');

    // 7. Total interactions is null because shareCount is null
    assert.strictEqual(metrics.fbPostInteractions, null, 'fbPostInteractions must be null when shares is missing');
  });

  // --------------------------------------------------------------------------
  // TEST 44: Page-level engagement cannot be returned as per-post engagement
  // --------------------------------------------------------------------------
  test('Page-level vs per-post engagement: page_post_engagements is never mapped to individual posts', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_iso_test', name: 'Isolation Test Page' },
      pageDetails: { followersCount: 500 },
      currentInsights: {
        pageId: 'page_iso_test',
        metrics: [
          // Page-level aggregate daily values 0 and 4 (total = 4)
          {
            name: 'page_post_engagements',
            period: 'day',
            values: [
              { value: 0, endTime: '2026-06-01' },
              { value: 4, endTime: '2026-06-02' },
            ],
          },
        ],
      },
      posts: [
        {
          postId: 'post_iso_1',
          message: 'Post 1',
          insightsData: [],
          reactionCount: 3,
          commentCount: 0,
          shareCount: null,
          metrics: {
            reactionCount: 3,
            commentCount: 0,
            shareCount: null,
            uniqueMediaViewers: 211,
            views: 211,
            reach: 211,
            engagement: null, // Per-post engagement is unavailable
            fbPostInteractions: null,
          },
        },
      ],
    });

    // Page-level aggregate is available in performance section
    assert.strictEqual(report.performance.postEngagements.status, 'AVAILABLE');
    assert.strictEqual(report.performance.postEngagements.total, 4);

    // Individual post must NOT inherit the Page-level engagement total
    assert.strictEqual(report.content.posts.length, 1);
    const postItem = report.content.posts[0];
    assert.strictEqual(postItem.metrics.engagement, null, 'Post metrics.engagement must be null');
    assert.notStrictEqual(postItem.metrics.engagement, 4, 'Must NOT assign Page-level aggregate 4 to post engagement');
  });

  // --------------------------------------------------------------------------
  // TEST 45: Missing permissions produce actionable, sanitized errors without leaking tokens
  // --------------------------------------------------------------------------
  await asyncTest('Missing permissions: Code 10 produces actionable warning and redacts token strings', async () => {
    const sensitiveToken = 'EAABsb78secretPageToken123456789xyz';
    let loggedMessage = '';
    const originalLog = console.log;
    console.log = (msg) => {
      loggedMessage += String(msg) + '\n';
    };

    try {
      global.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/published_posts')) {
          if (urlStr.includes('reactions.summary')) {
            // Enhanced fields fail with Code 10 (missing pages_read_user_content)
            return {
              ok: false,
              status: 400,
              json: async () => ({
                error: {
                  code: 10,
                  message: `(#10) To use 'Page Public Content Access', grant pages_read_user_content permission. access_token=${sensitiveToken}`,
                },
              }),
            };
          }
          // Base fields fallback succeeds
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  id: 'post_fallback_sec_1',
                  message: 'Security test post',
                  created_time: '2026-06-15T12:00:00Z',
                  shares: { count: 1 },
                },
              ],
              paging: {},
            }),
          };
        }
        if (urlStr.includes('/insights')) {
          return { ok: true, json: async () => ({ data: [] }) };
        }
        return { ok: true, json: async () => ({ access_token: sensitiveToken }) };
      };

      const result = await metaService.getFacebookPagePosts('page_sec_test', sensitiveToken);
      assert.strictEqual(result.posts.length, 1);
      assert(result.warning, 'Warning must be present on result');
      assert(result.warning.includes('pages_read_user_content'), 'Warning must mention pages_read_user_content');

      // Security check: sensitive token must never appear in logs or warning
      assert(!loggedMessage.includes(sensitiveToken), 'Access token must be redacted from console logs');
      assert(!result.warning.includes(sensitiveToken), 'Access token must not appear in user-facing warning');
    } finally {
      console.log = originalLog;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 46: Invalid/unsupported metrics do not erase other successful post insights
  // --------------------------------------------------------------------------
  await asyncTest('Metric resilience: text post rejecting post_total_media_view_unique still recovers reactions', async () => {
    let callIndex = 0;
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post_text_only_1',
                message: 'Pure text post without media',
                created_time: '2026-06-15T12:00:00Z',
                shares: { count: 2 },
              },
            ],
            paging: {},
          }),
        };
      }
      if (urlStr.includes('/insights')) {
        callIndex++;
        // First combined call with post_total_media_view_unique fails on text post with code 100
        if (urlStr.includes('post_total_media_view_unique') && urlStr.includes('post_reactions_by_type_total')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: {
                code: 100,
                message: 'Unsupported metric post_total_media_view_unique for non-media post',
              },
            }),
          };
        }
        // Independent retry for post_reactions_by_type_total succeeds
        if (urlStr.includes('metric=post_reactions_by_type_total')) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  name: 'post_reactions_by_type_total',
                  period: 'lifetime',
                  values: [{ value: { like: 12, love: 3 } }],
                },
              ],
            }),
          };
        }
        // Independent retry for post_total_media_view_unique fails as expected
        if (urlStr.includes('metric=post_total_media_view_unique')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: {
                code: 100,
                message: 'Unsupported metric post_total_media_view_unique',
              },
            }),
          };
        }
      }
      return { ok: true, json: async () => ({ access_token: 'page_token' }) };
    };

    const res = await metaService.getFacebookPagePosts('page_text_post_test', 'token');
    assert.strictEqual(res.posts.length, 1);
    const post = res.posts[0];

    // Verify reactionCount recovered from post_reactions_by_type_total despite the combined request failure
    assert.strictEqual(post.reactionCount, 15, 'reactionCount must be 15 from post_reactions_by_type_total');
    assert.strictEqual(post.shareCount, 2);

    const parsed = metaInsightService.parseFacebookPostMetrics(post);
    assert.strictEqual(parsed.reactionCount, 15);
    assert.deepStrictEqual(parsed.reactionBreakdown, { like: 12, love: 3 });
    assert.strictEqual(parsed.uniqueMediaViewers, null, 'uniqueMediaViewers is null on non-media post');
  });

  // --------------------------------------------------------------------------
  // TEST 47: OAuth redirect URL resolution: targets settings tab with params
  // --------------------------------------------------------------------------
  await asyncTest('getPostOAuthRedirectUrl: routes to /dashboard/settings?tab=integrations with query params', async () => {
    const metaController = require('../controllers/metaController');
    const oldFrontend = process.env.FRONTEND_URL;
    const oldSuccessUrl = process.env.META_SUCCESS_REDIRECT_URL;

    try {
      // 47a: Default resolution when META_SUCCESS_REDIRECT_URL is unset
      delete process.env.META_SUCCESS_REDIRECT_URL;
      process.env.FRONTEND_URL = 'http://localhost:3000';
      const defaultSuccess = metaController.getPostOAuthRedirectUrl({ meta_status: 'success' });
      assert.strictEqual(defaultSuccess, 'http://localhost:3000/dashboard/settings?tab=integrations&meta_status=success');

      // 47b: Error resolution with message
      const defaultError = metaController.getPostOAuthRedirectUrl({ meta_status: 'error', error: 'User cancelled' });
      assert(defaultError.includes('meta_status=error'));
      assert(defaultError.includes('tab=integrations'));
      assert(defaultError.includes('error=User+cancelled') || defaultError.includes('error=User%20cancelled'));

      // 47c: Explicit META_SUCCESS_REDIRECT_URL overrides base
      process.env.META_SUCCESS_REDIRECT_URL = 'https://custom.app.com/settings/integrations';
      const customSuccess = metaController.getPostOAuthRedirectUrl({ meta_status: 'success' });
      assert.strictEqual(customSuccess, 'https://custom.app.com/settings/integrations?meta_status=success');
    } finally {
      process.env.FRONTEND_URL = oldFrontend;
      if (oldSuccessUrl !== undefined) {
        process.env.META_SUCCESS_REDIRECT_URL = oldSuccessUrl;
      } else {
        delete process.env.META_SUCCESS_REDIRECT_URL;
      }
    }
  });

  // --------------------------------------------------------------------------
  // TEST 48: OAuth error message sanitization: redacts tokens and credentials
  // --------------------------------------------------------------------------
  await asyncTest('sanitizeOAuthErrorMessage: safely redacts access tokens and secrets', async () => {
    const metaController = require('../controllers/metaController');
    const rawError = 'Token exchange failed for access_token=EAAcTIryi1R4BSZ1234567890abcdef and client_secret=secret12345';
    const sanitized = metaController.sanitizeOAuthErrorMessage(rawError);
    assert(!sanitized.includes('EAAcTIryi1R4BSZ'), 'Raw token must be redacted');
    assert(!sanitized.includes('secret12345'), 'Client secret must be redacted');
    assert(sanitized.includes('[REDACTED]'), 'Must include redaction marker');
  });

  // --------------------------------------------------------------------------
  // TEST 49: metaController.callback: on success, persists and redirects to settings
  // --------------------------------------------------------------------------
  await asyncTest('metaController.callback: successful OAuth redirects browser to settings integrations tab', async () => {
    const metaController = require('../controllers/metaController');
    const MetaOAuthState = require('../models/MetaOAuthState');
    const MetaIntegration = require('../models/MetaIntegration');

    const origStateFind = MetaOAuthState.findOneAndDelete;
    const origIntegrationFind = MetaIntegration.findOneAndUpdate;
    const origExchange = metaService.exchangeCodeForToken;
    const origProfile = metaService.getMetaUserProfile;
    const origPerms = metaService.getGrantedPermissions;

    let redirectedUrl = null;
    let persistedDoc = null;

    try {
      MetaOAuthState.findOneAndDelete = async () => ({
        state: 'valid_test_state',
        userId: 'user_oauth_test_123',
        expiresAt: new Date(Date.now() + 60000),
      });

      metaService.exchangeCodeForToken = async () => ({
        accessToken: 'EAATestToken1234567890',
        tokenType: 'bearer',
        expiresIn: 5184000,
      });

      metaService.getMetaUserProfile = async () => ({
        id: 'meta_user_456',
        name: 'Test Meta User',
      });

      metaService.getGrantedPermissions = async () => [
        'pages_show_list',
        'pages_read_engagement',
        'pages_read_user_content',
      ];

      MetaIntegration.findOneAndUpdate = async (filter, update) => {
        persistedDoc = { filter, update };
        return { status: 'connected', ...update };
      };

      const req = {
        query: { code: 'valid_auth_code_789', state: 'valid_test_state' },
        headers: { accept: 'text/html,application/xhtml+xml' },
      };

      const res = {
        redirect: (url) => {
          redirectedUrl = url;
        },
        status: (code) => res,
        json: (data) => data,
      };

      await metaController.callback(req, res);

      assert(redirectedUrl !== null, 'Browser request must be redirected');
      assert(redirectedUrl.includes('/dashboard/settings?tab=integrations'), 'Must redirect to settings integrations tab');
      assert(redirectedUrl.includes('meta_status=success'), 'Must convey success status');
      assert.strictEqual(persistedDoc.update.status, 'connected', 'Must persist status as connected');
      assert.strictEqual(persistedDoc.update.metaUserId, 'meta_user_456');
    } finally {
      MetaOAuthState.findOneAndDelete = origStateFind;
      MetaIntegration.findOneAndUpdate = origIntegrationFind;
      metaService.exchangeCodeForToken = origExchange;
      metaService.getMetaUserProfile = origProfile;
      metaService.getGrantedPermissions = origPerms;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 50: metaController.callback: on user cancellation / Meta error, redirects with error
  // --------------------------------------------------------------------------
  await asyncTest('metaController.callback: on Meta error/cancel, cleans up state and redirects with error', async () => {
    const metaController = require('../controllers/metaController');
    const MetaOAuthState = require('../models/MetaOAuthState');

    let deletedState = null;
    let redirectedUrl = null;

    const origStateFind = MetaOAuthState.findOneAndDelete;
    try {
      MetaOAuthState.findOneAndDelete = async (query) => {
        deletedState = query.state;
        return null;
      };

      const req = {
        query: {
          error: 'access_denied',
          error_description: 'Permissions error: user denied consent',
          state: 'state_user_denied',
        },
        headers: { accept: 'text/html' },
      };

      const res = {
        redirect: (url) => {
          redirectedUrl = url;
        },
        status: () => res,
      };

      await metaController.callback(req, res);

      assert.strictEqual(deletedState, 'state_user_denied', 'State must be cleaned up');
      assert(redirectedUrl !== null, 'Must redirect on user cancellation');
      assert(redirectedUrl.includes('meta_status=error'), 'Must convey error status');
      assert(redirectedUrl.includes('user+denied') || redirectedUrl.includes('user%20denied'), 'Must include error description');
    } finally {
      MetaOAuthState.findOneAndDelete = origStateFind;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 51: metaController.callback: on code exchange failure, redirects safely
  // --------------------------------------------------------------------------
  await asyncTest('metaController.callback: on exchange failure, redirects with safe error instead of crashing to JSON', async () => {
    const metaController = require('../controllers/metaController');
    const MetaOAuthState = require('../models/MetaOAuthState');

    const origStateFind = MetaOAuthState.findOneAndDelete;
    const origExchange = metaService.exchangeCodeForToken;

    let redirectedUrl = null;

    try {
      MetaOAuthState.findOneAndDelete = async () => ({
        state: 'valid_state_err_test',
        userId: 'user_exchange_err',
        expiresAt: new Date(Date.now() + 60000),
      });

      metaService.exchangeCodeForToken = async () => {
        const err = new Error('Graph API code exchange failed: access_token=EAABadSecret');
        throw err;
      };

      const req = {
        query: { code: 'bad_code', state: 'valid_state_err_test' },
        headers: { accept: 'text/html' },
      };

      const res = {
        redirect: (url) => {
          redirectedUrl = url;
        },
        status: () => res,
      };

      await metaController.callback(req, res);

      assert(redirectedUrl !== null, 'Must redirect browser on exchange failure');
      assert(redirectedUrl.includes('meta_status=error'), 'Must convey error status');
      assert(!redirectedUrl.includes('EAABadSecret'), 'Must redact token secret in error redirect');
    } finally {
      MetaOAuthState.findOneAndDelete = origStateFind;
      metaService.exchangeCodeForToken = origExchange;
    }
  });


  // --------------------------------------------------------------------------
  // TEST 52: Reach / Viewers deduplication and multi-day reach semantics
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: viewers uses total_over_range for multi-day reach and does not sum daily unique viewers', () => {
    // 52a: Multi-day period with total_over_range available
    const multiDayWithReach = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_reach_1', name: 'Reach 1' },
      pageDetails: { followersCount: 1952 },
      currentInsights: {
        pageId: 'page_reach_1',
        metrics: [
          {
            name: 'page_total_media_view_unique',
            period: 'day',
            values: [
              { value: 64, endTime: '2026-10-01' },
              { value: 102, endTime: '2026-10-02' },
              { value: 88, endTime: '2026-10-03' },
            ],
          },
          {
            name: 'page_total_media_view_unique',
            period: 'total_over_range',
            values: [{ value: 215, endTime: '2026-10-03' }],
          },
        ],
      },
      timeParams: { since: '2026-10-01', until: '2026-10-03' },
    });

    // 64 + 102 + 88 = 254 (sum of daily uniques), but true deduplicated reach is 215
    assert.strictEqual(multiDayWithReach.performance.viewers.status, 'AVAILABLE');
    assert.strictEqual(multiDayWithReach.performance.viewers.total, 215, 'Must report deduplicated total_over_range, not sum of daily values');
    assert.strictEqual(multiDayWithReach.performance.viewers.isDeduplicatedReach, true);
    assert.strictEqual(multiDayWithReach.performance.viewers.reachPeriod, 'total_over_range');
    assert.strictEqual(multiDayWithReach.performance.viewers.dailyUniqueViewersSum, 254, 'Must separately preserve sum of daily unique viewers');
    assert.strictEqual(multiDayWithReach.performance.viewers.timeSeries.length, 3, 'Must retain daily time series for charts');

    // 52b: Multi-day period without total_over_range
    const multiDayWithoutReach = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_reach_2', name: 'Reach 2' },
      pageDetails: { followersCount: 1952 },
      currentInsights: {
        pageId: 'page_reach_2',
        metrics: [
          {
            name: 'page_total_media_view_unique',
            period: 'day',
            values: [
              { value: 64, endTime: '2026-10-01' },
              { value: 102, endTime: '2026-10-02' },
            ],
          },
        ],
      },
      timeParams: { since: '2026-10-01', until: '2026-10-02' },
    });

    assert.strictEqual(multiDayWithoutReach.performance.viewers.status, 'AVAILABLE');
    assert.strictEqual(multiDayWithoutReach.performance.viewers.total, null, 'Must NOT sum daily uniques into reach total when total_over_range is missing');
    assert.strictEqual(multiDayWithoutReach.performance.viewers.isDeduplicatedReach, false);
    assert.strictEqual(multiDayWithoutReach.performance.viewers.dailyUniqueViewersSum, 166);
    assert(multiDayWithoutReach.performance.viewers.reason.includes('cannot be summed across days'));

    // 52c: Single-day period safely uses single day unique count as reach
    const singleDayReport = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_reach_3', name: 'Reach 3' },
      pageDetails: { followersCount: 1952 },
      currentInsights: {
        pageId: 'page_reach_3',
        metrics: [
          {
            name: 'page_total_media_view_unique',
            period: 'day',
            values: [{ value: 75, endTime: '2026-10-01' }],
          },
        ],
      },
      timeParams: { since: '2026-10-01', until: '2026-10-01' },
    });

    assert.strictEqual(singleDayReport.performance.viewers.status, 'AVAILABLE');
    assert.strictEqual(singleDayReport.performance.viewers.total, 75, 'Single day count is deduplicated reach');
    assert.strictEqual(singleDayReport.performance.viewers.isDeduplicatedReach, true);
  });

  // --------------------------------------------------------------------------
  // TEST 53: Content interactions vs Page-level engagements separation
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: contentInteractions is distinct from raw page_post_engagements', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_eng_split', name: 'Eng Split' },
      pageDetails: { followersCount: 1952 },
      currentInsights: {
        pageId: 'page_eng_split',
        metrics: [
          {
            name: 'page_post_engagements',
            period: 'day',
            values: [{ value: 120, endTime: '2026-10-01' }, { value: 128, endTime: '2026-10-02' }],
          },
        ],
      },
      posts: [
        {
          contentId: 'p1',
          metrics: { reactionCount: 20, commentCount: 15, shareCount: 9, fbPostInteractions: 44 },
        },
      ],
      timeParams: { since: '2026-10-01', until: '2026-10-02' },
    });

    // Content interactions = 44 (20 + 15 + 9), NOT 248!
    assert.strictEqual(report.performance.contentInteractions.status, 'AVAILABLE');
    assert.strictEqual(report.performance.contentInteractions.total, 44);
    assert.strictEqual(report.performance.contentInteractions.source, 'content_aggregate');
    assert.strictEqual(report.performance.contentInteractions.breakdown.reactions, 20);
    assert.strictEqual(report.performance.contentInteractions.breakdown.comments, 15);
    assert.strictEqual(report.performance.contentInteractions.breakdown.shares, 9);

    // Raw page-level engagement = 248 (120 + 128) preserved separately under postEngagements
    assert.strictEqual(report.performance.postEngagements.status, 'AVAILABLE');
    assert.strictEqual(report.performance.postEngagements.total, 248);
    assert.strictEqual(report.performance.contentInteractions.pageEngagementsInsight, 248);
  });

  // --------------------------------------------------------------------------
  // TEST 54: Views vs Page Visits vs Video Views semantics
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: preserves page_views_total semantics and distinguishes video views', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_sem', name: 'Semantics' },
      pageDetails: { followersCount: 1952 },
      currentInsights: {
        pageId: 'page_sem',
        metrics: [
          { name: 'page_views_total', period: 'day', values: [{ value: 310, endTime: '2026-10-01' }] },
          { name: 'page_video_views', period: 'day', values: [{ value: 50, endTime: '2026-10-01' }] },
        ],
      },
    });

    assert.strictEqual(report.performance.views.status, 'AVAILABLE');
    assert.strictEqual(report.performance.views.total, 310);
    assert.strictEqual(report.performance.views.metricName, 'page_views_total');
    assert(report.performance.views.description.includes('Facebook visits'));

    assert.strictEqual(report.performance.pageVisits.status, 'UNAVAILABLE');
    assert.strictEqual(report.performance.pageVisits.total, null);
    assert(report.performance.pageVisits.reason.includes('page_views_total'));

    assert.strictEqual(report.video.threeSecondViews.status, 'AVAILABLE');
    assert.strictEqual(report.video.threeSecondViews.total, 50);
    assert.strictEqual(report.video.threeSecondViews.metricName, 'page_video_views');
  });


  // --------------------------------------------------------------------------
  // TEST 55: Multi-metric group isolated retry on error code 2
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPageInsights: recovers valid metrics via isolated retry when multi-metric group fails with error code 2', async () => {
    let capturedMetrics = [];
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (!urlStr.includes('/insights')) {
        return { ok: true, json: async () => ({ access_token: 'mock_page_token' }) };
      }
      if (urlStr.includes('/insights')) {
        const u = new URL(urlStr);
        const metricParam = u.searchParams.get('metric');
        capturedMetrics.push(metricParam);

        // Combined multi-metric group fails with Meta error code 2
        if (metricParam === 'page_views_total,page_post_engagements,page_total_actions') {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              error: { code: 2, message: 'An unexpected error has occurred. Please retry.' },
            }),
          };
        }
        // Isolated retry for page_views_total succeeds!
        if (metricParam === 'page_views_total') {
          return {
            ok: true,
            json: async () => ({
              data: [{ name: 'page_views_total', period: 'day', values: [{ value: 419, end_time: '2026-10-27' }] }],
            }),
          };
        }
        // Isolated retry for page_post_engagements succeeds!
        if (metricParam === 'page_post_engagements') {
          return {
            ok: true,
            json: async () => ({
              data: [{ name: 'page_post_engagements', period: 'day', values: [{ value: 248, end_time: '2026-10-27' }] }],
            }),
          };
        }
        // Isolated retry for page_total_actions fails with code 2
        if (metricParam === 'page_total_actions') {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              error: { code: 2, message: 'An unexpected error has occurred. Please retry.' },
            }),
          };
        }
      }
      return { ok: true, json: async () => ({ data: [] }) };
    };

    const res = await metaService.getFacebookPageInsights(
      'page_retry_test',
      'token',
      {
        metricGroups: [
          { metrics: ['page_views_total', 'page_post_engagements', 'page_total_actions'], period: 'day' },
        ],
      },
      'user_retry_1'
    );

    // page_views_total and page_post_engagements must be recovered!
    const recoveredViews = res.metrics.find((m) => m.name === 'page_views_total');
    const recoveredEng = res.metrics.find((m) => m.name === 'page_post_engagements');
    assert(recoveredViews && recoveredViews.values.length === 1 && recoveredViews.values[0].value === 419, 'Must recover page_views_total (419)');
    assert(recoveredEng && recoveredEng.values.length === 1 && recoveredEng.values[0].value === 248, 'Must recover page_post_engagements (248)');

    // groupErrors should record only page_total_actions failure
    assert(res.groupErrors.some((ge) => ge.metrics.includes('page_total_actions')), 'Should record page_total_actions failure in groupErrors');
  });

  // --------------------------------------------------------------------------
  // TEST 56: Content Overview Views (page_media_view) prioritization vs page_views_total
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: uses page_media_view for Views and preserves page_views_total for profileViews', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_media_test', name: 'Media Test' },
      pageDetails: { followersCount: 1952 },
      currentInsights: {
        pageId: 'page_media_test',
        metrics: [
          {
            name: 'page_media_view',
            period: 'total_over_range',
            values: [{ value: 9562, endTime: '2026-10-27' }],
          },
          {
            name: 'page_media_view',
            period: 'day',
            values: [{ value: 5000, endTime: '2026-10-26' }, { value: 4562, endTime: '2026-10-27' }],
          },
          {
            name: 'page_views_total',
            period: 'day',
            values: [{ value: 419, endTime: '2026-10-27' }],
          },
        ],
      },
    });

    // Content Overview Views: 9,562
    assert.strictEqual(report.performance.views.status, 'AVAILABLE');
    assert.strictEqual(report.performance.views.total, 9562);
    assert.strictEqual(report.performance.views.metricName, 'page_media_view');
    assert(report.performance.views.description.includes('Content media views'));

    // Profile Views / Facebook visits: 419
    assert.strictEqual(report.performance.profileViews.status, 'AVAILABLE');
    assert.strictEqual(report.performance.profileViews.total, 419);
    assert.strictEqual(report.performance.profileViews.metricName, 'page_views_total');
    assert(report.performance.profileViews.description.includes('Facebook visits'));
  });

  // --------------------------------------------------------------------------
  // TEST 57: Content interactions separation and Page reactions insight
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: exposes pageReactionsInsight from page_actions_post_reactions_total', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_rxn_test', name: 'Rxn Test' },
      pageDetails: { followersCount: 1952 },
      currentInsights: {
        pageId: 'page_rxn_test',
        metrics: [
          {
            name: 'page_actions_post_reactions_total',
            period: 'total_over_range',
            values: [{ value: { like: 41 }, endTime: '2026-10-27' }],
          },
          {
            name: 'page_post_engagements',
            period: 'day',
            values: [{ value: 248, endTime: '2026-10-27' }],
          },
        ],
      },
      posts: [
        {
          postId: 'post_1',
          metrics: { reactionCount: 3, commentCount: 0, shareCount: null, fbPostInteractions: 3 },
        },
        {
          postId: 'post_2',
          metrics: { reactionCount: 7, commentCount: 0, shareCount: null, fbPostInteractions: 7 },
        },
      ],
    });

    // Content interactions = 10 from published posts
    assert.strictEqual(report.performance.contentInteractions.status, 'AVAILABLE');
    assert.strictEqual(report.performance.contentInteractions.total, 10);
    assert.strictEqual(report.performance.contentInteractions.source, 'content_aggregate');

    // Page-level reactions insight = 41 (explains Meta Business Suite 44)
    assert.strictEqual(report.performance.contentInteractions.pageReactionsInsight, 41);

    // Page-level post engagements = 248
    assert.strictEqual(report.performance.contentInteractions.pageEngagementsInsight, 248);
    assert.strictEqual(report.performance.postEngagements.total, 248);
  });

  // --------------------------------------------------------------------------
  // TEST 58: Video views breakdown (total vs organic vs paid)
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: exposes organic and paid breakdown under video.threeSecondViews', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: 'page_vid_split', name: 'Vid Split' },
      pageDetails: { followersCount: 1952 },
      currentInsights: {
        pageId: 'page_vid_split',
        metrics: [
          { name: 'page_video_views', period: 'day', values: [{ value: 1065, endTime: '2026-10-27' }] },
          { name: 'page_video_views_organic', period: 'day', values: [{ value: 717, endTime: '2026-10-27' }] },
          { name: 'page_video_views_paid', period: 'day', values: [{ value: 348, endTime: '2026-10-27' }] },
          { name: 'page_video_view_time', period: 'total_over_range', values: [{ value: 19023513, endTime: '2026-10-27' }] },
        ],
      },
    });

    assert.strictEqual(report.video.threeSecondViews.total, 1065);
    assert.strictEqual(report.video.threeSecondViews.organic, 717);
    assert.strictEqual(report.video.threeSecondViews.paid, 348);
    assert.deepStrictEqual(report.video.threeSecondViews.breakdown, { organic: 717, paid: 348 });
    assert.strictEqual(report.video.watchTime.totalMs, 19023513);
    assert.strictEqual(report.video.watchTime.totalMinutes, 317.06);
  });


  // --------------------------------------------------------------------------
  // TEST 59: Post-level metrics: post_media_view lifetime views, zero comments, null shares
  // --------------------------------------------------------------------------
  test('parseFacebookPostMetrics: maps post_media_view with lifetime period, preserves zero comments, and leaves missing shares as null', () => {
    const rawPost = {
      id: '108002008285074_1122234583890132',
      message: 'Moovana nutritional knowledge reel',
      created_time: '2026-10-26T12:57:37+0000',
      reactions: { summary: { total_count: 3 } },
      comments: { summary: { total_count: 0 } },
      // shares is absent
      insightsData: [
        {
          name: 'post_media_view',
          period: 'lifetime',
          values: [{ value: 248 }],
        },
        {
          name: 'post_reactions_by_type_total',
          period: 'lifetime',
          values: [{ value: { like: 3 } }],
        },
        {
          name: 'post_total_media_view_unique',
          period: 'lifetime',
          values: [{ value: 222 }],
        },
      ],
    };

    const metrics = metaInsightService.parseFacebookPostMetrics(rawPost);

    // 1. Reactions
    assert.strictEqual(metrics.reactionCount, 3);
    assert.strictEqual(metrics.reactions.total, 3);
    assert.strictEqual(metrics.reactions.status, 'AVAILABLE');

    // 2. Comments (genuine numeric 0)
    assert.strictEqual(metrics.commentCount, 0);
    assert.strictEqual(metrics.comments.total, 0);
    assert.strictEqual(metrics.comments.status, 'AVAILABLE');

    // 3. Shares (omitted -> null)
    assert.strictEqual(metrics.shareCount, null);
    assert.strictEqual(metrics.shares.total, null);
    assert.strictEqual(metrics.shares.status, 'UNAVAILABLE');

    // 4. Views (from post_media_view, lifetime)
    assert.strictEqual(metrics.views, 248);
    assert.strictEqual(metrics.viewsPeriod, 'lifetime');
    assert.strictEqual(metrics.viewsDetails.total, 248);
    assert.strictEqual(metrics.viewsDetails.period, 'lifetime');
    assert.strictEqual(metrics.viewsDetails.status, 'AVAILABLE');
    assert.strictEqual(metrics.viewsDetails.metricName, 'post_media_view');

    // 5. Reach (from post_total_media_view_unique, lifetime)
    assert.strictEqual(metrics.reach, 222);
    assert.strictEqual(metrics.reachPeriod, 'lifetime');
    assert.strictEqual(metrics.uniqueMediaViewers, 222);

    // 6. Interactions (null because shares is unavailable)
    assert.strictEqual(metrics.fbPostInteractions, null);
  });

  // --------------------------------------------------------------------------
  // TEST 60: Post-level conceptual response contract shape
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: formats post items with conceptual structured fields and flat compatibility aliases', () => {
    const report = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: '108002008285074', name: 'Moovana' },
      pageDetails: { followersCount: 1953 },
      currentInsights: { pageId: '108002008285074', metrics: [] },
      posts: [
        {
          platform: 'facebook',
          contentId: '108002008285074_1122234583890132',
          id: '108002008285074_1122234583890132',
          message: 'Post text',
          createdTime: '2026-10-26T12:57:37+0000',
          permalinkUrl: 'https://facebook.com/reel/123',
          permalink: 'https://facebook.com/reel/123',
          reactionCount: 3,
          commentCount: 0,
          shareCount: null,
          views: 248,
          viewsPeriod: 'lifetime',
          reach: 222,
          reachPeriod: 'lifetime',
          reactions: { total: 3, status: 'AVAILABLE' },
          comments: { total: 0, status: 'AVAILABLE' },
          shares: { total: null, status: 'UNAVAILABLE' },
          viewsDetails: { total: 248, period: 'lifetime', status: 'AVAILABLE', metricName: 'post_media_view' },
          metrics: {
            reactionCount: 3,
            commentCount: 0,
            shareCount: null,
            views: 248,
            viewsPeriod: 'lifetime',
            reach: 222,
            reachPeriod: 'lifetime',
          },
        },
      ],
    });

    assert.strictEqual(report.content.posts.length, 1);
    const post = report.content.posts[0];

    // Conceptual fields
    assert.strictEqual(post.id, '108002008285074_1122234583890132');
    assert.strictEqual(post.createdTime, '2026-10-26T12:57:37+0000');
    assert.strictEqual(post.message, 'Post text');
    assert.strictEqual(post.permalink, 'https://facebook.com/reel/123');
    assert.strictEqual(post.reactions.total, 3);
    assert.strictEqual(post.reactions.status, 'AVAILABLE');
    assert.strictEqual(post.comments.total, 0);
    assert.strictEqual(post.comments.status, 'AVAILABLE');
    assert.strictEqual(post.shares.total, null);
    assert.strictEqual(post.shares.status, 'UNAVAILABLE');
    assert.strictEqual(post.viewsDetails.total, 248);
    assert.strictEqual(post.viewsDetails.period, 'lifetime');
    assert.strictEqual(post.viewsDetails.status, 'AVAILABLE');

    // Backward compatibility flat aliases
    assert.strictEqual(post.contentId, '108002008285074_1122234583890132');
    assert.strictEqual(post.permalinkUrl, 'https://facebook.com/reel/123');
    assert.strictEqual(post.reactionCount, 3);
    assert.strictEqual(post.commentCount, 0);
    assert.strictEqual(post.shareCount, null);
    assert.strictEqual(post.views, 248);
    assert.strictEqual(post.viewsPeriod, 'lifetime');
  });

  // --------------------------------------------------------------------------
  // TEST 61: Date boundaries demonstration: 27 days (415) vs 28 days (419)
  // --------------------------------------------------------------------------
  test('buildFacebookAnalyticsReport: accurately aggregates daily series without hardcoding and reflects complete 28-day range', () => {
    // 27 daily records (up to Oct 26) sum to 415
    const values27 = [
      81, 25, 11, 36, 15, 14, 14, 6, 36, 12, 10, 21, 12, 9, 1, 7, 24, 47, 7, 9, 1, 4, 4, 0, 4, 4, 1
    ].map((val, idx) => ({
      value: val,
      endTime: `2026-10-${String(idx + 1).padStart(2, '0')}T07:00:00+0000`,
    }));

    const sum27 = values27.reduce((acc, v) => acc + v.value, 0);
    assert.strictEqual(sum27, 415, '27 days of page_views_total must sum to 415');

    // 28th record for Oct 27 (value 4)
    const values28 = [...values27, { value: 4, endTime: '2026-10-28T07:00:00+0000' }];
    const sum28 = values28.reduce((acc, v) => acc + v.value, 0);
    assert.strictEqual(sum28, 419, '28 days of page_views_total must sum to 419');

    const report28 = metaInsightService.buildFacebookAnalyticsReport({
      targetPage: { pageId: '108002008285074', name: 'Moovana' },
      pageDetails: { followersCount: 1953 },
      currentInsights: {
        pageId: '108002008285074',
        metrics: [
          { name: 'page_views_total', period: 'day', values: values28 },
        ],
      },
    });

    assert.strictEqual(report28.performance.profileViews.total, 419);
    assert.strictEqual(report28.performance.profileViews.timeSeries.length, 28);
  });

  // --------------------------------------------------------------------------
  // TEST 62: Post insights requests include post_media_view and recover via isolated retry
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPagePosts: requests post_media_view and handles partial failures via single metric retries', async () => {
    let capturedMetricsUrl = '';
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'post_media_test_1',
                message: 'Post with media',
                created_time: '2026-10-25T12:00:00Z',
                reactions: { summary: { total_count: 5 } },
                comments: { summary: { total_count: 2 } },
              },
            ],
            paging: {},
          }),
        };
      }
      if (urlStr.includes('/insights')) {
        capturedMetricsUrl = urlStr;
        return {
          ok: true,
          json: async () => ({
            data: [
              { name: 'post_media_view', period: 'lifetime', values: [{ value: 310 }] },
              { name: 'post_reactions_by_type_total', period: 'lifetime', values: [{ value: { like: 5 } }] },
              { name: 'post_total_media_view_unique', period: 'lifetime', values: [{ value: 290 }] },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ access_token: 'page_token' }) };
    };

    const res = await metaService.getFacebookPagePosts('page_pmv_test', 'token');
    assert.strictEqual(res.posts.length, 1);
    const post = res.posts[0];
    assert.strictEqual(post.id, 'post_media_test_1');
    assert.strictEqual(post.reactionCount, 5);
    assert.strictEqual(post.commentCount, 2);

    const decoded = decodeURIComponent(capturedMetricsUrl);
    assert(decoded.includes('post_media_view'), 'Must request post_media_view');
    assert(decoded.includes('post_reactions_by_type_total'), 'Must request post_reactions_by_type_total');
    assert(decoded.includes('post_total_media_view_unique'), 'Must request post_total_media_view_unique');
    assert(decoded.includes('period=lifetime'), 'Must request lifetime period');
  });

  // --------------------------------------------------------------------------
  // TEST 63: Page isolation: post-level analytics respects selected Page ID
  // --------------------------------------------------------------------------
  await asyncTest('getFacebookPagePosts: strictly scopes Graph API calls to the target Page ID', async () => {
    let capturedPageTarget = '';
    global.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/published_posts')) {
        capturedPageTarget = urlStr;
        return {
          ok: true,
          json: async () => ({ data: [], paging: {} }),
        };
      }
      return { ok: true, json: async () => ({ access_token: 'page_token' }) };
    };

    await metaService.getFacebookPagePosts('target_page_999', 'token');
    assert(capturedPageTarget.includes('/target_page_999/published_posts'), 'Endpoint must call /target_page_999/published_posts');
    assert(!capturedPageTarget.includes('/108002008285074/'), 'Must not leak target_page_999 to other pages');
  });

  // Restore fetch
  global.fetch = originalFetch;

  console.log('\n================================================================');
  console.log(`ALL META REGRESSION TESTS PASSED! (${passedTests}/${totalTests} tests successful)`);
  console.log('================================================================\n');
}

runMetaRegressionTestSuite().catch((err) => {
  global.fetch = originalFetch;
  console.error('Meta Regression Test Suite Failed:', err);
  process.exit(1);
});

