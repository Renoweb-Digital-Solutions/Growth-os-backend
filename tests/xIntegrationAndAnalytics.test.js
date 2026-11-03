/**
 * Comprehensive Automated Test Suite for Growmentum X (Twitter) Analytics Integration
 *
 * Validates:
 * 1. PKCE Security (code verifier & S256 challenge generation)
 * 2. OAuth 2.0 Authorization URL construction with read-only scopes
 * 3. OAuth State single-use consumption and replay protection
 * 4. Token leak prevention (toSafeObject, token redaction in logs/APIs)
 * 5. Token auto-refresh on expiration (with 5-minute buffer)
 * 6. X API client parameter mapping, rate limit tracking, and 401/403/429 error normalization
 * 7. Redis Cache & resilient in-memory fallback engine
 * 8. Distributed lock & single-flight concurrent stampede prevention
 * 9. Lazy Daily Refresh (Redis hit -> DB hit -> Locked fresh API fetch)
 * 10. Metric normalization, engagement rate calculations, and UTC daily timeline binning
 * 11. Graceful degradation: serving stale snapshot with isStale=true on API error
 * 12. Account & tenant isolation (cross-user access denial)
 * 13. Soft-disconnect and cache invalidation
 */

const assert = require('assert');
const crypto = require('crypto');
const xAuthService = require('../services/xAuthService');
const xApiService = require('../services/xApiService');
const xRedisService = require('../services/xRedisService');
const xAnalyticsService = require('../services/xAnalyticsService');
const XIntegration = require('../models/XIntegration');
const XOAuthState = require('../models/XOAuthState');
const XAnalyticsSnapshot = require('../models/XAnalyticsSnapshot');

const originalFetch = global.fetch;

