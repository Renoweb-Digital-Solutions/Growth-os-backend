/**
 * Reason: Core LinkedIn integration service encapsulating OAuth 2.0 configuration, token management,
 * OpenID Connect member profiling, and asset discovery for the TWO separate LinkedIn apps:
 *   1. Growmentum (OpenID Connect + Advertising API - approval pending)
 *   2. Growmentum-community (Community Management API - verification pending)
 *
 * How: Provides strict isolation between apps, handles code exchange and automatic refresh,
 * securely stores tokens without exposing them to caller layers, and handles pending approval /
 * missing scope states gracefully without fabricating mock analytics.
 */

const LinkedInIntegration = require('../models/LinkedInIntegration');
const LinkedInAsset = require('../models/LinkedInAsset');

// Normalizes arbitrary app strings to strictly 'ads' or 'community'
const normalizeAppType = (rawApp) => {
  if (!rawApp) return null;
  const app = String(rawApp).toLowerCase().trim();
  if (['ads', 'growmentum', 'ad', 'advertising', 'marketing'].includes(app)) {
    return 'ads';
  }
  if (['community', 'growmentum-community', 'pages', 'org', 'organization'].includes(app)) {
    return 'community';
  }
  return null;
};

/**
 * Resolves the supported LinkedIn API version header (YYYYMM format).
 * Defaults to '202609' (the active release) to prevent sunset breakages on 202510 (sunset Oct 15, 2026).
 */
const getLinkedInApiVersion = () => {
  return process.env.LINKEDIN_API_VERSION || '202609';
};

/**
 * Returns configured request timeout in milliseconds for outbound LinkedIn network calls
 */
const getRequestTimeoutMs = () => {
  const envVal = Number(process.env.LINKEDIN_REQUEST_TIMEOUT_MS);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 10000; // 10 seconds default
};

/**
 * Wrapper around native fetch enforcing configured timeout via AbortSignal.timeout
 */
const fetchWithTimeout = async (url, options = {}, customTimeoutMs = null) => {
  const timeoutMs = options.timeoutMs || customTimeoutMs || getRequestTimeoutMs();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  const { timeoutMs: _ignored, ...fetchOptions } = options;

  const mergedSignal = fetchOptions.signal
    ? AbortSignal.any([fetchOptions.signal, timeoutSignal])
    : timeoutSignal;

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: mergedSignal,
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || (err.name === 'AbortError' && timeoutSignal.aborted)) {
      const timeoutErr = new Error(`Request to LinkedIn API timed out after ${timeoutMs}ms.`);
      timeoutErr.statusCode = 504;
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  }
};

/**
 * Resolves credentials and settings for the requested LinkedIn app
 */
const getAppConfig = (appType) => {
  const normalized = normalizeAppType(appType);
  if (!normalized) {
    const err = new Error("Invalid LinkedIn app type specified. Expected 'ads' (Growmentum) or 'community' (Growmentum-community).");
    err.statusCode = 400;
    throw err;
  }

  if (normalized === 'ads') {
    return {
      appType: 'ads',
      appName: 'Growmentum',
      description: 'OpenID Connect & Advertising API (Approval Pending)',
      clientId: process.env.LINKEDIN_ADS_CLIENT_ID || process.env.LINKEDIN_CLIENT_ID || '',
      clientSecret: process.env.LINKEDIN_ADS_CLIENT_SECRET || process.env.LINKEDIN_CLIENT_SECRET || '',
      redirectUri:
        process.env.LINKEDIN_ADS_REDIRECT_URI ||
        process.env.LINKEDIN_REDIRECT_URI ||
        'http://localhost:5000/api/linkedin/ads/callback',
      scopes: process.env.LINKEDIN_ADS_SCOPES || 'openid profile email',
      productStatus: process.env.LINKEDIN_ADS_PRODUCT_STATUS || 'pending_approval',
    };
  }

  // 'community' app
  return {
    appType: 'community',
    appName: 'Growmentum-community',
    description: 'Community Management API (Company Verification & Access Pending)',
    clientId: process.env.LINKEDIN_COMMUNITY_CLIENT_ID || '',
    clientSecret: process.env.LINKEDIN_COMMUNITY_CLIENT_SECRET || '',
    redirectUri:
      process.env.LINKEDIN_COMMUNITY_REDIRECT_URI ||
      'http://localhost:5000/api/linkedin/community/callback',
    scopes:
      process.env.LINKEDIN_COMMUNITY_SCOPES ||
      'openid profile email r_organization_social r_organization_admin',
    productStatus: process.env.LINKEDIN_COMMUNITY_PRODUCT_STATUS || 'pending_approval',
  };
};

