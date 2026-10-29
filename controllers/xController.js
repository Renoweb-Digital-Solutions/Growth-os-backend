// Reason: Controller layer for X (Twitter) OAuth connection and analytics endpoints.
// How: Handles incoming HTTP requests, validates OAuth parameters, orchestrates connection lifecycle,
// calls xAnalyticsService with authenticated user context, and returns standard Growmentum response envelopes.

const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const XIntegration = require('../models/XIntegration');
const XOAuthState = require('../models/XOAuthState');
const xAuthService = require('../services/xAuthService');
const xApiService = require('../services/xApiService');
const xAnalyticsService = require('../services/xAnalyticsService');
const xRedisService = require('../services/xRedisService');

// @desc    Initiate X (Twitter) OAuth 2.0 PKCE authorization flow
// @route   GET /api/x/connect
// @access  Private (Protected by Gromentum JWT)
const connect = asyncHandler(async (req, res) => {
  if (!process.env.X_CLIENT_ID || !process.env.X_REDIRECT_URI) {
    res.status(500);
    throw new Error('X OAuth environment variables are incomplete (X_CLIENT_ID and X_REDIRECT_URI are required)');
  }

  const state = crypto.randomBytes(32).toString('hex');
  const codeVerifier = xAuthService.generateCodeVerifier();
  const codeChallenge = xAuthService.generateCodeChallenge(codeVerifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

  await XOAuthState.create({
    state,
    codeVerifier,
    userId: req.user._id,
    redirectUri: process.env.X_REDIRECT_URI,
    expiresAt,
  });

  const authUrl = xAuthService.getAuthorizationUrl(state, codeChallenge);

  if (req.query.format === 'json') {
    return res.json({ success: true, url: authUrl });
  }

  res.redirect(authUrl);
});

// @desc    Handle X OAuth 2.0 authorization callback
// @route   GET /api/x/callback
// @access  Public (X Authorization Code Redirect)
const callback = asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle user cancellation or denial
  if (error) {
    if (state) {
      await XOAuthState.findOneAndDelete({ state });
    }
    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (redirectUrl) {
      return res.redirect(`${redirectUrl}?x_status=error&error=${encodeURIComponent(error_description || error)}`);
    }
    res.status(400);
    throw new Error(`X authorization failed: ${error_description || error}`);
  }

  if (!code || !state) {
    if (state) {
      await XOAuthState.findOneAndDelete({ state });
    }
    res.status(400);
    throw new Error('Missing code or state parameter in X callback');
  }

  // Atomic single-use state consumption to prevent CSRF and replay attacks
  const stateRecord = await XOAuthState.findOneAndDelete({ state });

  if (!stateRecord) {
    res.status(400);
    throw new Error('Invalid or already consumed OAuth state token');
  }

  if (stateRecord.expiresAt < new Date()) {
    res.status(400);
    throw new Error('OAuth state token has expired. Please initiate connection again');
  }

  // Exchange authorization code & PKCE code_verifier for tokens
  const tokenData = await xAuthService.exchangeCodeForToken(code, stateRecord.codeVerifier, stateRecord.redirectUri);

  // Fetch authenticated user profile from /2/users/me
  const userProfile = await xApiService.getAuthenticatedUser(tokenData.accessToken);

  let tokenExpiresAt = null;
  if (tokenData.expiresIn) {
    tokenExpiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);
  }

  const grantedScopes = tokenData.scope ? tokenData.scope.split(' ') : xAuthService.DEFAULT_SCOPES;

  // Persist connection to MongoDB
  const integration = await XIntegration.findOneAndUpdate(
    { userId: stateRecord.userId },
    {
      xUserId: userProfile.xUserId,
      username: userProfile.username,
      name: userProfile.name,
      profileImageUrl: userProfile.profileImageUrl,
      description: userProfile.description,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      tokenExpiresAt,
      grantedScopes,
      status: 'connected',
      lastSyncedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (redirectUrl) {
    return res.redirect(`${redirectUrl}?x_status=success&username=${encodeURIComponent(userProfile.username || '')}`);
  }

  res.status(200).json({
    success: true,
    message: 'X account successfully connected',
    data: integration.toSafeObject(),
  });
});

// @desc    Get X connection status for authenticated user
// @route   GET /api/x/status
// @access  Private (Protected by Gromentum JWT)
const getStatus = asyncHandler(async (req, res) => {
  const integration = await XIntegration.findOne({ userId: req.user._id });

  if (!integration || integration.status === 'disconnected') {
    return res.json({
      success: true,
      connected: false,
      status: 'disconnected',
    });
  }

  res.json({
    success: true,
    ...integration.toSafeObject(),
  });
});

// @desc    Disconnect X integration for authenticated user
// @route   DELETE /api/x/disconnect
// @access  Private (Protected by Gromentum JWT)
const disconnect = asyncHandler(async (req, res) => {
  const integration = await XIntegration.findOne({ userId: req.user._id });

  if (!integration) {
    res.status(404);
    throw new Error('No X integration found to disconnect');
  }

  // Invalidate Redis snapshot cache for this account
  await xRedisService.invalidateConnectionCache(integration._id);

  // Attempt provider-level token revocation asynchronously
  if (integration.accessToken) {
    xAuthService.revokeToken(integration.accessToken, 'access_token').catch(() => {});
  }
  if (integration.refreshToken) {
    xAuthService.revokeToken(integration.refreshToken, 'refresh_token').catch(() => {});
  }

  // Soft disconnect in MongoDB: clear tokens and mark status disconnected
  integration.status = 'disconnected';
  integration.accessToken = null;
  integration.refreshToken = null;
  integration.tokenExpiresAt = null;
  await integration.save();

  res.json({
    success: true,
    message: 'X account disconnected successfully',
  });
});

// @desc    Get X Analytics overview with lazy daily refresh & caching
// @route   GET /api/x/analytics/overview
// @access  Private (Protected by Gromentum JWT)
const getAnalyticsOverview = asyncHandler(async (req, res) => {
  const result = await xAnalyticsService.getAnalyticsOverview(req.user._id);

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Get recent posts with public and organic engagement metrics
// @route   GET /api/x/analytics/posts
// @access  Private (Protected by Gromentum JWT)
const getRecentPosts = asyncHandler(async (req, res) => {
  const result = await xAnalyticsService.getRecentPosts(req.user._id, req.query);

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Diagnostic cache and engine status
// @route   GET /api/x/cache/status
// @access  Private (Protected by Gromentum JWT)
const getCacheStatus = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: xRedisService.getCacheStatus(),
  });
});

module.exports = {
  connect,
  callback,
  getStatus,
  disconnect,
  getAnalyticsOverview,
  getRecentPosts,
  getCacheStatus,
};

