const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const MetaIntegration = require('../models/MetaIntegration');
const MetaOAuthState = require('../models/MetaOAuthState');
const metaService = require('../services/metaService');
const metaInsightService = require('../services/metaInsightService');

// @desc    Initiate Meta OAuth flow (generate secure state & redirect)
// @route   GET /api/meta/connect
// @access  Private (Protected by Gromentum JWT)
const connect = asyncHandler(async (req, res) => {
  if (
    !process.env.META_APP_ID ||
    !process.env.META_APP_SECRET ||
    !process.env.META_REDIRECT_URI ||
    !process.env.META_GRAPH_API_VERSION
  ) {
    res.status(500);
    throw new Error(
      'Meta OAuth environment variables are incomplete (META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, and META_GRAPH_API_VERSION are required)'
    );
  }

  const state = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await MetaOAuthState.create({
    state,
    userId: req.user._id,
    expiresAt,
  });

  const authUrl = metaService.buildAuthorizationUrl(state);

  if (req.query.format === 'json') {
    return res.json({ url: authUrl });
  }

  res.redirect(authUrl);
});

// @desc    Handle Meta OAuth callback
// @route   GET /api/meta/callback
// @access  Public (Meta Browser Redirect)
const callback = asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Clean up state if Meta returned an authorization error
  if (error) {
    if (state) {
      await MetaOAuthState.findOneAndDelete({ state });
    }
    res.status(400);
    throw new Error(`Meta authorization failed: ${error_description || error}`);
  }

  if (!code || !state) {
    if (state) {
      await MetaOAuthState.findOneAndDelete({ state });
    }
    res.status(400);
    throw new Error('Missing code or state parameter in Meta callback');
  }

  // Atomic single-use state consumption to prevent replay attacks
  const stateRecord = await MetaOAuthState.findOneAndDelete({ state });

  if (!stateRecord) {
    res.status(400);
    throw new Error('Invalid or already consumed OAuth state token');
  }

  if (stateRecord.expiresAt < new Date()) {
    res.status(400);
    throw new Error('OAuth state token has expired. Please initiate connection again');
  }

  const tokenData = await metaService.exchangeCodeForToken(code);
  const metaUser = await metaService.getMetaUserProfile(tokenData.accessToken);
  const grantedScopes = await metaService.getGrantedPermissions(tokenData.accessToken);

  let tokenExpiresAt = null;
  if (tokenData.expiresIn) {
    tokenExpiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);
  }

  await MetaIntegration.findOneAndUpdate(
    { userId: stateRecord.userId },
    {
      metaUserId: metaUser.id,
      accessToken: tokenData.accessToken,
      tokenExpiresAt,
      grantedScopes,
      status: 'connected',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  metaInsightService.invalidateUserCache(stateRecord.userId);

  const redirectUrl = process.env.FRONTEND_URL || process.env.META_SUCCESS_REDIRECT_URL;
  if (redirectUrl) {
    return res.redirect(`${redirectUrl}?meta_status=success`);
  }

  res.status(200).json({
    success: true,
    message: 'Meta account successfully connected',
    metaUserId: metaUser.id,
  });
});

// @desc    Get Meta connection status for authenticated user
// @route   GET /api/meta/status
// @access  Private (Protected by Gromentum JWT)
const getStatus = asyncHandler(async (req, res) => {
  const integration = await MetaIntegration.findOne({ userId: req.user._id });

  if (!integration || integration.status === 'disconnected') {
    return res.json({
      connected: false,
      status: 'disconnected',
    });
  }

  let currentStatus = integration.status;
  if (integration.tokenExpiresAt && new Date() > integration.tokenExpiresAt) {
    currentStatus = 'expired';
    if (integration.status !== 'expired') {
      integration.status = 'expired';
      await integration.save();
    }
  }

  res.json({
    connected: currentStatus === 'connected',
    status: currentStatus,
    metaUserId: integration.metaUserId,
    grantedScopes: integration.grantedScopes,
    connectedAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  });
});

// @desc    Disconnect Meta integration for authenticated user
// @route   DELETE /api/meta/disconnect
// @access  Private (Protected by Gromentum JWT)
const disconnect = asyncHandler(async (req, res) => {
  const integration = await MetaIntegration.findOne({ userId: req.user._id });

  if (!integration) {
    res.status(404);
    throw new Error('No Meta integration found to disconnect');
  }

  integration.status = 'disconnected';
  integration.accessToken = null;
  integration.tokenExpiresAt = null;
  await integration.save();

  metaInsightService.invalidateUserCache(req.user._id);

  res.json({
    success: true,
    message: 'Meta account disconnected successfully',
  });
});

module.exports = {
  connect,
  callback,
  getStatus,
  disconnect,
};