/**
 * Resolves and strictly validates the redirect URI against an approved server-side allowlist.
 * If requestedUri is omitted, defaults to config.redirectUri.
 * If requestedUri is provided, rejects any URI not explicitly listed in the allowlist.
 */
const resolveApprovedRedirectUri = (appType, requestedUri = null) => {
  const config = getAppConfig(appType);
  if (!requestedUri) {
    return config.redirectUri;
  }

  const allowedSet = new Set();
  if (config.redirectUri) {
    allowedSet.add(config.redirectUri.trim());
  }

  const globalAllowed = process.env.LINKEDIN_ALLOWED_REDIRECT_URIS;
  if (globalAllowed) {
    globalAllowed
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
      .forEach((u) => allowedSet.add(u));
  }

  const appKey = `LINKEDIN_${config.appType.toUpperCase()}_ALLOWED_REDIRECT_URIS`;
  const appAllowed = process.env[appKey];
  if (appAllowed) {
    appAllowed
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
      .forEach((u) => allowedSet.add(u));
  }

  const candidate = String(requestedUri).trim();
  if (!allowedSet.has(candidate)) {
    const err = new Error(
      `Redirect URI '${candidate}' is not in the approved allowlist for LinkedIn ${config.appName}.`
    );
    err.statusCode = 400;
    throw err;
  }

  return candidate;
};

/**
 * Validates that mandatory credentials exist in environment for an app
 */
const assertAppConfigured = (appType) => {
  const config = getAppConfig(appType);
  if (!config.clientId || !config.clientSecret) {
    const err = new Error(
      `LinkedIn environment variables for app '${config.appName}' (${config.appType}) are incomplete. Please set LINKEDIN_${config.appType.toUpperCase()}_CLIENT_ID and LINKEDIN_${config.appType.toUpperCase()}_CLIENT_SECRET in .env.`
    );
    err.statusCode = 500;
    throw err;
  }
  return config;
};

/**
 * Returns safe public configuration metadata without leaking secrets
 */
const getSafeAppInfo = (appType) => {
  const config = getAppConfig(appType);
  return {
    appType: config.appType,
    appName: config.appName,
    description: config.description,
    configured: Boolean(config.clientId && config.clientSecret),
    clientId: config.clientId ? `${config.clientId.substring(0, 4)}...` : null,
    redirectUri: config.redirectUri,
    configuredScopes: config.scopes.split(/\s+/).filter(Boolean),
    productStatus: config.productStatus,
  };
};

/**
 * Constructs the LinkedIn OAuth 2.0 authorization URL
 */
const buildAuthorizationUrl = (appType, state, customRedirectUri = null) => {
  const config = assertAppConfigured(appType);
  const redirectUri = customRedirectUri || config.redirectUri;

  const authBase = 'https://www.linkedin.com/oauth/v2/authorization';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    state: state,
    scope: config.scopes,
  });

  return `${authBase}?${params.toString()}`;
};

/**
 * Exchanges authorization code for access and refresh tokens
 */
