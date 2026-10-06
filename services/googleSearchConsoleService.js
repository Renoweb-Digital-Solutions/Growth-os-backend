/**
 * Reason: Low-level Google Search Console service layer encapsulating Google OAuth 2.0 and Search Console API requests.
 * How: Provides helper methods for OAuth authorization URL generation, code-to-token exchange, token refresh,
 * user identity retrieval, site/property discovery, Search Analytics queries, and normalized error response handling.
 */

const GoogleIntegration = require('../models/GoogleIntegration');

/**
 * Validates existence of mandatory Google OAuth environment variables
 */
const checkGoogleEnvConfig = () => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    throw new Error('Google OAuth environment variables are incomplete (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required)');
  }
};

/**
 * Builds Google OAuth 2.0 Authorization URL requesting Search Console read-only access
 */
const getAuthorizationUrl = (state) => {
  checkGoogleEnvConfig();

  const baseUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly openid profile email',
    access_type: 'offline', // Mandatory to obtain refresh_token
    prompt: 'consent', // Ensures refresh_token is returned on re-consent
    state: state,
  });

  return `${baseUrl}?${params.toString()}`;
};

/**
 * Exchanges authorization code for access token and refresh token
 */
const exchangeCodeForToken = async (code) => {
  checkGoogleEnvConfig();

  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const bodyParams = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    code: code,
    grant_type: 'authorization_code',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error_description || data.error || 'Google authorization code exchange failed';
    const err = new Error(errorMsg);
    err.googleError = data;
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 400;
    throw err;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    tokenType: data.token_type || 'Bearer',
    expiresIn: data.expires_in,
    scope: data.scope || null,
    idToken: data.id_token || null,
  };
};

/**
 * Refreshes an expired Google access token using the stored refresh token
 */
const refreshAccessToken = async (refreshToken) => {
  checkGoogleEnvConfig();

  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const bodyParams = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error_description || data.error || 'Failed to refresh Google access token';
    const err = new Error(errorMsg);
    err.googleError = data;
    err.statusCode = 401;
    throw err;
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token || null, // Google may optional re-issue a new refresh token
  };
};

/**
 * Fetches authenticated Google user profile (/userinfo) to extract stable subject ID
 */
const getGoogleUserProfile = async (accessToken) => {
  const url = 'https://www.googleapis.com/oauth2/v3/userinfo';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error_description || data.error?.message || 'Failed to retrieve Google user profile';
    const err = new Error(errorMsg);
    err.googleError = data;
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 400;
    throw err;
  }

  return {
    googleUserId: data.sub || data.id,
    email: data.email || null,
    name: data.name || null,
    picture: data.picture || null,
  };
};

/**
 * Retrieves a valid access token for the authenticated user, refreshing automatically if expired
 */
const getValidAccessToken = async (userId) => {
  const integration = await GoogleIntegration.findOne({ userId });

  if (!integration || integration.status !== 'connected') {
    const err = new Error('Google Search Console account is not connected');
    err.statusCode = 401;
    throw err;
  }

  const BUFFER_MS = 2 * 60 * 1000; // 2-minute buffer before actual expiration
  const isExpired = integration.tokenExpiresAt && (new Date().getTime() + BUFFER_MS > new Date(integration.tokenExpiresAt).getTime());

  if (!isExpired && integration.accessToken) {
    return integration.accessToken;
  }

  // Token is expired or missing access_token; attempt refresh
  if (!integration.refreshToken) {
    integration.status = 'expired';
    integration.accessToken = null;
    await integration.save();

    const err = new Error('Google Search Console authorization has expired and no refresh token is available. Please reconnect your account');
    err.statusCode = 401;
    throw err;
  }

  try {
    const refreshed = await refreshAccessToken(integration.refreshToken);

    integration.accessToken = refreshed.accessToken;
    integration.tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
    if (refreshed.refreshToken) {
      integration.refreshToken = refreshed.refreshToken;
    }
    integration.status = 'connected';
    await integration.save();

    return integration.accessToken;
  } catch (refreshErr) {
    integration.status = 'expired';
    integration.accessToken = null;
    await integration.save();

    const err = new Error('Google authorization token refresh failed. Please reconnect your account');
    err.statusCode = 401;
    err.cause = refreshErr;
    throw err;
  }
};

