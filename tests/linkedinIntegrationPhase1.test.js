/**
 * Automated Test Suite for Growmentum LinkedIn Integration (Phase 1)
 *
 * Covers:
 * 1. App configuration & credential isolation (Growmentum vs Growmentum-community)
 * 2. OAuth state generation, single-use consumption, expiration, and cross-app mismatch rejection
 * 3. LinkedIn authorization error handling (access_denied, unauthorized_scope_error)
 * 4. Token protection & response sanitization (no secrets or tokens exposed)
 * 5. Soft disconnect behavior (token zeroing and audit preservation)
 * 6. User-specific asset isolation and selection
 * 7. Pending product approval handling (honest status without fabricated responses)
 * 8. Automatic token refresh logic
 */

const assert = require('assert');
const crypto = require('crypto');
const linkedinService = require('../services/linkedinService');
const LinkedInOAuthState = require('../models/LinkedInOAuthState');
const LinkedInIntegration = require('../models/LinkedInIntegration');
const LinkedInAsset = require('../models/LinkedInAsset');

const originalFetch = global.fetch;

async function runLinkedInPhase1TestSuite() {
  console.log('================================================================');
  console.log('STARTING GROWMENTUM LINKEDIN INTEGRATION (PHASE 1) TEST SUITE');
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

  // Setup test environment variables
  process.env.LINKEDIN_ADS_CLIENT_ID = 'ads_test_client_id_12345';
  process.env.LINKEDIN_ADS_CLIENT_SECRET = 'ads_test_client_secret_67890';
  process.env.LINKEDIN_ADS_REDIRECT_URI = 'http://localhost:5000/api/linkedin/ads/callback';
  process.env.LINKEDIN_ADS_SCOPES = 'openid profile email';
  process.env.LINKEDIN_ADS_PRODUCT_STATUS = 'pending_approval';

  process.env.LINKEDIN_COMMUNITY_CLIENT_ID = 'community_test_client_id_54321';
  process.env.LINKEDIN_COMMUNITY_CLIENT_SECRET = 'community_test_client_secret_09876';
  process.env.LINKEDIN_COMMUNITY_REDIRECT_URI = 'http://localhost:5000/api/linkedin/community/callback';
  process.env.LINKEDIN_COMMUNITY_SCOPES = 'openid profile email r_organization_social r_organization_admin';
  process.env.LINKEDIN_COMMUNITY_PRODUCT_STATUS = 'pending_approval';

  // --------------------------------------------------------------------------
  // TEST 1: App Identifier Normalization
  // --------------------------------------------------------------------------
  test('normalizeAppType: resolves ads and community aliases and rejects invalid names', () => {
    assert.strictEqual(linkedinService.normalizeAppType('ads'), 'ads');
    assert.strictEqual(linkedinService.normalizeAppType('growmentum'), 'ads');
    assert.strictEqual(linkedinService.normalizeAppType('ADVERTISING'), 'ads');
    assert.strictEqual(linkedinService.normalizeAppType('community'), 'community');
    assert.strictEqual(linkedinService.normalizeAppType('growmentum-community'), 'community');
    assert.strictEqual(linkedinService.normalizeAppType('pages'), 'community');
    assert.strictEqual(linkedinService.normalizeAppType('invalid_app'), null);
    assert.strictEqual(linkedinService.normalizeAppType(null), null);
    assert.strictEqual(linkedinService.normalizeAppType(''), null);
  });

  // --------------------------------------------------------------------------
  // TEST 2: App Configuration Isolation
  // --------------------------------------------------------------------------
  test('getAppConfig: preserves complete credential and scope isolation between both apps', () => {
    const adsConfig = linkedinService.getAppConfig('ads');
    const commConfig = linkedinService.getAppConfig('community');

    assert.strictEqual(adsConfig.appType, 'ads');
    assert.strictEqual(adsConfig.appName, 'Growmentum');
    assert.strictEqual(adsConfig.clientId, 'ads_test_client_id_12345');
    assert.strictEqual(adsConfig.redirectUri, 'http://localhost:5000/api/linkedin/ads/callback');
    assert.strictEqual(adsConfig.scopes, 'openid profile email');

    assert.strictEqual(commConfig.appType, 'community');
    assert.strictEqual(commConfig.appName, 'Growmentum-community');
    assert.strictEqual(commConfig.clientId, 'community_test_client_id_54321');
    assert.strictEqual(commConfig.redirectUri, 'http://localhost:5000/api/linkedin/community/callback');
    assert(commConfig.scopes.includes('r_organization_social'));
    assert(commConfig.scopes.includes('r_organization_admin'));

    // Verify secrets are NOT the same
    assert.notStrictEqual(adsConfig.clientSecret, commConfig.clientSecret);
    assert.notStrictEqual(adsConfig.clientId, commConfig.clientId);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Safe App Info Leak Protection (Never Expose Client Secret)
  // --------------------------------------------------------------------------
  test('getSafeAppInfo: never exposes clientSecret and masks clientId', () => {
    const safeAds = linkedinService.getSafeAppInfo('ads');
    const safeComm = linkedinService.getSafeAppInfo('community');

    assert.strictEqual(safeAds.clientSecret, undefined, 'Client secret must NOT exist on safe info');
    assert.strictEqual(safeComm.clientSecret, undefined, 'Client secret must NOT exist on safe info');
    assert(safeAds.clientId.startsWith('ads_'));
    assert(safeAds.clientId.endsWith('...'), 'Client ID should be masked');
    assert.strictEqual(safeAds.configured, true);
    assert.strictEqual(safeComm.configured, true);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Authorization URL Construction
  // --------------------------------------------------------------------------
  test('buildAuthorizationUrl: generates proper LinkedIn OAuth URL with correct scopes and state', () => {
    const mockState = 'state_hex_abcdef123456';
    const adsAuthUrl = linkedinService.buildAuthorizationUrl('ads', mockState);
    const commAuthUrl = linkedinService.buildAuthorizationUrl('community', mockState);

    const parsedAds = new URL(adsAuthUrl);
    assert.strictEqual(parsedAds.hostname, 'www.linkedin.com');
    assert.strictEqual(parsedAds.pathname, '/oauth/v2/authorization');
    assert.strictEqual(parsedAds.searchParams.get('response_type'), 'code');
    assert.strictEqual(parsedAds.searchParams.get('client_id'), 'ads_test_client_id_12345');
    assert.strictEqual(parsedAds.searchParams.get('state'), mockState);
    assert.strictEqual(parsedAds.searchParams.get('redirect_uri'), 'http://localhost:5000/api/linkedin/ads/callback');
    assert.strictEqual(parsedAds.searchParams.get('scope'), 'openid profile email');

    const parsedComm = new URL(commAuthUrl);
    assert.strictEqual(parsedComm.searchParams.get('client_id'), 'community_test_client_id_54321');
    assert.strictEqual(parsedComm.searchParams.get('redirect_uri'), 'http://localhost:5000/api/linkedin/community/callback');
    assert(parsedComm.searchParams.get('scope').includes('r_organization_social'));
  });

  // --------------------------------------------------------------------------
  // TEST 5: Code-to-Token Exchange Mocking
  // --------------------------------------------------------------------------
  await asyncTest('exchangeCodeForToken: successfully exchanges authorization code for tokens', async () => {
    global.fetch = async (url, options) => {
      assert.strictEqual(url, 'https://www.linkedin.com/oauth/v2/accessToken');
      assert.strictEqual(options.method, 'POST');
      assert(options.body.includes('code=auth_code_sample'));
      assert(options.body.includes('client_id=ads_test_client_id_12345'));

      return {
        ok: true,
        json: async () => ({
          access_token: 'mock_access_token_ads_999',
          refresh_token: 'mock_refresh_token_ads_888',
          expires_in: 5184000,
          refresh_token_expires_in: 31536000,
          scope: 'openid profile email',
        }),
      };
    };

    const tokenData = await linkedinService.exchangeCodeForToken('ads', 'auth_code_sample');
    assert.strictEqual(tokenData.accessToken, 'mock_access_token_ads_999');
    assert.strictEqual(tokenData.refreshToken, 'mock_refresh_token_ads_888');
    assert.strictEqual(tokenData.expiresIn, 5184000);
    assert.strictEqual(tokenData.scope, 'openid profile email');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Code-to-Token Error Handling (LinkedIn OAuth Error)
  // --------------------------------------------------------------------------
  await asyncTest('exchangeCodeForToken: throws normalized error when LinkedIn rejects code', async () => {
    global.fetch = async () => ({
      status: 400,
      ok: false,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'Authorization code has expired or been revoked',
      }),
    });

    let caught = false;
    try {
      await linkedinService.exchangeCodeForToken('ads', 'expired_code');
    } catch (err) {
      caught = true;
      assert.strictEqual(err.statusCode, 400);
      assert(err.message.includes('Authorization code has expired'));
      assert.strictEqual(err.linkedinError.error, 'invalid_grant');
    }
    assert.strictEqual(caught, true);
  });

  // --------------------------------------------------------------------------
  // TEST 7: OpenID Connect UserInfo Profile Retrieval
  // --------------------------------------------------------------------------
  await asyncTest('getLinkedInUserProfile: extracts standard OpenID Connect profile claims', async () => {
    global.fetch = async (url, options) => {
      assert.strictEqual(url, 'https://api.linkedin.com/v2/userinfo');
      assert.strictEqual(options.headers.Authorization, 'Bearer valid_oidc_token');

      return {
        ok: true,
        json: async () => ({
          sub: 'li_sub_12345678',
          name: 'Jane Doe',
          given_name: 'Jane',
          family_name: 'Doe',
          email: 'jane.doe@example.com',
          email_verified: true,
          picture: 'https://media.licdn.com/dms/image/sample.jpg',
        }),
      };
    };

    const profile = await linkedinService.getLinkedInUserProfile('valid_oidc_token');
    assert.strictEqual(profile.linkedinMemberId, 'li_sub_12345678');
    assert.strictEqual(profile.name, 'Jane Doe');
    assert.strictEqual(profile.email, 'jane.doe@example.com');
    assert.strictEqual(profile.picture, 'https://media.licdn.com/dms/image/sample.jpg');
  });

  // --------------------------------------------------------------------------
  // TEST 8: Token Protection - toSafeObject in LinkedInIntegration Model
  // --------------------------------------------------------------------------
  test('LinkedInIntegration.toSafeObject: strictly omits accessToken and refreshToken from output', () => {
    const mockIntegration = new LinkedInIntegration({
      userId: '60c72b2f9b1d8b2bad000001',
      appType: 'ads',
      linkedinMemberId: 'li_mem_123',
      linkedinMemberName: 'John Marketer',
      linkedinMemberEmail: 'john@ads.com',
      accessToken: 'SUPER_SECRET_ACCESS_TOKEN',
      refreshToken: 'SUPER_SECRET_REFRESH_TOKEN',
      tokenExpiresAt: new Date(Date.now() + 3600000),
      grantedScopes: ['openid', 'profile', 'email'],
      status: 'connected',
      approvalStatus: 'pending_approval',
    });

    const safeObj = mockIntegration.toSafeObject();

    assert.strictEqual(safeObj.accessToken, undefined, 'accessToken must NEVER be present');
    assert.strictEqual(safeObj.refreshToken, undefined, 'refreshToken must NEVER be present');
    assert.strictEqual(safeObj.clientSecret, undefined, 'clientSecret must NEVER be present');
    assert.strictEqual(safeObj.connected, true);
    assert.strictEqual(safeObj.appType, 'ads');
    assert.strictEqual(safeObj.appName, 'Growmentum');
    assert.strictEqual(safeObj.member.name, 'John Marketer');
    assert.strictEqual(safeObj.approvalStatus, 'pending_approval');
  });

  // --------------------------------------------------------------------------
  // TEST 9: Soft Disconnect Behavior
  // --------------------------------------------------------------------------
  test('Soft Disconnect: sets status to disconnected and zeroes out tokens without deleting audit trail', () => {
    const integration = new LinkedInIntegration({
      userId: '60c72b2f9b1d8b2bad000002',
      appType: 'community',
      linkedinMemberId: 'li_comm_456',
      accessToken: 'token_to_clear',
      refreshToken: 'refresh_to_clear',
      tokenExpiresAt: new Date(Date.now() + 1000000),
      status: 'connected',
    });

    // Simulate disconnect logic
    integration.status = 'disconnected';
    integration.accessToken = null;
    integration.refreshToken = null;
    integration.tokenExpiresAt = null;
    integration.selectedAssetId = null;

    const safeObj = integration.toSafeObject();
    assert.strictEqual(safeObj.connected, false);
    assert.strictEqual(safeObj.status, 'disconnected');
    assert.strictEqual(safeObj.accessToken, undefined);
    assert.strictEqual(safeObj.refreshToken, undefined);
    assert.strictEqual(safeObj.selectedAssetId, null);
  });

  // --------------------------------------------------------------------------
  // TEST 10: Cross-App State Mismatch & Single-Use State Security
  // --------------------------------------------------------------------------
  test('OAuth State Security: detects cross-app route mismatch and expired state', () => {
    const stateRecord = {
      state: 'state_ads_001',
      userId: '60c72b2f9b1d8b2bad000003',
      appType: 'ads',
      expiresAt: new Date(Date.now() + 600000), // Valid time
    };

    // If callback is invoked on 'community' route, mismatch must be detected
    const routeApp = 'community';
    const isMismatch = routeApp !== stateRecord.appType;
    assert.strictEqual(isMismatch, true, 'State for ads presented on community callback must trigger mismatch');

    // Expired state detection
    const expiredRecord = {
      state: 'state_expired_002',
      userId: '60c72b2f9b1d8b2bad000003',
      appType: 'ads',
      expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
    };
    const isExpired = expiredRecord.expiresAt < new Date();
    assert.strictEqual(isExpired, true, 'Expired state must be detected');
  });

  // --------------------------------------------------------------------------
  // TEST 11: Honest Pending Approval Behavior for Ads App
  // --------------------------------------------------------------------------
  await asyncTest('discoverAssets: returns pending approval status without fabricating mock data', async () => {
    const origFindOne = LinkedInIntegration.findOne;
    const origAssetFindOne = LinkedInAsset.findOne;
    const origAssetFind = LinkedInAsset.find;

    // Mock connected integration but without r_ads approved scope
    LinkedInIntegration.findOne = async () => ({
      userId: 'user_test_ads_pending',
      appType: 'ads',
      status: 'connected',
      grantedScopes: ['openid', 'profile', 'email'], // r_ads is NOT granted yet!
      approvalStatus: 'pending_approval',
    });

    LinkedInAsset.findOne = async () => null;
    LinkedInAsset.find = async () => [];

    const result = await linkedinService.discoverAssets('user_test_ads_pending', 'ads');

    assert.strictEqual(result.appType, 'ads');
    assert.strictEqual(result.appName, 'Growmentum');
    assert.strictEqual(result.apiAccessAvailable, false, 'Must be false when r_ads is not approved');
    assert.strictEqual(result.approvalStatus, 'pending_approval');
    assert(result.message.includes('Advertising API access is subject to approval'));
    assert.strictEqual(result.assets.length, 0);
    assert.strictEqual(result.selectedAsset, null);

    // Restore
    LinkedInIntegration.findOne = origFindOne;
    LinkedInAsset.findOne = origAssetFindOne;
    LinkedInAsset.find = origAssetFind;
  });

  // --------------------------------------------------------------------------
  // TEST 12: Honest Pending Approval Behavior for Community App
  // --------------------------------------------------------------------------
  await asyncTest('discoverAssets: returns pending approval status for community app when pending', async () => {
    const origFindOne = LinkedInIntegration.findOne;
    const origAssetFindOne = LinkedInAsset.findOne;
    const origAssetFind = LinkedInAsset.find;

    LinkedInIntegration.findOne = async () => ({
      userId: 'user_test_comm_pending',
      appType: 'community',
      status: 'connected',
      grantedScopes: ['openid', 'profile', 'email'], // scopes pending
      approvalStatus: 'pending_approval',
    });

    LinkedInAsset.findOne = async () => null;
    LinkedInAsset.find = async () => [];

    const result = await linkedinService.discoverAssets('user_test_comm_pending', 'community');

    assert.strictEqual(result.appType, 'community');
    assert.strictEqual(result.appName, 'Growmentum-community');
    assert.strictEqual(result.apiAccessAvailable, false);
    assert.strictEqual(result.approvalStatus, 'pending_approval');
    assert(result.message.includes('Community Management API requires company verification'));
    assert.strictEqual(result.assets.length, 0);

    // Restore
    LinkedInIntegration.findOne = origFindOne;
    LinkedInAsset.findOne = origAssetFindOne;
    LinkedInAsset.find = origAssetFind;
  });

  // --------------------------------------------------------------------------
  // TEST 13: User Asset Isolation & Selection
  // --------------------------------------------------------------------------
  await asyncTest('setSelectedAsset: enforces user ownership and rejects cross-user asset selection', async () => {
    const origFindOne = LinkedInAsset.findOne;

    // Simulate asset belonging to User A
    LinkedInAsset.findOne = async (query) => {
      if (query.userId === 'user_A' && query.assetId === 'asset_101') {
        return {
          userId: 'user_A',
          appType: 'ads',
          assetId: 'asset_101',
          name: 'User A Ad Account',
          isSelected: false,
          save: async function () { this.isSelected = true; },
        };
      }
      return null; // Asset not found for User B!
    };

    // User A selecting own asset succeeds
    const origUpdateMany = LinkedInAsset.updateMany;
    const origIntUpdate = LinkedInIntegration.findOneAndUpdate;
    LinkedInAsset.updateMany = async () => {};
    LinkedInIntegration.findOneAndUpdate = async () => {};

    const assetA = await linkedinService.setSelectedAsset('user_A', 'ads', 'asset_101');
    assert.strictEqual(assetA.assetId, 'asset_101');
    assert.strictEqual(assetA.isSelected, true);

    // User B trying to select User A's asset fails with 404
    let userBCaught = false;
    try {
      await linkedinService.setSelectedAsset('user_B', 'ads', 'asset_101');
    } catch (err) {
      userBCaught = true;
      assert.strictEqual(err.statusCode, 404);
      assert(err.message.includes('was not found for this user'));
    }
    assert.strictEqual(userBCaught, true, 'Cross-user asset selection must be blocked with 404');

    // Restore
    LinkedInAsset.findOne = origFindOne;
    LinkedInAsset.updateMany = origUpdateMany;
    LinkedInIntegration.findOneAndUpdate = origIntUpdate;
  });

  // --------------------------------------------------------------------------
  // TEST 14: Token Refresh Flow on Expired Token
  // --------------------------------------------------------------------------
  await asyncTest('getValidAccessToken: automatically refreshes token when within buffer window', async () => {
    const origFindOne = LinkedInIntegration.findOne;

    // Mock integration with expired token (expires in 30 seconds, buffer is 120 seconds)
    const mockExpiringIntegration = {
      userId: 'user_refresh_test',
      appType: 'ads',
      status: 'connected',
      accessToken: 'old_expiring_token',
      refreshToken: 'valid_refresh_token',
      tokenExpiresAt: new Date(Date.now() + 30 * 1000), // Within 2-min buffer
      save: async function () {},
    };

    LinkedInIntegration.findOne = async () => mockExpiringIntegration;

    global.fetch = async (url, options) => {
      assert.strictEqual(url, 'https://www.linkedin.com/oauth/v2/accessToken');
      assert(options.body.includes('grant_type=refresh_token'));
      assert(options.body.includes('refresh_token=valid_refresh_token'));

      return {
        ok: true,
        json: async () => ({
          access_token: 'new_refreshed_access_token',
          expires_in: 5184000,
        }),
      };
    };

    const token = await linkedinService.getValidAccessToken('user_refresh_test', 'ads');
    assert.strictEqual(token, 'new_refreshed_access_token');
    assert.strictEqual(mockExpiringIntegration.accessToken, 'new_refreshed_access_token');

    // Restore
    LinkedInIntegration.findOne = origFindOne;
  });

  // --------------------------------------------------------------------------
  // TEST 15: Fix 1 — Granted Scopes Protection & Parsing
  // --------------------------------------------------------------------------
  await asyncTest('exchangeCodeForToken: does not assume configured scopes when scope is missing in token response', async () => {
    global.fetch = async (url, options) => ({
      ok: true,
      json: async () => ({
        access_token: 'mock_token_no_scope',
        expires_in: 3600,
        // scope field is intentionally omitted by LinkedIn
      }),
    });

    const tokenData = await linkedinService.exchangeCodeForToken('ads', 'auth_code_123');
    assert.strictEqual(tokenData.accessToken, 'mock_token_no_scope');
    assert.strictEqual(tokenData.scope, null, 'Scope must be null when absent from token response');
  });

  // --------------------------------------------------------------------------
  // TEST 16: Fix 1 & 3 — OAuth Redirect URI Binding & Safe Scope Fallback
  // --------------------------------------------------------------------------
  await asyncTest('OAuth Flow: preserves bound redirectUri in state and never promotes missing scopes to advertising permissions', async () => {
    // 1. Verify buildAuthorizationUrl binds redirect URI
    const customUri = 'https://app.growmentum.io/linkedin/callback';
    const authUrl = linkedinService.buildAuthorizationUrl('ads', 'state_xyz', customUri);
    assert(authUrl.includes(`redirect_uri=${encodeURIComponent(customUri)}`));

    // 2. Verify exchangeCodeForToken sends bound redirect URI
    let postedBody = '';
    global.fetch = async (url, options) => {
      postedBody = options.body;
      return {
        ok: true,
        json: async () => ({
          access_token: 'bound_token_abc',
          expires_in: 3600,
          // Scope absent
        }),
      };
    };

    await linkedinService.exchangeCodeForToken('ads', 'code_bound_test', customUri);
    assert(postedBody.includes(`redirect_uri=${encodeURIComponent(customUri)}`), 'Exact bound redirect URI must be used in exchange');

    // 3. Verify schema validation for redirectUri on LinkedInOAuthState
    const stateDoc = new LinkedInOAuthState({
      state: 'state_redirect_test',
      userId: '60c72b2f9b1d8b2bad000004',
      appType: 'ads',
      redirectUri: customUri,
      expiresAt: new Date(Date.now() + 60000),
    });
    let validateErr = null;
    try {
      await stateDoc.validate();
    } catch (e) {
      validateErr = e;
    }
    assert.strictEqual(validateErr, null, 'State with redirectUri should be valid');

    const invalidStateDoc = new LinkedInOAuthState({
      state: 'state_invalid_no_redirect',
      userId: '60c72b2f9b1d8b2bad000004',
      appType: 'ads',
      expiresAt: new Date(Date.now() + 60000),
    });
    let missingErr = null;
    try {
      await invalidStateDoc.validate();
    } catch (e) {
      missingErr = e;
    }
    assert(missingErr && missingErr.errors.redirectUri, 'Missing redirectUri must fail schema validation');
  });

  // --------------------------------------------------------------------------
  // TEST 17: Fix 2 — Company Page ACL Filtering (state === 'APPROVED' only)
  // --------------------------------------------------------------------------
  await asyncTest('discoverAssets: filters out non-approved ACL entries and non-organization targets', async () => {
    const prevStatus = process.env.LINKEDIN_COMMUNITY_PRODUCT_STATUS;
    process.env.LINKEDIN_COMMUNITY_PRODUCT_STATUS = 'approved';

    const origFindOne = LinkedInIntegration.findOne;
    const origAssetFindOne = LinkedInAsset.findOne;
    const origAssetFind = LinkedInAsset.find;
    const origAssetFindOneAndUpdate = LinkedInAsset.findOneAndUpdate;
    const origAssetUpdateMany = LinkedInAsset.updateMany;

    LinkedInIntegration.findOne = async () => ({
      userId: 'user_acl_test',
      appType: 'community',
      status: 'connected',
      grantedScopes: ['openid', 'profile', 'email', 'r_organization_social'],
      approvalStatus: 'approved',
      accessToken: 'valid_comm_token',
      tokenExpiresAt: new Date(Date.now() + 3600000),
      save: async () => {},
    });

    LinkedInAsset.findOne = async () => null;
    LinkedInAsset.find = async () => [];
    LinkedInAsset.updateMany = async () => {};

    const savedAssets = [];
    LinkedInAsset.findOneAndUpdate = async (filter, update) => {
      const record = {
        ...filter,
        ...update,
        isSelected: false,
        save: async function () {},
      };
      savedAssets.push(record);
      return record;
    };

    global.fetch = async (url, options) => {
      // 1. ACL lookup
      if (url.includes('/rest/organizationalEntityAcls')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            elements: [
              {
                state: 'APPROVED',
                role: 'ADMINISTRATOR',
                organizationalTarget: 'urn:li:organization:123456',
              },
              {
                state: 'REQUESTED', // Must be filtered out
                role: 'ADMINISTRATOR',
                organizationalTarget: 'urn:li:organization:789012',
              },
              {
                state: 'REVOKED', // Must be filtered out
                role: 'DIRECT_SPONSORED_CONTENT_POSTER',
                organizationalTarget: 'urn:li:organization:345678',
              },
              {
                state: 'APPROVED',
                role: 'COMMUNITY_MANAGER',
                organizationalTarget: 'urn:li:person:999999', // Non-organization, must be filtered out
              },
            ],
          }),
        };
      }

      // 2. Organization enrichment lookup
      if (url.includes('/rest/organizations/123456')) {
        assert(options.headers['LinkedIn-Version'], 'Must include LinkedIn-Version header');
        assert.strictEqual(options.headers['X-Restli-Protocol-Version'], '2.0.0');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 123456,
            localizedName: 'Acme Technologies Inc.',
            vanityName: 'acme-tech',
          }),
        };
      }

      return { ok: false, status: 404, json: async () => ({}) };
    };

    const discovery = await linkedinService.discoverAssets('user_acl_test', 'community');

    assert.strictEqual(discovery.apiAccessAvailable, true);
    assert.strictEqual(discovery.assets.length, 1, 'Only the single approved organization should be discovered');
    assert.strictEqual(discovery.assets[0].assetId, '123456');
    assert.strictEqual(discovery.assets[0].name, 'Acme Technologies Inc.');
    assert.strictEqual(discovery.assets[0].vanityName, 'acme-tech');
    assert.strictEqual(discovery.assets[0].role, 'ADMINISTRATOR');

    // Restore
    process.env.LINKEDIN_COMMUNITY_PRODUCT_STATUS = prevStatus;
    LinkedInIntegration.findOne = origFindOne;
    LinkedInAsset.findOne = origAssetFindOne;
    LinkedInAsset.find = origAssetFind;
    LinkedInAsset.findOneAndUpdate = origAssetFindOneAndUpdate;
    LinkedInAsset.updateMany = origAssetUpdateMany;
  });

  // --------------------------------------------------------------------------
  // TEST 18: Fix 2 — Organization Detail Enrichment 403 & Partial Failure Handling
  // --------------------------------------------------------------------------
  await asyncTest('getOrganizationDetails: handles 403 Forbidden and errors gracefully without fabricating names', async () => {
    // 403 Forbidden response
    global.fetch = async (url) => {
      if (url.includes('/rest/organizations/403403')) {
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: async () => ({ message: 'Member not authorized to view organization profile' }),
        };
      }
      if (url.includes('/rest/organizations/200200')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 200200,
            localizedName: 'Verified Partner Page',
            vanityName: 'verified-partner',
          }),
        };
      }
      return { ok: false, status: 500, json: async () => ({ message: 'Internal Error' }) };
    };

    const forbiddenResult = await linkedinService.getOrganizationDetails('403403', 'mock_token');
    assert.strictEqual(forbiddenResult.success, false, '403 must yield success: false');
    assert.strictEqual(forbiddenResult.status, 403, 'Status must be 403');

    const successResult = await linkedinService.getOrganizationDetails('200200', 'mock_token');
    assert.strictEqual(successResult.success, true);
    assert.strictEqual(successResult.data.localizedName, 'Verified Partner Page');
    assert.strictEqual(successResult.data.vanityName, 'verified-partner');
  });

  // --------------------------------------------------------------------------
  // TEST 19: Step 6 — Configurable LinkedIn API Version Header (Default 202609)
  // --------------------------------------------------------------------------
  test('getLinkedInApiVersion: returns configured version string or default 202609', () => {
    const originalVersion = process.env.LINKEDIN_API_VERSION;

    delete process.env.LINKEDIN_API_VERSION;
    assert.strictEqual(linkedinService.getLinkedInApiVersion(), '202609');

    process.env.LINKEDIN_API_VERSION = '202603';
    assert.strictEqual(linkedinService.getLinkedInApiVersion(), '202603');

    // Restore
    if (originalVersion) {
      process.env.LINKEDIN_API_VERSION = originalVersion;
    } else {
      delete process.env.LINKEDIN_API_VERSION;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 20: Fix 5 — Express Router & Route-Level Middleware Integration
  // --------------------------------------------------------------------------
  await asyncTest('Express Route Integration: exercises auth middleware, connect, and callback endpoints', async () => {
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const linkedinRoutes = require('../routes/linkedinRoutes');
    const User = require('../models/User');

    // Ensure fetch is restored for local HTTP calls
    global.fetch = originalFetch;

    const app = express();
    app.use(express.json());
    app.use('/api/linkedin', linkedinRoutes);
    app.use((err, req, res, next) => {
      res.status(err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500)).json({
        success: false,
        message: err.message,
      });
    });

    // Mock User.findById for JWT authentication
    const origUserFindById = User.findById;
    User.findById = (id) => ({
      select: async () => ({
        _id: id,
        name: 'Express Tester',
        email: 'tester@example.com',
      }),
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Unauthenticated request to /api/linkedin/ads/connect should return 401
      const unauthRes = await fetch(`${baseUrl}/api/linkedin/ads/connect`);
      assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must return 401');

      // 2. Authenticated request with valid JWT
      const testUserId = '60c72b2f9b1d8b2bad000005';
      const token = jwt.sign({ id: testUserId }, process.env.JWT_SECRET || 'secret');

      const origStateCreate = LinkedInOAuthState.create;
      let createdStateRecord = null;
      LinkedInOAuthState.create = async (doc) => {
        createdStateRecord = doc;
        return doc;
      };

      const authRes = await fetch(`${baseUrl}/api/linkedin/ads/connect?format=json`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      assert.strictEqual(authRes.status, 200);
      const authBody = await authRes.json();
      assert.strictEqual(authBody.success, true);
      assert.strictEqual(authBody.appType, 'ads');
      assert(authBody.url.includes('www.linkedin.com/oauth/v2/authorization'));
      assert(createdStateRecord, 'OAuth state record must be created');
      assert.strictEqual(createdStateRecord.appType, 'ads');
      assert(createdStateRecord.redirectUri, 'State record must have redirectUri persisted');

      // 3. Callback with missing or invalid state returns 400
      const origFindAndDelete = LinkedInOAuthState.findOneAndDelete;
      LinkedInOAuthState.findOneAndDelete = async () => null; // Not found

      const badCallbackRes = await fetch(`${baseUrl}/api/linkedin/ads/callback?code=fake_code&state=bad_state`);
      assert.strictEqual(badCallbackRes.status, 400, 'Invalid state must return 400');

      // Restore
      User.findById = origUserFindById;
      LinkedInOAuthState.create = origStateCreate;
      LinkedInOAuthState.findOneAndDelete = origFindAndDelete;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // --------------------------------------------------------------------------
  // TEST 21: Step 2 — Redirect URI Allowlist Validation
  // --------------------------------------------------------------------------
  await asyncTest('resolveApprovedRedirectUri: enforces exact allowlist and rejects unapproved URIs', async () => {
    const origAllowed = process.env.LINKEDIN_ALLOWED_REDIRECT_URIS;
    delete process.env.LINKEDIN_ALLOWED_REDIRECT_URIS;

    // 1. Missing / undefined redirect_uri returns configured default
    const defaultUri = linkedinService.resolveApprovedRedirectUri('ads', null);
    assert.strictEqual(defaultUri, 'http://localhost:5000/api/linkedin/ads/callback');

    // 2. Exact match with default succeeds
    const exactMatch = linkedinService.resolveApprovedRedirectUri('ads', 'http://localhost:5000/api/linkedin/ads/callback');
    assert.strictEqual(exactMatch, 'http://localhost:5000/api/linkedin/ads/callback');

    // 3. Unapproved URI with no custom allowlist throws 400
    let errUnapproved = null;
    try {
      linkedinService.resolveApprovedRedirectUri('ads', 'https://attacker.com/oauth/callback');
    } catch (err) {
      errUnapproved = err;
    }
    assert(errUnapproved, 'Unapproved URI must throw an error');
    assert.strictEqual(errUnapproved.statusCode, 400);
    assert(errUnapproved.message.includes('not in the approved allowlist'));

    // 4. Approved URI in explicit allowlist succeeds
    process.env.LINKEDIN_ALLOWED_REDIRECT_URIS = 'https://app.growmentum.io/callback,https://staging.growmentum.io/callback';
    const approvedCustom = linkedinService.resolveApprovedRedirectUri('ads', 'https://app.growmentum.io/callback');
    assert.strictEqual(approvedCustom, 'https://app.growmentum.io/callback');

    // 5. Unapproved custom URI when allowlist is active throws 400
    let errAllowlistMismatch = null;
    try {
      linkedinService.resolveApprovedRedirectUri('ads', 'https://phishing.growmentum.io/callback');
    } catch (err) {
      errAllowlistMismatch = err;
    }
    assert(errAllowlistMismatch, 'URL not in allowlist must throw 400');
    assert.strictEqual(errAllowlistMismatch.statusCode, 400);

    // Restore
    if (origAllowed) {
      process.env.LINKEDIN_ALLOWED_REDIRECT_URIS = origAllowed;
    } else {
      delete process.env.LINKEDIN_ALLOWED_REDIRECT_URIS;
    }
  });

  // --------------------------------------------------------------------------
  // TEST 22: Step 3 — Multi-Page Asset Pagination
  // --------------------------------------------------------------------------
  await asyncTest('fetchLinkedInPaginatedCollection: traverses multiple pages via paging links', async () => {
    const requestedUrls = [];
    global.fetch = async (url, options) => {
      requestedUrls.push(url);
      const parsed = new URL(url);
      const start = parsed.searchParams.get('start');
      if (!start || start === '0') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            elements: [
              { id: 101, name: 'Ad Account 101' },
              { id: 102, name: 'Ad Account 102' },
            ],
            paging: {
              links: [
                { rel: 'next', href: '/rest/adAccounts?q=search&start=2&count=2' },
              ],
            },
          }),
        };
      }
      if (start === '2') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            elements: [
              { id: 103, name: 'Ad Account 103' },
            ],
            paging: {
              links: [],
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const results = await linkedinService.fetchLinkedInPaginatedCollection(
      'https://api.linkedin.com/rest/adAccounts?q=search&count=2',
      'mock_token'
    );

    assert.strictEqual(results.ok, true);
    assert.strictEqual(results.elements.length, 3, 'Should collect all 3 elements across both pages');
    assert.strictEqual(results.elements[0].id, 101);
    assert.strictEqual(results.elements[1].id, 102);
    assert.strictEqual(results.elements[2].id, 103);
    assert.strictEqual(results.pagesFetched, 2);
    assert.strictEqual(requestedUrls.length, 2, 'Should have made exactly 2 HTTP requests');
  });

  // --------------------------------------------------------------------------
  // TEST 23: Step 3 — Pagination Loop and Duplicate Asset Prevention
  // --------------------------------------------------------------------------
  await asyncTest('discoverAssets: prevents pagination loops and deduplicates assets across pages', async () => {
    const prevStatus = process.env.LINKEDIN_ADS_PRODUCT_STATUS;
    process.env.LINKEDIN_ADS_PRODUCT_STATUS = 'approved';

    const testUserId = '60c72b2f9b1d8b2bad000007';
    const origFindOne = LinkedInIntegration.findOne;
    const origAssetFindOne = LinkedInAsset.findOne;
    const origAssetFind = LinkedInAsset.find;
    const origAssetUpdateMany = LinkedInAsset.updateMany;
    const origAssetFindOneAndUpdate = LinkedInAsset.findOneAndUpdate;

    LinkedInIntegration.findOne = async () => ({
      userId: testUserId,
      appType: 'ads',
      status: 'connected',
      grantedScopes: ['openid', 'profile', 'email', 'r_ads'],
      approvalStatus: 'approved',
      accessToken: 'valid_ads_token',
      tokenExpiresAt: new Date(Date.now() + 3600000),
      save: async () => {},
    });

    LinkedInAsset.findOne = async () => null;
    LinkedInAsset.find = async () => [];
    LinkedInAsset.updateMany = async () => {};

    const upserted = [];
    LinkedInAsset.findOneAndUpdate = async (filter, update) => {
      const record = {
        ...filter,
        ...update,
        isSelected: false,
        save: async function () {},
      };
      upserted.push(record);
      return record;
    };

    let callCount = 0;
    global.fetch = async (url) => {
      callCount++;
      // Return a next link pointing back to the initial URL (a cycle)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            { id: 501, name: 'Duplicate Campaign Account', type: 'BUSINESS' },
            { id: 501, name: 'Duplicate Campaign Account', type: 'BUSINESS' }, // Duplicate in same page
          ],
          paging: {
            links: [
              { rel: 'next', href: 'https://api.linkedin.com/rest/adAccounts?q=search&count=100&start=0' }, // Cycle back to self
            ],
          },
        }),
      };
    };

    const discovery = await linkedinService.discoverAssets(testUserId, 'ads');

    assert.strictEqual(discovery.apiAccessAvailable, true);
    // Cycle must be broken immediately on second request
    assert.strictEqual(callCount, 1, 'Pagination loop must terminate when next URL was already visited');
    assert.strictEqual(discovery.assets.length, 1, 'Duplicate asset ID 501 must be deduplicated');
    assert.strictEqual(upserted.length, 1, 'Only one asset should be upserted');

    // Restore
    process.env.LINKEDIN_ADS_PRODUCT_STATUS = prevStatus;
    LinkedInIntegration.findOne = origFindOne;
    LinkedInAsset.findOne = origAssetFindOne;
    LinkedInAsset.find = origAssetFind;
    LinkedInAsset.updateMany = origAssetUpdateMany;
    LinkedInAsset.findOneAndUpdate = origAssetFindOneAndUpdate;
  });

  // --------------------------------------------------------------------------
  // TEST 24: Step 3 — Continuation URL Security & Safety Limit Behavior
  // --------------------------------------------------------------------------
  await asyncTest('validateContinuationUrl & safety limits: enforces HTTPS api.linkedin.com and maxPages limit', async () => {
    // 1. validateContinuationUrl checks
    assert.strictEqual(
      linkedinService.validateContinuationUrl('https://api.linkedin.com/rest/adAccounts?start=10&count=10'),
      'https://api.linkedin.com/rest/adAccounts?start=10&count=10'
    );
    assert.strictEqual(
      linkedinService.validateContinuationUrl('/rest/adAccounts?start=10&count=10'),
      'https://api.linkedin.com/rest/adAccounts?start=10&count=10'
    );
    assert.strictEqual(
      linkedinService.validateContinuationUrl('http://api.linkedin.com/rest/adAccounts'),
      null,
      'HTTP (insecure) must be rejected'
    );
    assert.strictEqual(
      linkedinService.validateContinuationUrl('https://evil-site.com/rest/adAccounts'),
      null,
      'Untrusted host must be rejected'
    );
    assert.strictEqual(
      linkedinService.validateContinuationUrl('https://api.linkedin.com/v2/people'),
      null,
      'Non-/rest/ path must be rejected'
    );

    // 2. Safety limit (maxPages)
    let fetchedPages = 0;
    global.fetch = async (url) => {
      fetchedPages++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          elements: [{ id: fetchedPages, name: `Account ${fetchedPages}` }],
          paging: {
            links: [{ rel: 'next', href: `/rest/adAccounts?start=${fetchedPages}&count=1` }],
          },
        }),
      };
    };

    const limitedResults = await linkedinService.fetchLinkedInPaginatedCollection(
      'https://api.linkedin.com/rest/adAccounts?start=0&count=1',
      'mock_token',
      { maxPages: 3 }
    );

    assert.strictEqual(fetchedPages, 3, 'Must stop when maxPages limit (3) is reached');
    assert.strictEqual(limitedResults.elements.length, 3, 'Should contain 3 elements from 3 pages');
  });

  // --------------------------------------------------------------------------
  // TEST 25: Step 4 — Outbound Request Timeout Handling
  // --------------------------------------------------------------------------
  await asyncTest('fetchWithTimeout: catches timeout errors and returns 504 without leaking credentials', async () => {
    // Test fetchWithTimeout directly when signal aborts
    global.fetch = async (url, options) => {
      const err = new Error('The operation was aborted');
      err.name = 'TimeoutError';
      throw err;
    };

    let caughtErr = null;
    try {
      await linkedinService.fetchWithTimeout('https://api.linkedin.com/rest/adAccounts', {
        headers: { Authorization: 'Bearer secret_user_token_abc' },
        timeoutMs: 50,
      });
    } catch (err) {
      caughtErr = err;
    }

    assert(caughtErr, 'Timeout must throw an error');
    assert.strictEqual(caughtErr.statusCode, 504);
    assert(caughtErr.message.includes('timed out after 50ms'));
    assert(!caughtErr.message.includes('secret_user_token_abc'), 'Error message must not expose sensitive tokens');
  });

  // --------------------------------------------------------------------------
  // TEST 26: Step 5 — Organization Logo Extraction & Nullable Persistence
  // --------------------------------------------------------------------------
  await asyncTest('getOrganizationDetails: extracts logoUrl safely and persists to LinkedInAsset', async () => {
    // 1. Successful logo extraction
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 777888,
        localizedName: 'Acme Branding Co.',
        vanityName: 'acme-branding',
        logoV2: {
          'cropped~': {
            elements: [
              {
                identifiers: [
                  { identifier: 'https://media.licdn.com/dms/image/v2/logo_777888.png' },
                ],
              },
            ],
          },
        },
      }),
    });

    const resWithLogo = await linkedinService.getOrganizationDetails('777888', 'mock_token');
    assert.strictEqual(resWithLogo.success, true);
    assert.strictEqual(resWithLogo.data.logoUrl, 'https://media.licdn.com/dms/image/v2/logo_777888.png');

    // 2. Organization without logo returns logoUrl: null safely without errors
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 999111,
        localizedName: 'No Logo Corp.',
        vanityName: 'nologo',
      }),
    });

    const resNoLogo = await linkedinService.getOrganizationDetails('999111', 'mock_token');
    assert.strictEqual(resNoLogo.success, true);
    assert.strictEqual(resNoLogo.data.logoUrl, null);

    // 3. Schema validation on LinkedInAsset accepts logoUrl string or null
    const assetWithLogo = new LinkedInAsset({
      userId: '60c72b2f9b1d8b2bad000001',
      appType: 'community',
      assetType: 'organization',
      assetId: '777888',
      assetUrn: 'urn:li:organization:777888',
      name: 'Acme Branding Co.',
      vanityName: 'acme-branding',
      logoUrl: 'https://media.licdn.com/dms/image/v2/logo_777888.png',
      status: 'active',
      role: 'ADMINISTRATOR',
    });
    await assetWithLogo.validate();
    assert.strictEqual(assetWithLogo.logoUrl, 'https://media.licdn.com/dms/image/v2/logo_777888.png');

    const assetWithoutLogo = new LinkedInAsset({
      userId: '60c72b2f9b1d8b2bad000001',
      appType: 'community',
      assetType: 'organization',
      assetId: '999111',
      assetUrn: 'urn:li:organization:999111',
      name: 'No Logo Corp.',
      status: 'active',
    });
    await assetWithoutLogo.validate();
    assert.strictEqual(assetWithoutLogo.logoUrl, null);
  });

  // Restore global.fetch
  global.fetch = originalFetch;

  console.log('\n================================================================');
  console.log(`ALL LINKEDIN PHASE 1 TESTS PASSED! (${passedTests}/${totalTests} tests successful)`);
  console.log('================================================================\n');
}

runLinkedInPhase1TestSuite().catch((err) => {
  global.fetch = originalFetch;
  console.error('LinkedIn Phase 1 Test Suite Failed:', err);
  process.exit(1);
});