const exchangeCodeForToken = async (appType, code, redirectUri = null) => {
  const config = assertAppConfigured(appType);
  const finalRedirectUri = redirectUri || config.redirectUri;

  const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
  const bodyParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: finalRedirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  let response;
  try {
    response = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });
  } catch (networkErr) {
    if (networkErr.isTimeout) {
      const err = new Error(`Request to LinkedIn OAuth service timed out`);
      err.statusCode = 504;
      err.isTimeout = true;
      throw err;
    }
    const err = new Error(`Failed to contact LinkedIn OAuth service: ${networkErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const errorMsg = data.error_description || data.error || 'LinkedIn authorization code exchange failed';
    const err = new Error(errorMsg);
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 400;
    err.linkedinError = data;
    throw err;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in || 5184000, // default ~60 days
    refreshTokenExpiresIn: data.refresh_token_expires_in || null,
    scope: data.scope || null,
  };
};

/**
 * Refreshes an expired LinkedIn access token using stored refresh token
 */
const refreshAccessToken = async (appType, refreshToken) => {
  const config = assertAppConfigured(appType);

  const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
  const bodyParams = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  let response;
  try {
    response = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });
  } catch (networkErr) {
    if (networkErr.isTimeout) {
      const err = new Error(`Request to LinkedIn token refresh service timed out`);
      err.statusCode = 504;
      err.isTimeout = true;
      throw err;
    }
    const err = new Error(`Failed to contact LinkedIn token refresh service: ${networkErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const errorMsg = data.error_description || data.error || 'Failed to refresh LinkedIn access token';
    const err = new Error(errorMsg);
    err.statusCode = 401;
    err.linkedinError = data;
    throw err;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in || 5184000,
    refreshTokenExpiresIn: data.refresh_token_expires_in || null,
  };
};

/**
 * Fetches member identity from LinkedIn OpenID Connect /userinfo endpoint
 */
const getLinkedInUserProfile = async (accessToken) => {
  const userinfoUrl = 'https://api.linkedin.com/v2/userinfo';

  let response;
  try {
    response = await fetchWithTimeout(userinfoUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
  } catch (networkErr) {
    if (networkErr.isTimeout) {
      const err = new Error(`Request to LinkedIn OpenID UserInfo service timed out`);
      err.statusCode = 504;
      err.isTimeout = true;
      throw err;
    }
    const err = new Error(`Failed to contact LinkedIn OpenID UserInfo service: ${networkErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const errorMsg = data.message || data.error_description || data.error || 'Failed to retrieve LinkedIn user profile';
    const err = new Error(errorMsg);
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 400;
    err.linkedinError = data;
    throw err;
  }

  return {
    linkedinMemberId: data.sub || data.id,
    name: data.name || `${data.given_name || ''} ${data.family_name || ''}`.trim() || 'LinkedIn Member',
    email: data.email || null,
    picture: data.picture || null,
  };
};

/**
 * Fetches organization profile details from LinkedIn /rest/organizations/{id}
 * Populates real localized name, vanity name, and logo without fabricating details.
 */
const getOrganizationDetails = async (organizationId, accessToken) => {
  const apiVersion = getLinkedInApiVersion();
  const url = `https://api.linkedin.com/rest/organizations/${encodeURIComponent(organizationId)}`;

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        Accept: 'application/json',
      },
    });
  } catch (networkErr) {
    return {
      success: false,
      status: networkErr.isTimeout ? 504 : 502,
      error: networkErr.message,
    };
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    return {
      success: false,
      status: response.status,
      error: errData.message || 'Lookup failed',
    };
  }

  const data = await response.json().catch(() => ({}));

  const extractLogoUrl = (d) => {
    if (!d) return null;
    if (typeof d.logoUrl === 'string' && d.logoUrl.startsWith('http')) return d.logoUrl;
    if (typeof d.logo === 'string' && d.logo.startsWith('http')) return d.logo;
    if (typeof d.logoV2 === 'string' && d.logoV2.startsWith('http')) return d.logoV2;

    // LinkedIn logoV2 decoration pattern: logoV2['cropped~'].elements[0].identifiers[0].identifier
    if (d.logoV2 && typeof d.logoV2 === 'object') {
      const cropped = d.logoV2['cropped~'] || d.logoV2.cropped;
      if (cropped && Array.isArray(cropped.elements) && cropped.elements[0]?.identifiers?.[0]?.identifier) {
        const idUri = cropped.elements[0].identifiers[0].identifier;
        if (typeof idUri === 'string' && idUri.startsWith('http')) return idUri;
      }
      const original = d.logoV2['original~'] || d.logoV2.original;
      if (original && Array.isArray(original.elements) && original.elements[0]?.identifiers?.[0]?.identifier) {
        const idUri = original.elements[0].identifiers[0].identifier;
        if (typeof idUri === 'string' && idUri.startsWith('http')) return idUri;
      }
    }
    return null;
  };

  return {
    success: true,
    data: {
      id: String(data.id || organizationId),
      localizedName: data.localizedName || data.name || null,
      vanityName: data.vanityName || null,
      logoUrl: extractLogoUrl(data),
      logo: data.logoV2 || null,
    },
  };
};

/**
 * Retrieves valid accessToken for a user and app, refreshing automatically if necessary
 */
