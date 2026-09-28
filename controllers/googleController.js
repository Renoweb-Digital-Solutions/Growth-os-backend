const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const GoogleIntegration = require('../models/GoogleIntegration');
const GoogleOAuthState = require('../models/GoogleOAuthState');
const googleService = require('../services/googleSearchConsoleService');

// @desc    Initiate Google OAuth 2.0 authorization flow (generate secure state & redirect)
// @route   GET /api/google/connect
// @access  Private (Protected by Gromentum JWT)
const connect = asyncHandler(async (req, res) => {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.GOOGLE_REDIRECT_URI
  ) {
    res.status(500);
    throw new Error(
      'Google OAuth environment variables are incomplete (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required)'
    );
  }

  const state = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

  await GoogleOAuthState.create({
    state,
    userId: req.user._id,
    expiresAt,
  });

  const authUrl = googleService.getAuthorizationUrl(state);

  if (req.query.format === 'json') {
    return res.json({ url: authUrl });
  }

  res.redirect(authUrl);
});

// @desc    Handle Google OAuth authorization callback
// @route   GET /api/google/callback
// @access  Public (Google Authorization Code Redirect)
const callback = asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Clean up state if Google returned an authorization error
  if (error) {
    if (state) {
      await GoogleOAuthState.findOneAndDelete({ state });
    }
    res.status(400);
    throw new Error(`Google authorization failed: ${error_description || error}`);
  }

  if (!code || !state) {
    if (state) {
      await GoogleOAuthState.findOneAndDelete({ state });
    }
    res.status(400);
    throw new Error('Missing code or state parameter in Google callback');
  }

  // Atomic single-use state consumption to prevent CSRF and replay attacks
  const stateRecord = await GoogleOAuthState.findOneAndDelete({ state });

  if (!stateRecord) {
    res.status(400);
    throw new Error('Invalid or already consumed OAuth state token');
  }

  if (stateRecord.expiresAt < new Date()) {
    res.status(400);
    throw new Error('OAuth state token has expired. Please initiate connection again');
  }

  const tokenData = await googleService.exchangeCodeForToken(code);
  const userProfile = await googleService.getGoogleUserProfile(tokenData.accessToken);

  let tokenExpiresAt = null;
  if (tokenData.expiresIn) {
    tokenExpiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);
  }

  const grantedScopes = tokenData.scope ? tokenData.scope.split(' ') : ['https://www.googleapis.com/auth/webmasters.readonly'];

  // Preserve existing refresh token if Google did not return a new one on re-consent
  const existingIntegration = await GoogleIntegration.findOne({ userId: stateRecord.userId });
  const refreshTokenToSave = tokenData.refreshToken || (existingIntegration ? existingIntegration.refreshToken : null);

  await GoogleIntegration.findOneAndUpdate(
    { userId: stateRecord.userId },
    {
      googleUserId: userProfile.googleUserId,
      accessToken: tokenData.accessToken,
      refreshToken: refreshTokenToSave,
      tokenExpiresAt,
      grantedScopes,
      status: 'connected',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (redirectUrl) {
    return res.redirect(`${redirectUrl}?google_status=success`);
  }

  res.status(200).json({
    success: true,
    message: 'Google Search Console account successfully connected',
    googleUserId: userProfile.googleUserId,
  });
});

// @desc    Get Google connection status for authenticated user
// @route   GET /api/google/status
// @access  Private (Protected by Gromentum JWT)
const getStatus = asyncHandler(async (req, res) => {
  const integration = await GoogleIntegration.findOne({ userId: req.user._id });

  if (!integration || integration.status === 'disconnected') {
    return res.json({
      connected: false,
      status: 'disconnected',
    });
  }

  let currentStatus = integration.status;
  if (integration.tokenExpiresAt && new Date() > integration.tokenExpiresAt) {
    if (!integration.refreshToken) {
      currentStatus = 'expired';
      if (integration.status !== 'expired') {
        integration.status = 'expired';
        await integration.save();
      }
    }
  }

  res.json({
    connected: currentStatus === 'connected',
    status: currentStatus,
    googleUserId: integration.googleUserId,
    grantedScopes: integration.grantedScopes,
    connectedAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  });
});

// @desc    Disconnect Google Search Console integration for authenticated user
// @route   DELETE /api/google/disconnect
// @access  Private (Protected by Gromentum JWT)
const disconnect = asyncHandler(async (req, res) => {
  const integration = await GoogleIntegration.findOne({ userId: req.user._id });

  if (!integration) {
    res.status(404);
    throw new Error('No Google Search Console integration found to disconnect');
  }

  integration.status = 'disconnected';
  integration.accessToken = null;
  integration.refreshToken = null;
  integration.tokenExpiresAt = null;
  await integration.save();

  res.json({
    success: true,
    message: 'Google Search Console account disconnected successfully',
  });
});

module.exports = {
  connect,
  callback,
  getStatus,
  disconnect,
};
