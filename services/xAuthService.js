// Reason: Encapsulates X (Twitter) OAuth 2.0 PKCE flow, token exchange, token refresh, and revocation.
// How: Implements standard RFC 7636 PKCE (S256), constructs official authorization URLs with minimum read-only scopes,
// exchanges authorization codes for access and refresh tokens, and manages token lifecycle without leaking secrets.

const crypto = require('crypto');

const X_OAUTH2_AUTH_URL = 'https://x.com/i/oauth2/authorize';
const X_OAUTH2_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const X_OAUTH2_REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';

// Standard minimum read-only scopes for own-account analytics
const DEFAULT_SCOPES = ['tweet.read', 'users.read', 'offline.access'];

/**
 * Generates cryptographically secure 43-128 character URL-safe PKCE code verifier
 */
const generateCodeVerifier = () => {
  return crypto.randomBytes(32).toString('base64url');
};

/**
 * Calculates SHA-256 Base64URL code challenge for PKCE
 */
const generateCodeChallenge = (verifier) => {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
};

/**
 * Builds standard X OAuth 2.0 PKCE authorization URL
 */
const getAuthorizationUrl = (state, codeChallenge, redirectUri = null) => {
  const clientId = process.env.X_CLIENT_ID;
  const targetRedirectUri = redirectUri || process.env.X_REDIRECT_URI;

  if (!clientId || !targetRedirectUri) {
    throw new Error('X OAuth environment variables are incomplete (X_CLIENT_ID and X_REDIRECT_URI are required)');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: targetRedirectUri,
    scope: DEFAULT_SCOPES.join(' '),
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
  });

  return `${X_OAUTH2_AUTH_URL}?${params.toString()}`;
};

/**
 * Exchanges authorization code and PKCE code_verifier for access & refresh tokens
 */
const exchangeCodeForToken = async (codeOrOptions, maybeCodeVerifier = null, maybeRedirectUri = null) => {
  let code = codeOrOptions;
  let codeVerifier = maybeCodeVerifier;
  let redirectUri = maybeRedirectUri;

  if (codeOrOptions && typeof codeOrOptions === 'object') {
    code = codeOrOptions.code;
    codeVerifier = codeOrOptions.codeVerifier;
    redirectUri = codeOrOptions.redirectUri;
  }

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const targetRedirectUri = redirectUri || process.env.X_REDIRECT_URI;

  if (!clientId || !targetRedirectUri) {
    throw new Error('X OAuth environment variables are incomplete (X_CLIENT_ID and X_REDIRECT_URI are required)');
  }

  const bodyParams = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: targetRedirectUri,
    code_verifier: codeVerifier,
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // If clientSecret is provided (confidential client), send Basic Authorization header
  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await fetch(X_OAUTH2_TOKEN_URL, {
    method: 'POST',
    headers,
    body: bodyParams.toString(),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error_description || data.error || 'Failed to exchange authorization code for X tokens';
    const err = new Error(`X OAuth token exchange failed: ${errorMsg}`);
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 400;
    err.xError = data;
    throw err;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in, // seconds (typically 7200 = 2 hours)
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    tokenType: data.token_type,
    scope: data.scope,
  };
};

/**
 * Refreshes an expired access token using the OAuth 2.0 refresh token
 */
const refreshAccessToken = async (refreshToken) => {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId) {
    throw new Error('X_CLIENT_ID environment variable is missing');
  }

  if (!refreshToken) {
    throw new Error('Refresh token is required to refresh X access token');
  }

  const bodyParams = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await fetch(X_OAUTH2_TOKEN_URL, {
    method: 'POST',
    headers,
    body: bodyParams.toString(),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error_description || data.error || 'Failed to refresh X access token';
    const err = new Error(`X token refresh failed: ${errorMsg}`);
    err.statusCode = response.status === 400 || response.status === 401 ? 401 : response.status;
    err.xError = data;
    throw err;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // X may rotate refresh token
    expiresIn: data.expires_in,
    tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    tokenType: data.token_type,
    scope: data.scope,
  };
};

/**
 * Revokes an access or refresh token upon disconnection
 */
const revokeToken = async (token, tokenTypeHint = 'access_token') => {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId || !token) {
    return false;
  }

  const bodyParams = new URLSearchParams({
    token,
    token_type_hint: tokenTypeHint,
    client_id: clientId,
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  try {
    const response = await fetch(X_OAUTH2_REVOKE_URL, {
      method: 'POST',
      headers,
      body: bodyParams.toString(),
    });
    return response.ok;
  } catch (err) {
    // Revocation failure should not throw; connection will be marked disconnected in DB regardless
    return false;
  }
};

/**
 * Ensures an active, non-expired access token is available, automatically refreshing if needed
 */
const getValidAccessToken = async (integration) => {
  if (!integration) {
    throw new Error('Integration document is required to get valid access token');
  }

  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minute buffer

  const expiresTime = integration.tokenExpiresAt ? new Date(integration.tokenExpiresAt).getTime() : 0;
  const isStillValid = integration.accessToken && (expiresTime - now > bufferMs);

  if (isStillValid) {
    return integration.accessToken;
  }

  // Token is expired or expiring soon; refresh using refreshToken
  if (integration.refreshToken) {
    const refreshed = await refreshAccessToken(integration.refreshToken);
    integration.accessToken = refreshed.accessToken;
    if (refreshed.refreshToken) {
      integration.refreshToken = refreshed.refreshToken;
    }
    integration.tokenExpiresAt = refreshed.tokenExpiresAt;
    if (typeof integration.save === 'function') {
      await integration.save();
    }
    return integration.accessToken;
  }

  if (integration.accessToken) {
    // If no refreshToken was issued, return current accessToken as best effort
    return integration.accessToken;
  }

  const err = new Error('X account credentials have expired and cannot be refreshed. Please reconnect your account.');
  err.statusCode = 401;
  throw err;
};

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  getAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
  getValidAccessToken,
  DEFAULT_SCOPES,
};