const getValidAccessToken = async (userId, appType) => {
  const normalized = normalizeAppType(appType);
  const integration = await LinkedInIntegration.findOne({ userId, appType: normalized });

  if (!integration || integration.status !== 'connected' || !integration.accessToken) {
    const err = new Error(`LinkedIn '${normalized}' account is not connected or authorization was revoked.`);
    err.statusCode = 401;
    throw err;
  }

  const BUFFER_MS = 2 * 60 * 1000; // 2 minutes
  const isExpired =
    integration.tokenExpiresAt &&
    new Date().getTime() + BUFFER_MS > new Date(integration.tokenExpiresAt).getTime();

  if (!isExpired) {
    return integration.accessToken;
  }

  // Attempt refresh if refresh_token exists
  if (!integration.refreshToken) {
    integration.status = 'expired';
    integration.accessToken = null;
    await integration.save();

    const err = new Error(
      `LinkedIn '${normalized}' access token has expired and no refresh token is available. Please reconnect your account.`
    );
    err.statusCode = 401;
    throw err;
  }

  try {
    const refreshed = await refreshAccessToken(normalized, integration.refreshToken);

    integration.accessToken = refreshed.accessToken;
    integration.tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
    if (refreshed.refreshToken) {
      integration.refreshToken = refreshed.refreshToken;
    }
    if (refreshed.refreshTokenExpiresIn) {
      integration.refreshTokenExpiresAt = new Date(Date.now() + refreshed.refreshTokenExpiresIn * 1000);
    }
    integration.status = 'connected';
    await integration.save();

    return integration.accessToken;
  } catch (refreshErr) {
    integration.status = 'expired';
    integration.accessToken = null;
    await integration.save();

    const err = new Error(`LinkedIn '${normalized}' token refresh failed. Please reconnect your account.`);
    err.statusCode = 401;
    err.cause = refreshErr;
    throw err;
  }
};

/**
 * Validates that pagination continuation URLs only target trusted HTTPS api.linkedin.com endpoints
 */
const validateContinuationUrl = (rawHref) => {
  if (!rawHref || typeof rawHref !== 'string') return null;
  try {
    const resolved = new URL(rawHref, 'https://api.linkedin.com');
    if (resolved.protocol !== 'https:') {
      console.warn(`[LinkedIn Pagination] Continuation URL rejected: non-https protocol (${resolved.protocol})`);
      return null;
    }
    if (resolved.hostname !== 'api.linkedin.com') {
      console.warn(`[LinkedIn Pagination] Continuation URL rejected: untrusted host (${resolved.hostname})`);
      return null;
    }
    if (!resolved.pathname.startsWith('/rest/')) {
      console.warn(`[LinkedIn Pagination] Continuation URL rejected: non-REST path (${resolved.pathname})`);
      return null;
    }
    return resolved.toString();
  } catch (err) {
    console.warn(`[LinkedIn Pagination] Continuation URL rejected: malformed URL (${err.message})`);
    return null;
  }
};

/**
 * Fetches all accessible pages of a LinkedIn REST collection, adhering to documented contracts
 * and safety limits. Validates continuation URLs and prevents pagination loops.
 */