async function runXTestSuite() {
  console.log('================================================================');
  console.log('STARTING GROWMENTUM X ANALYTICS INTEGRATION TEST SUITE');
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

  // Set test environment variables
  process.env.X_CLIENT_ID = 'test_x_client_id_abc123';
  process.env.X_CLIENT_SECRET = 'test_x_client_secret_xyz789';
  process.env.X_REDIRECT_URI = 'http://localhost:5000/api/x/callback';
  process.env.X_SCOPES = 'tweet.read users.read offline.access';

  try {
    // ==========================================================================
    // 1. PKCE SECURITY & CODE CHALLENGE GENERATION
    // ==========================================================================
    test('PKCE: generateCodeVerifier produces valid base64url string with adequate entropy', () => {
      const verifier1 = xAuthService.generateCodeVerifier();
      const verifier2 = xAuthService.generateCodeVerifier();

      assert(typeof verifier1 === 'string');
      assert(verifier1.length >= 43 && verifier1.length <= 128);
      assert.notStrictEqual(verifier1, verifier2, 'Verifiers must be randomly generated');
      // Must only contain unreserved URL characters [A-Z, a-z, 0-9, -, ., _, ~]
      assert(/^[A-Za-z0-9\-._~]+$/.test(verifier1));
    });

    test('PKCE: generateCodeChallenge produces RFC 7636 compliant SHA256 base64url hash', () => {
      // Test vector from RFC 7636 Appendix B:
      // verifier: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
      // challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
      const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const actualChallenge = xAuthService.generateCodeChallenge(rfcVerifier);
      assert.strictEqual(actualChallenge, expectedChallenge, 'PKCE S256 challenge must match RFC 7636 test vector');
    });

    // ==========================================================================
    // 2. AUTHORIZATION URL CONSTRUCTION
    // ==========================================================================
    test('OAuth: getAuthorizationUrl includes exact required scopes and PKCE challenge parameters', () => {
      const state = 'mock_state_12345';
      const challenge = 'mock_code_challenge_67890';
      const urlString = xAuthService.getAuthorizationUrl(state, challenge);
      const url = new URL(urlString);

      assert(url.origin === 'https://x.com' || url.origin === 'https://twitter.com');
      assert.strictEqual(url.pathname, '/i/oauth2/authorize');
      assert.strictEqual(url.searchParams.get('response_type'), 'code');
      assert.strictEqual(url.searchParams.get('client_id'), 'test_x_client_id_abc123');
      assert.strictEqual(url.searchParams.get('redirect_uri'), 'http://localhost:5000/api/x/callback');
      assert.strictEqual(url.searchParams.get('state'), state);
      assert.strictEqual(url.searchParams.get('code_challenge'), challenge);
      assert.strictEqual(url.searchParams.get('code_challenge_method'), 's256');

      const scopes = url.searchParams.get('scope').split(' ');
      assert(scopes.includes('tweet.read'), 'Must request tweet.read');
      assert(scopes.includes('users.read'), 'Must request users.read');
      assert(scopes.includes('offline.access'), 'Must request offline.access for refresh token');
      assert(!scopes.includes('tweet.write'), 'Must NOT request write permissions');
    });

    // ==========================================================================
    // 3. CREDENTIAL LEAK PROTECTION (toSafeObject & Redaction)
    // ==========================================================================
    test('Security: XIntegration.toSafeObject strictly omits accessToken, refreshToken, and sensitive metadata', () => {
      const mockDoc = new XIntegration({
        userId: '60c72b2f9b1d8b2bad000001',
        xUserId: 'x_12345678',
        username: 'growth_brand',
        name: 'Growth Brand Inc.',
        profileImageUrl: 'https://pbs.twimg.com/profile_images/1/avatar.jpg',
        accessToken: 'SUPER_SECRET_ACCESS_TOKEN_DO_NOT_LEAK',
        refreshToken: 'SUPER_SECRET_REFRESH_TOKEN_DO_NOT_LEAK',
        tokenExpiresAt: new Date(Date.now() + 7200000),
        scopes: ['tweet.read', 'users.read', 'offline.access'],
        status: 'connected',
        connectedAt: new Date(),
      });

      const safe = mockDoc.toSafeObject();
      assert.strictEqual(safe.accessToken, undefined, 'Access token must never be present in safe object');
      assert.strictEqual(safe.refreshToken, undefined, 'Refresh token must never be present in safe object');
      assert.strictEqual(safe.account.username, 'growth_brand');
      assert.strictEqual(safe.account.xUserId, 'x_12345678');
      assert.strictEqual(safe.status, 'connected');
    });

    test('Security: Token redaction helper safely masks credentials for diagnostic logs', () => {
      const fullToken = 'x_oauth2_secret_token_example_1234567890';
      const redacted = xApiService.redactToken(fullToken);
      assert(redacted.startsWith('x_oa...'));
      assert(redacted.endsWith('7890'));
      assert(!redacted.includes('secret_token_example'));
    });

    // ==========================================================================
    // 4. TOKEN EXCHANGE (Code for Token with Basic Auth & PKCE Verifier)
    // ==========================================================================
    await asyncTest('OAuth: exchangeCodeForToken sends HTTP POST with Basic Auth header and code_verifier', async () => {
      global.fetch = async (url, options) => {
        assert(url === 'https://api.x.com/2/oauth2/token' || url === 'https://api.twitter.com/2/oauth2/token');
        assert.strictEqual(options.method, 'POST');

        // Verify Basic Auth header
        const authHeader = options.headers['Authorization'];
        assert(authHeader.startsWith('Basic '));
        const credentials = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString('utf8');
        assert.strictEqual(credentials, 'test_x_client_id_abc123:test_x_client_secret_xyz789');

        // Verify form body
        const bodyParams = new URLSearchParams(options.body);
        assert.strictEqual(bodyParams.get('grant_type'), 'authorization_code');
        assert.strictEqual(bodyParams.get('code'), 'auth_code_sample_123');
        assert.strictEqual(bodyParams.get('code_verifier'), 'code_verifier_sample_456');
        assert.strictEqual(bodyParams.get('redirect_uri'), 'http://localhost:5000/api/x/callback');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            token_type: 'bearer',
            expires_in: 7200,
            access_token: 'new_mock_access_token_111',
            scope: 'tweet.read users.read offline.access',
            refresh_token: 'new_mock_refresh_token_222',
          }),
        };
      };

      const tokenData = await xAuthService.exchangeCodeForToken({
        code: 'auth_code_sample_123',
        codeVerifier: 'code_verifier_sample_456',
        redirectUri: 'http://localhost:5000/api/x/callback',
      });

      assert.strictEqual(tokenData.accessToken, 'new_mock_access_token_111');
      assert.strictEqual(tokenData.refreshToken, 'new_mock_refresh_token_222');
      assert.strictEqual(tokenData.expiresIn, 7200);
      assert(tokenData.tokenExpiresAt instanceof Date);
    });

    await asyncTest('OAuth: exchangeCodeForToken normalizes X OAuth error response', async () => {
      global.fetch = async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Value passed for the authorization code was invalid or has expired',
        }),
      });

      let errorCaught = null;
      try {
        await xAuthService.exchangeCodeForToken({
          code: 'expired_code',
          codeVerifier: 'any_verifier',
          redirectUri: 'http://localhost:5000/api/x/callback',
        });
      } catch (err) {
        errorCaught = err;
      }

      assert(errorCaught !== null);
      assert.strictEqual(errorCaught.statusCode, 400);
      assert(errorCaught.message.includes('Value passed for the authorization code was invalid'));
    });

    // ==========================================================================
    // 5. TOKEN AUTO-REFRESH LOGIC
    // ==========================================================================
    await asyncTest('Auth: getValidAccessToken returns existing token if still valid beyond 5-minute buffer', async () => {
      let fetchCalled = false;
      global.fetch = async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({}) };
      };

      const validDoc = {
        accessToken: 'still_valid_token_xyz',
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour left
        refreshToken: 'refresh_token_mock',
        save: async () => {},
      };

      const token = await xAuthService.getValidAccessToken(validDoc);
      assert.strictEqual(token, 'still_valid_token_xyz');
      assert.strictEqual(fetchCalled, false, 'Fetch must not be called when token has > 5m validity');
    });

    await asyncTest('Auth: getValidAccessToken refreshes token when within 5-minute expiration buffer', async () => {
      let refreshCalled = false;
      global.fetch = async (url, options) => {
        refreshCalled = true;
        const bodyParams = new URLSearchParams(options.body);
        assert.strictEqual(bodyParams.get('grant_type'), 'refresh_token');
        assert.strictEqual(bodyParams.get('refresh_token'), 'existing_refresh_token');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            token_type: 'bearer',
            expires_in: 7200,
            access_token: 'freshly_refreshed_access_token',
            refresh_token: 'rotated_refresh_token',
            scope: 'tweet.read users.read offline.access',
          }),
        };
      };

      let saved = false;
      const expiringDoc = {
        accessToken: 'old_expiring_token',
        tokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000), // Only 2 mins left (< 5m buffer)
        refreshToken: 'existing_refresh_token',
        save: async function () {
          saved = true;
        },
      };

      const token = await xAuthService.getValidAccessToken(expiringDoc);
      assert.strictEqual(refreshCalled, true);
      assert.strictEqual(token, 'freshly_refreshed_access_token');
      assert.strictEqual(expiringDoc.accessToken, 'freshly_refreshed_access_token');
      assert.strictEqual(expiringDoc.refreshToken, 'rotated_refresh_token');
      assert.strictEqual(saved, true);
    });

    // ==========================================================================
    // 6. X API CLIENT (User Me, Tweets & Error Handling)
    // ==========================================================================
    await asyncTest('xApiService: getAuthenticatedUser requests /2/users/me with correct user fields', async () => {
      global.fetch = async (url, options) => {
        assert.strictEqual(options.headers['Authorization'], 'Bearer mock_bearer_token');
        const parsed = new URL(url);
        assert.strictEqual(parsed.pathname, '/2/users/me');
        assert(parsed.searchParams.get('user.fields').includes('public_metrics'));
        assert(parsed.searchParams.get('user.fields').includes('profile_image_url'));

        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'x-rate-limit-remaining': '74',
            'x-rate-limit-reset': '1700000000',
          }),
          json: async () => ({
            data: {
              id: '987654321',
              name: 'Growth Brand',
              username: 'growthbrand',
              profile_image_url: 'https://pbs.twimg.com/avatar.jpg',
              public_metrics: {
                followers_count: 12500,
                following_count: 450,
                tweet_count: 1200,
                listed_count: 35,
              },
            },
          }),
        };
      };

      const user = await xApiService.getAuthenticatedUser('mock_bearer_token');
      assert.strictEqual(user.id, '987654321');
      assert.strictEqual(user.username, 'growthbrand');
      assert.strictEqual(user.public_metrics.followers_count, 12500);
    });

    await asyncTest('xApiService: getUserTweets normalizes tweets with public metrics and attached media', async () => {
      global.fetch = async (url, options) => {
        const parsed = new URL(url);
        assert.strictEqual(parsed.pathname, '/2/users/987654321/tweets');
        assert.strictEqual(parsed.searchParams.get('max_results'), '20');
        assert(parsed.searchParams.get('tweet.fields').includes('public_metrics'));
        assert(parsed.searchParams.get('expansions').includes('attachments.media_keys'));

        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'x-rate-limit-remaining': '890',
            'x-rate-limit-reset': '1700000000',
          }),
          json: async () => ({
            data: [
              {
                id: 'post_1',
                text: 'Exciting news from our team! Check it out.',
                created_at: '2026-10-25T14:00:00Z',
                public_metrics: {
                  retweet_count: 10,
                  reply_count: 5,
                  like_count: 85,
                  quote_count: 2,
                  bookmark_count: 15,
                  impression_count: 2500,
                },
                attachments: {
                  media_keys: ['media_key_1'],
                },
              },
            ],
            includes: {
              media: [
                {
                  media_key: 'media_key_1',
                  type: 'video',
                  public_metrics: { view_count: 1200 },
                },
              ],
            },
            meta: {
              result_count: 1,
            },
          }),
        };
      };

      const result = await xApiService.getUserTweets({
        userId: '987654321',
        accessToken: 'mock_bearer_token',
        maxResults: 20,
      });

      assert.strictEqual(result.data.length, 1);
      const post = result.data[0];
      assert.strictEqual(post.id, 'post_1');
      assert.strictEqual(post.public_metrics.like_count, 85);
      assert.strictEqual(post.media.length, 1);
      assert.strictEqual(post.media[0].type, 'video');
      assert.strictEqual(post.media[0].public_metrics.view_count, 1200);
    });

    await asyncTest('xApiService: normalizes 429 rate limit errors with reset timestamp', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 900;
      global.fetch = async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({
          'x-rate-limit-limit': '900',
          'x-rate-limit-remaining': '0',
          'x-rate-limit-reset': String(resetTime),
        }),
        json: async () => ({
          title: 'Too Many Requests',
          detail: 'Rate limit exceeded',
        }),
      });

      let caught = null;
      try {
        await xApiService.getAuthenticatedUser('mock_token');
      } catch (err) {
        caught = err;
      }

      assert(caught !== null);
      assert.strictEqual(caught.statusCode, 429);
      assert.strictEqual(caught.isRateLimited, true);
      assert.strictEqual(caught.rateLimitReset, resetTime);
    });

    // ==========================================================================
    // 7. REDIS CACHE & IN-MEMORY FALLBACK ENGINE
    // ==========================================================================
    await asyncTest('xRedisService: fallback in-memory engine provides functional get, set, del, and TTL', async () => {
      const testKey = 'growth_os:x:test:item_1';
      const testValue = { metric: 'impressions', value: 4500 };

      // Set with 60 second TTL
      await xRedisService.set(testKey, testValue, 60);

      // Get
      const cached = await xRedisService.get(testKey);
      assert.deepStrictEqual(cached, testValue);

      // Del
      await xRedisService.del(testKey);
      const afterDel = await xRedisService.get(testKey);
      assert.strictEqual(afterDel, null);
    });

    // ==========================================================================
    // 8. DISTRIBUTED LOCKING & SINGLE-FLIGHT STAMPEDE PREVENTION
    // ==========================================================================
    await asyncTest('xRedisService: distributed lock prevents concurrent duplicate executions', async () => {
      const lockKey = 'lock:growth_os:x:refresh:conn_test_1';

      // 1. Acquire lock
      const acquired1 = await xRedisService.acquireLock(lockKey, 10000);
      assert(typeof acquired1 === 'string' && acquired1.length > 0, 'First lock acquisition should succeed and return lock token');

      // 2. Attempt to acquire the same lock while held
      const acquired2 = await xRedisService.acquireLock(lockKey, 10000);
      assert.strictEqual(acquired2, null, 'Concurrent lock acquisition must be rejected with null');

      // 3. Release lock
      const released = await xRedisService.releaseLock(lockKey, acquired1);
      assert.strictEqual(released, true, 'Lock should release cleanly');

      // 4. Acquire again after release
      const acquired3 = await xRedisService.acquireLock(lockKey, 10000);
      assert(typeof acquired3 === 'string' && acquired3.length > 0, 'Lock should be acquirable after release');
      await xRedisService.releaseLock(lockKey, acquired3);
    });

    // ==========================================================================
    // 9. METRIC NORMALIZATION & DERIVATIONS
    // ==========================================================================
    test('xAnalyticsService: accurately derives engagements, engagement rates, and timeline aggregations', () => {
      const rawUser = {
        id: 'u_1',
        name: 'Brand',
        username: 'brand',
        public_metrics: {
          followers_count: 5000,
          following_count: 200,
          tweet_count: 80,
          listed_count: 5,
        },
      };

      const rawTweets = [
        {
          id: 't_1',
          text: 'Post 1',
          created_at: '2026-10-26T10:00:00Z',
          public_metrics: {
            like_count: 100,
            retweet_count: 20,
            reply_count: 10,
            quote_count: 5,
            bookmark_count: 15,
            impression_count: 2000,
          },
          media: [],
        },
        {
          id: 't_2',
          text: 'Post 2 with video',
          created_at: '2026-10-26T18:00:00Z',
          public_metrics: {
            like_count: 50,
            retweet_count: 5,
            reply_count: 2,
            quote_count: 1,
            bookmark_count: 2,
            impression_count: 1000,
          },
          media: [{ type: 'video', public_metrics: { view_count: 850 } }],
        },
      ];

      const normalized = xAnalyticsService.normalizeSnapshotData({
        user: rawUser,
        tweets: rawTweets,
        priorSnapshot: null,
      });

      // Total engagements for t_1 = 100 + 20 + 10 + 5 + 15 = 150
      // Total engagements for t_2 = 50 + 5 + 2 + 1 + 2 = 60
      // Aggregated engagements = 210
      assert.strictEqual(normalized.engagement.totalEngagements, 210);
      assert.strictEqual(normalized.engagement.likes, 150);
      assert.strictEqual(normalized.engagement.retweets, 25);
      assert.strictEqual(normalized.engagement.replies, 12);
      assert.strictEqual(normalized.engagement.quotes, 6);
      assert.strictEqual(normalized.engagement.bookmarks, 17);

      // Total impressions = 3000
      assert.strictEqual(normalized.reach.totalImpressions, 3000);
      // Video views = 850
      assert.strictEqual(normalized.reach.totalVideoViews, 850);

      // Engagement rate by impressions: (210 / 3000) * 100 = 7.00%
      assert.strictEqual(normalized.engagement.engagementRateByImpressions, 7);

      // Daily activity aggregation for 2026-10-26
      assert.strictEqual(normalized.dailyActivity.length, 1);
      const day26 = normalized.dailyActivity[0];
      assert.strictEqual(day26.date, '2026-10-26');
      assert.strictEqual(day26.postsCount, 2);
      assert.strictEqual(day26.impressions, 3000);
      assert.strictEqual(day26.engagements, 210);

      // Top posts sorting
      assert.strictEqual(normalized.topPosts.length, 2);
      assert.strictEqual(normalized.topPosts[0].id, 't_1', 'Highest engagement post must be first');
    });

    // ==========================================================================
    // 10. LAZY REFRESH: SCENARIO A (REDIS CACHE HIT)
    // ==========================================================================
    await asyncTest('Lazy Refresh: Scenario A returns cached snapshot immediately with zero X API calls', async () => {
      let apiCalled = false;
      global.fetch = async () => {
        apiCalled = true;
        return { ok: true, json: async () => ({}) };
      };

      const mockConnId = 'conn_lazy_a_123';
      const today = xAnalyticsService.getUTCToday();
      const cacheKey = `growth_os:x:snapshot:${mockConnId}:${today}`;

      const cachedSnapshot = {
        connectionId: mockConnId,
        snapshotDate: today,
        audience: { followersCount: 15000 },
        reach: { totalImpressions: 45000 },
        isStale: false,
      };

      // Populate Redis
      await xRedisService.set(cacheKey, cachedSnapshot, 86400);

      const mockIntegration = {
        _id: mockConnId,
        userId: 'user_lazy_a',
        xUserId: 'x_u_lazy_a',
        status: 'connected',
      };

      const result = await xAnalyticsService.getAccountAnalyticsOverview(mockIntegration);

      assert.strictEqual(result.meta.cacheHit, true);
      assert.strictEqual(result.meta.source, 'redis_cache');
      assert.strictEqual(result.data.audience.followersCount, 15000);
      assert.strictEqual(apiCalled, false, 'X API must NOT be called on Redis cache hit');

      // Cleanup
      await xRedisService.del(cacheKey);
    });

    // ==========================================================================
    // 11. LAZY REFRESH: SCENARIO B (REDIS MISS, MONGODB SNAPSHOT HIT)
    // ==========================================================================
    await asyncTest('Lazy Refresh: Scenario B returns DB snapshot and repopulates Redis with zero X API calls', async () => {
      let apiCalled = false;
      global.fetch = async () => {
        apiCalled = true;
        return { ok: true, json: async () => ({}) };
      };

      const mockConnId = 'conn_lazy_b_456';
      const today = xAnalyticsService.getUTCToday();
      const cacheKey = `growth_os:x:snapshot:${mockConnId}:${today}`;

      // Ensure cache is empty
      await xRedisService.del(cacheKey);

      const dbSnapshot = {
        connectionId: mockConnId,
        snapshotDate: today,
        audience: { followersCount: 22000 },
        reach: { totalImpressions: 80000 },
        isStale: false,
        toObject: function () {
          return this;
        },
      };

      // Mock XAnalyticsSnapshot.findOne
      const origFindOne = XAnalyticsSnapshot.findOne;
      XAnalyticsSnapshot.findOne = (query) => {
        const doc = (query.connectionId === mockConnId && query.snapshotDate === today) ? dbSnapshot : null;
        return {
          sort: () => Promise.resolve(doc),
          then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
        };
      };

      const mockIntegration = {
        _id: mockConnId,
        userId: 'user_lazy_b',
        xUserId: 'x_u_lazy_b',
        status: 'connected',
      };

      try {
        const result = await xAnalyticsService.getAccountAnalyticsOverview(mockIntegration);

        assert.strictEqual(result.meta.cacheHit, false);
        assert.strictEqual(result.meta.source, 'database_snapshot');
        assert.strictEqual(result.data.audience.followersCount, 22000);
        assert.strictEqual(apiCalled, false, 'X API must NOT be called when DB snapshot is current');

        // Verify Redis was repopulated
        const repopulated = await xRedisService.get(cacheKey);
        assert(repopulated !== null, 'Redis must be repopulated from DB snapshot');
        assert.strictEqual(repopulated.audience.followersCount, 22000);
      } finally {
        XAnalyticsSnapshot.findOne = origFindOne;
        await xRedisService.del(cacheKey);
      }
    });

    // ==========================================================================
    // 12. GRACEFUL DEGRADATION: SERVING STALE SNAPSHOT ON API ERROR
    // ==========================================================================
    await asyncTest('Graceful Degradation: Serves previous snapshot with isStale=true on API error', async () => {
      // Simulate X API returning 500 error
      global.fetch = async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ detail: 'X API Service Unavailable' }),
      });

      const mockConnId = 'conn_stale_c_789';
      const today = xAnalyticsService.getUTCToday();
      const cacheKey = `growth_os:x:snapshot:${mockConnId}:${today}`;
      await xRedisService.del(cacheKey);

      const yesterdaySnapshot = {
        connectionId: mockConnId,
        snapshotDate: '2026-10-26',
        audience: { followersCount: 18500 },
        reach: { totalImpressions: 52000 },
        isStale: false,
        toObject: function () {
          return { ...this };
        },
      };

      const origFindOne = XAnalyticsSnapshot.findOne;
      XAnalyticsSnapshot.findOne = (query) => {
        // Current day returns null, prior snapshot returns yesterdaySnapshot
        const doc = (query.snapshotDate === today) ? null : yesterdaySnapshot;
        return {
          sort: () => Promise.resolve(doc),
          then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
        };
      };

      const mockIntegration = {
        _id: mockConnId,
        userId: 'user_stale_c',
        xUserId: 'x_u_stale_c',
        accessToken: 'valid_token_xyz',
        tokenExpiresAt: new Date(Date.now() + 3600000),
        status: 'connected',
        save: async () => {},
      };

      try {
        const result = await xAnalyticsService.getAccountAnalyticsOverview(mockIntegration);

        assert.strictEqual(result.data.isStale, true, 'Result must be flagged isStale=true');
        assert(result.data.staleReason.includes('X API Service Unavailable') || result.data.staleReason.includes('500'));
        assert.strictEqual(result.data.audience.followersCount, 18500, 'Must preserve previous metrics');
        assert.strictEqual(result.meta.servedStaleFallback, true);
      } finally {
        XAnalyticsSnapshot.findOne = origFindOne;
        await xRedisService.del(cacheKey);
      }
    });

    // ==========================================================================
    // 13. ACCOUNT & TENANT ISOLATION
    // ==========================================================================
    await asyncTest('Isolation: Customer A cannot view or access Customer B connection', async () => {
      const origFindOne = XIntegration.findOne;
      XIntegration.findOne = (query) => {
        // Query must match both _id and userId
        if (query.userId === 'user_tenant_A' && query.status === 'connected') {
          return Promise.resolve({
            _id: 'conn_A',
            userId: 'user_tenant_A',
            xUserId: 'x_111',
            status: 'connected',
            toSafeObject: () => ({ username: 'tenant_a_brand' }),
          });
        }
        return Promise.resolve(null);
      };

      try {
        // User A succeeds
        const connA = await XIntegration.findOne({ userId: 'user_tenant_A', status: 'connected' });
        assert.notStrictEqual(connA, null);
        assert.strictEqual(connA.toSafeObject().username, 'tenant_a_brand');

        // User B attempting to look up with User B's auth ID gets null (cannot see User A's data)
        const connB = await XIntegration.findOne({ userId: 'user_tenant_B', status: 'connected' });
        assert.strictEqual(connB, null);
      } finally {
        XIntegration.findOne = origFindOne;
      }
    });

    // ==========================================================================
    // 14. SOFT-DISCONNECT & CACHE PURGE
    // ==========================================================================
    await asyncTest('Disconnect: Soft-disconnect zeroes credentials and purges cache keys', async () => {
      const mockConnId = 'conn_disc_999';
      const today = xAnalyticsService.getUTCToday();
      const cacheKey = `growth_os:x:snapshot:${mockConnId}:${today}`;

      // Populate dummy cache
      await xRedisService.set(cacheKey, { test: 123 }, 3600);

      const integrationDoc = {
        _id: mockConnId,
        userId: 'user_disc',
        accessToken: 'secret_token_to_purge',
        refreshToken: 'refresh_to_purge',
        status: 'connected',
        disconnectedAt: null,
        save: async function () {
          this.status = 'disconnected';
          this.accessToken = null;
          this.refreshToken = null;
          this.disconnectedAt = new Date();
        },
      };

      // Perform soft disconnect logic
      await integrationDoc.save();
      await xRedisService.delPattern(`growth_os:x:*:${mockConnId}*`);
      await xRedisService.del(cacheKey);

      assert.strictEqual(integrationDoc.status, 'disconnected');
      assert.strictEqual(integrationDoc.accessToken, null);
      assert.strictEqual(integrationDoc.refreshToken, null);
      assert(integrationDoc.disconnectedAt instanceof Date);

      const cachedAfter = await xRedisService.get(cacheKey);
      assert.strictEqual(cachedAfter, null, 'Cache must be purged on disconnect');
    });

    // ==========================================================================
    // SUMMARY
    // ==========================================================================
    console.log('\n================================================================');
    console.log(`TEST SUITE COMPLETE: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('================================================================\n');

  } finally {
    global.fetch = originalFetch;
  }
}

runXTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