/**
 * Base Google API request wrapper with centralized error normalization
 */
const fetchGoogleApi = async (url, accessToken, options = {}) => {
  const reqHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: reqHeaders,
    });
  } catch (networkErr) {
    const err = new Error(`Google API network error: ${networkErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const errorObj = data.error || {};
    const code = errorObj.code || response.status;
    const message = errorObj.message || 'Google API request failed';

    if (code === 401) {
      const err = new Error('Google access token is invalid or has expired');
      err.statusCode = 401;
      err.googleError = errorObj;
      throw err;
    }

    if (code === 403) {
      const err = new Error(`Google API permission error: ${message}`);
      err.statusCode = 403;
      err.googleError = errorObj;
      throw err;
    }

    if (code === 404) {
      const err = new Error(`Requested Search Console property or resource was not found: ${message}`);
      err.statusCode = 404;
      err.googleError = errorObj;
      throw err;
    }

    if (code === 429) {
      const err = new Error('Google API rate limit exceeded. Please try again shortly');
      err.statusCode = 429;
      err.googleError = errorObj;
      throw err;
    }

    const err = new Error(`Google API error (${code}): ${message}`);
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 500;
    err.googleError = errorObj;
    throw err;
  }

  return data;
};

/**
 * Lists Search Console sites/properties accessible to the connected Google account
 */
const listProperties = async (accessToken) => {
  const url = 'https://www.googleapis.com/webmasters/v3/sites';
  const data = await fetchGoogleApi(url, accessToken, { method: 'GET' });

  const rawEntries = Array.isArray(data.siteEntry) ? data.siteEntry : [];

  return rawEntries.map((entry) => {
    const siteUrl = entry.siteUrl;
    const isDomainProperty = typeof siteUrl === 'string' && siteUrl.startsWith('sc-domain:');
    
    return {
      siteUrl: siteUrl,
      permissionLevel: entry.permissionLevel || 'siteRestrictedUser',
      propertyType: isDomainProperty ? 'domain' : 'url_prefix',
      displayName: isDomainProperty ? siteUrl.replace('sc-domain:', '') : siteUrl,
    };
  });
};

/**
 * Queries Google Search Console Search Analytics API for performance data
 */
const querySearchAnalytics = async (accessToken, siteUrl, queryParams = {}) => {
  const encodedSiteUrl = encodeURIComponent(siteUrl);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`;

  const requestBody = {
    startDate: queryParams.startDate,
    endDate: queryParams.endDate,
    rowLimit: queryParams.rowLimit ? Math.min(parseInt(queryParams.rowLimit, 10), 25000) : 1000,
    startRow: queryParams.startRow ? parseInt(queryParams.startRow, 10) : 0,
  };

  if (Array.isArray(queryParams.dimensions) && queryParams.dimensions.length > 0) {
    requestBody.dimensions = queryParams.dimensions;
  }

  if (Array.isArray(queryParams.dimensionFilterGroups) && queryParams.dimensionFilterGroups.length > 0) {
    requestBody.dimensionFilterGroups = queryParams.dimensionFilterGroups;
  }

  if (queryParams.aggregationType) {
    requestBody.aggregationType = queryParams.aggregationType;
  }

  if (queryParams.dataState) {
    requestBody.dataState = queryParams.dataState;
  }

  const data = await fetchGoogleApi(url, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const rows = Array.isArray(data.rows) ? data.rows : [];

  const normalizedRows = rows.map((row) => ({
    keys: row.keys || [],
    clicks: typeof row.clicks === 'number' ? row.clicks : 0,
    impressions: typeof row.impressions === 'number' ? row.impressions : 0,
    ctr: typeof row.ctr === 'number' ? Number(row.ctr.toFixed(4)) : 0,
    position: typeof row.position === 'number' ? Number(row.position.toFixed(2)) : 0,
  }));

  return {
    rows: normalizedRows,
    responseAggregationType: data.responseAggregationType || null,
    metadata: data.metadata || null,
  };
};

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getGoogleUserProfile,
  getValidAccessToken,
  fetchGoogleApi,
  listProperties,
  querySearchAnalytics,
};