const fetchLinkedInPaginatedCollection = async (initialUrl, accessToken, options = {}) => {
  const maxPages = Number(options.maxPages) || Number(process.env.LINKEDIN_MAX_PAGINATION_PAGES) || 10;
  const pageSize = Number(options.pageSize) || 100;

  const initialObj = new URL(initialUrl, 'https://api.linkedin.com');
  if (!initialObj.searchParams.has('count')) {
    initialObj.searchParams.set('count', String(pageSize));
  }
  if (!initialObj.searchParams.has('start')) {
    initialObj.searchParams.set('start', '0');
  }

  let nextUrl = initialObj.toString();
  const allElements = [];
  const seenUrls = new Set();
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    if (seenUrls.has(nextUrl)) {
      console.warn(`[LinkedIn Pagination] Detected loop on URL: ${nextUrl}`);
      break;
    }
    seenUrls.add(nextUrl);
    pageCount++;

    let response;
    try {
      response = await fetchWithTimeout(nextUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': getLinkedInApiVersion(),
          'X-Restli-Protocol-Version': '2.0.0',
          Accept: 'application/json',
        },
      });
    } catch (networkErr) {
      if (pageCount === 1) {
        throw networkErr;
      }
      console.warn(`[LinkedIn Pagination] Page ${pageCount} failed: ${networkErr.message}. Halting further pages.`);
      break;
    }

    if (!response.ok) {
      if (pageCount === 1) {
        const errData = await response.json().catch(() => ({}));
        return {
          ok: false,
          status: response.status,
          error: errData.message || `LinkedIn API returned HTTP ${response.status}`,
          elements: [],
          pagesFetched: pageCount,
        };
      }
      console.warn(`[LinkedIn Pagination] Page ${pageCount} returned HTTP ${response.status}. Halting further pages.`);
      break;
    }

    const data = await response.json().catch(() => ({}));
    const elements = Array.isArray(data.elements) ? data.elements : [];
    allElements.push(...elements);

    let nextContinuation = null;
    if (data.paging && Array.isArray(data.paging.links)) {
      const nextLinkObj = data.paging.links.find((l) => l.rel === 'next' && l.href);
      if (nextLinkObj) {
        nextContinuation = validateContinuationUrl(nextLinkObj.href);
      }
      // When paging.links is present, having no 'next' link means we reached the final page.
    } else if (data.paging) {
      const currentStart = Number(data.paging.start ?? 0);
      const currentCount = Number(data.paging.count ?? elements.length);
      const total = typeof data.paging.total === 'number' ? data.paging.total : null;
      const nextStart = currentStart + elements.length;

      if (elements.length > 0 && total !== null && nextStart < total && elements.length >= currentCount) {
        const parsed = new URL(nextUrl);
        parsed.searchParams.set('start', String(nextStart));
        parsed.searchParams.set('count', String(currentCount || pageSize));
        nextContinuation = validateContinuationUrl(parsed.toString());
      }
    }

    nextUrl = nextContinuation;
  }

  return {
    ok: true,
    status: 200,
    elements: allElements,
    pagesFetched: pageCount,
  };
};

/**
 * Discovers and synchronizes authorized assets (Ad Accounts or Organizations) for the user.
 * Explicitly respects approval boundaries and does NOT fabricate analytics data.
 */
const discoverAssets = async (userId, appType) => {
  const normalized = normalizeAppType(appType);
  const config = getAppConfig(normalized);
  const integration = await LinkedInIntegration.findOne({ userId, appType: normalized });

  if (!integration || integration.status !== 'connected') {
    const err = new Error(`LinkedIn '${config.appName}' is not connected.`);
    err.statusCode = 401;
    throw err;
  }

  // Check existing selected asset for the user
  const selectedAsset = await LinkedInAsset.findOne({
    userId,
    appType: normalized,
    isSelected: true,
    isActive: true,
  });

  const grantedScopes = integration.grantedScopes || [];

  // =========================================================================
  // APP 1: GROWMENTUM (ADS APP)
  // =========================================================================
  if (normalized === 'ads') {
    const hasAdsScope = grantedScopes.includes('r_ads') || grantedScopes.includes('r_ads_reporting');

    // If Advertising API approval or scopes are pending, return honest capability response
    if (!hasAdsScope || config.productStatus === 'pending_approval' || integration.approvalStatus === 'pending_approval') {
      const existingAssets = await LinkedInAsset.find({ userId, appType: normalized, isActive: true });

      return {
        appType: 'ads',
        appName: 'Growmentum',
        apiAccessAvailable: false,
        approvalStatus: 'pending_approval',
        message:
          'LinkedIn Advertising API access is subject to approval. Once approved by LinkedIn and authorized with the r_ads scope, ad accounts will appear here.',
        requiredScopes: ['r_ads', 'r_ads_reporting'],
        grantedScopes,
        assets: existingAssets,
        selectedAsset: selectedAsset || null,
        count: existingAssets.length,
      };
    }

    // If scopes are granted, attempt live discovery
    try {
      const accessToken = await getValidAccessToken(userId, 'ads');
      const adAccountsUrl = 'https://api.linkedin.com/rest/adAccounts?q=search';

      const pageResult = await fetchLinkedInPaginatedCollection(adAccountsUrl, accessToken);

      if (!pageResult.ok) {
        return {
          appType: 'ads',
          appName: 'Growmentum',
          apiAccessAvailable: false,
          approvalStatus: 'pending_approval',
          message:
            pageResult.error ||
            'LinkedIn Advertising API returned pending product permission. Ad accounts will become accessible once LinkedIn approves the application.',
          requiredScopes: ['r_ads', 'r_ads_reporting'],
          grantedScopes,
          assets: [],
          selectedAsset: null,
          count: 0,
        };
      }

      const elements = pageResult.elements;
      const discoveredAssets = [];
      const seenAssetIds = new Set();

      for (const item of elements) {
        const assetId = String(item.id);
        if (seenAssetIds.has(assetId)) continue;
        seenAssetIds.add(assetId);

        const assetUrn = item.urn || `urn:li:sponsoredAccount:${assetId}`;
        const name = item.name || `Ad Account ${assetId}`;
        const currency = item.currency || null;
        const status = item.status || 'ACTIVE';

        const record = await LinkedInAsset.findOneAndUpdate(
          { userId, appType: 'ads', assetId },
          {
            assetUrn,
            assetType: 'ad_account',
            name,
            currency,
            status,
            isActive: true,
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        discoveredAssets.push(record);
      }

      // If no asset is selected yet and assets exist, auto-select the first one
      let currentSelected = selectedAsset;
      if (!currentSelected && discoveredAssets.length > 0) {
        discoveredAssets[0].isSelected = true;
        await discoveredAssets[0].save();
        currentSelected = discoveredAssets[0];

        integration.selectedAssetId = discoveredAssets[0].assetId;
        await integration.save();
      }

      return {
        appType: 'ads',
        appName: 'Growmentum',
        apiAccessAvailable: true,
        approvalStatus: 'approved',
        message: 'Successfully discovered LinkedIn Ad Accounts.',
        requiredScopes: ['r_ads', 'r_ads_reporting'],
        grantedScopes,
        assets: discoveredAssets,
        selectedAsset: currentSelected || null,
        count: discoveredAssets.length,
      };
    } catch (apiErr) {
      return {
        appType: 'ads',
        appName: 'Growmentum',
        apiAccessAvailable: false,
        approvalStatus: 'pending_approval',
        message: `Advertising API check: ${apiErr.message}`,
        requiredScopes: ['r_ads', 'r_ads_reporting'],
        grantedScopes,
        assets: [],
        selectedAsset: null,
        count: 0,
      };
    }
  }

  // =========================================================================
  // APP 2: GROWMENTUM-COMMUNITY (COMMUNITY MANAGEMENT APP)
  // =========================================================================
  const hasCommunityScope =
    grantedScopes.includes('r_organization_social') || grantedScopes.includes('r_organization_admin');

  if (!hasCommunityScope || config.productStatus === 'pending_approval' || integration.approvalStatus === 'pending_approval') {
    const existingAssets = await LinkedInAsset.find({ userId, appType: normalized, isActive: true });

    return {
      appType: 'community',
      appName: 'Growmentum-community',
      apiAccessAvailable: false,
      approvalStatus: 'pending_approval',
      message:
        'LinkedIn Community Management API requires company verification and product approval. Once granted by LinkedIn, company pages will appear here.',
      requiredScopes: ['openid', 'profile', 'email', 'r_organization_social', 'r_organization_admin'],
      grantedScopes,
      assets: existingAssets,
      selectedAsset: selectedAsset || null,
      count: existingAssets.length,
    };
  }

  try {
    const accessToken = await getValidAccessToken(userId, 'community');
    const orgAclsUrl = 'https://api.linkedin.com/rest/organizationalEntityAcls?q=roleAssignee';

    const pageResult = await fetchLinkedInPaginatedCollection(orgAclsUrl, accessToken);

    if (!pageResult.ok) {
      return {
        appType: 'community',
        appName: 'Growmentum-community',
        apiAccessAvailable: false,
        approvalStatus: 'pending_approval',
        message:
          pageResult.error ||
          'LinkedIn Community Management API returned pending organization verification. Company pages will become accessible once LinkedIn approves the application.',
        requiredScopes: ['r_organization_social', 'r_organization_admin'],
        grantedScopes,
        assets: [],
        selectedAsset: null,
        count: 0,
      };
    }

    const elements = pageResult.elements;

    // Filter strictly for approved, active organization ACL relationships
    const approvedElements = elements.filter(
      (item) =>
        item.state === 'APPROVED' &&
        typeof item.organizationalTarget === 'string' &&
        item.organizationalTarget.startsWith('urn:li:organization:')
    );

    const discoveredAssets = [];
    const seenAssetIds = new Set();

    for (const item of approvedElements) {
      const orgUrn = item.organizationalTarget;
      const assetId = orgUrn.split(':').pop();
      if (seenAssetIds.has(assetId)) continue;
      seenAssetIds.add(assetId);

      const role = item.role || null;
      const status = item.state || 'APPROVED';

      // Enrich organization with real display name & vanity name via /rest/organizations/{id}
      let name = `Organization ${assetId}`;
      let vanityName = null;
      let logoUrl = null;

      const detailsRes = await getOrganizationDetails(assetId, accessToken);
      if (detailsRes.success && detailsRes.data) {
        if (detailsRes.data.localizedName) {
          name = detailsRes.data.localizedName;
        }
        vanityName = detailsRes.data.vanityName;
        logoUrl = detailsRes.data.logoUrl || null;
      }

      const record = await LinkedInAsset.findOneAndUpdate(
        { userId, appType: 'community', assetId },
        {
          assetUrn: orgUrn,
          assetType: 'organization',
          name,
          vanityName,
          logoUrl,
          role,
          status,
          isActive: true,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      discoveredAssets.push(record);
    }

    let currentSelected = selectedAsset;
    if (!currentSelected && discoveredAssets.length > 0) {
      discoveredAssets[0].isSelected = true;
      await discoveredAssets[0].save();
      currentSelected = discoveredAssets[0];

      integration.selectedAssetId = discoveredAssets[0].assetId;
      await integration.save();
    }

    return {
      appType: 'community',
      appName: 'Growmentum-community',
      apiAccessAvailable: true,
      approvalStatus: 'approved',
      message: 'Successfully discovered LinkedIn Organization Pages.',
      requiredScopes: ['r_organization_social', 'r_organization_admin'],
      grantedScopes,
      assets: discoveredAssets,
      selectedAsset: currentSelected || null,
      count: discoveredAssets.length,
    };
  } catch (apiErr) {
    return {
      appType: 'community',
      appName: 'Growmentum-community',
      apiAccessAvailable: false,
      approvalStatus: 'pending_approval',
      message: `Community Management API check: ${apiErr.message}`,
      requiredScopes: ['r_organization_social', 'r_organization_admin'],
      grantedScopes,
      assets: [],
      selectedAsset: null,
      count: 0,
    };
  }
};

/**
 * Sets the active selected asset for an authenticated user and app
 */
const setSelectedAsset = async (userId, appType, assetId) => {
  const normalized = normalizeAppType(appType);
  if (!assetId) {
    const err = new Error('Asset ID is required to select an asset.');
    err.statusCode = 400;
    throw err;
  }

  // Ensure asset exists and belongs to the user and app
  const targetAsset = await LinkedInAsset.findOne({
    userId,
    appType: normalized,
    assetId: String(assetId),
    isActive: true,
  });

  if (!targetAsset) {
    const err = new Error(
      `LinkedIn asset with ID '${assetId}' was not found for this user under the '${normalized}' integration.`
    );
    err.statusCode = 404;
    throw err;
  }

  // Atomic unselect of previously selected assets for this user and app
  await LinkedInAsset.updateMany({ userId, appType: normalized }, { isSelected: false });

  // Select target asset
  targetAsset.isSelected = true;
  await targetAsset.save();

  // Update integration document reference
  await LinkedInIntegration.findOneAndUpdate(
    { userId, appType: normalized },
    { selectedAssetId: targetAsset.assetId }
  );

  return targetAsset;
};

/**
 * Gets currently selected asset for an authenticated user and app
 */
const getSelectedAsset = async (userId, appType) => {
  const normalized = normalizeAppType(appType);
  return LinkedInAsset.findOne({
    userId,
    appType: normalized,
    isSelected: true,
    isActive: true,
  });
};

module.exports = {
  normalizeAppType,
  getLinkedInApiVersion,
  getRequestTimeoutMs,
  fetchWithTimeout,
  resolveApprovedRedirectUri,
  validateContinuationUrl,
  fetchLinkedInPaginatedCollection,
  getAppConfig,
  assertAppConfigured,
  getSafeAppInfo,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getLinkedInUserProfile,
  getOrganizationDetails,
  getValidAccessToken,
  discoverAssets,
  setSelectedAsset,
  getSelectedAsset,
};
