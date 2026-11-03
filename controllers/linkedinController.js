// Reason: Controller handling LinkedIn authentication, OAuth callbacks, connection status,
// asset discovery, and user-specific asset selection across the two independent LinkedIn apps.
// How: Wraps all async methods with asyncHandler, uses atomic single-use state consumption,
// enforces strict app and user isolation, and prevents any token leakage in responses.

const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const LinkedInOAuthState = require('../models/LinkedInOAuthState');
const LinkedInIntegration = require('../models/LinkedInIntegration');
const linkedinService = require('../services/linkedinService');

// @desc    Get configuration status of both LinkedIn apps (public safe info, no secrets)
// @route   GET /api/linkedin/config
// @access  Private (Protected by Gromentum JWT)
const getConfig = asyncHandler(async (req, res) => {
  const adsConfig = linkedinService.getSafeAppInfo('ads');
  const communityConfig = linkedinService.getSafeAppInfo('community');

  res.json({
    success: true,
    data: {
      ads: adsConfig,
      community: communityConfig,
    },
  });
});

// @desc    Get connection status of both LinkedIn apps for authenticated user
// @route   GET /api/linkedin/status
// @access  Private (Protected by Gromentum JWT)
const getAllStatus = asyncHandler(async (req, res) => {
  const [adsIntegration, communityIntegration] = await Promise.all([
    LinkedInIntegration.findOne({ userId: req.user._id, appType: 'ads' }),
    LinkedInIntegration.findOne({ userId: req.user._id, appType: 'community' }),
  ]);

  const [adsSelectedAsset, communitySelectedAsset] = await Promise.all([
    linkedinService.getSelectedAsset(req.user._id, 'ads'),
    linkedinService.getSelectedAsset(req.user._id, 'community'),
  ]);

  const formatStatus = (integration, appType, selectedAsset) => {
    const config = linkedinService.getSafeAppInfo(appType);
    if (!integration || integration.status === 'disconnected') {
      return {
        appType,
        appName: config.appName,
        connected: false,
        status: 'disconnected',
        approvalStatus: config.productStatus,
        selectedAsset: null,
      };
    }
    return integration.toSafeObject({ selectedAsset });
  };

  res.json({
    success: true,
    data: {
      ads: formatStatus(adsIntegration, 'ads', adsSelectedAsset),
      community: formatStatus(communityIntegration, 'community', communitySelectedAsset),
    },
  });
});

// @desc    Initiate LinkedIn OAuth flow for specific app (ads or community)
// @route   GET /api/linkedin/:app/connect
// @access  Private (Protected by Gromentum JWT)
const connect = asyncHandler(async (req, res) => {
  const rawApp = req.params.app || req.query.app;
  const appType = linkedinService.normalizeAppType(rawApp);

  if (!appType) {
    res.status(400);
    throw new Error(
      "Invalid LinkedIn app parameter. Please specify 'ads' (Growmentum) or 'community' (Growmentum-community)."
    );
  }

  const config = linkedinService.getAppConfig(appType);
  const redirectUri = linkedinService.resolveApprovedRedirectUri(appType, req.query.redirect_uri);

  // Generate cryptographically secure state
  const state = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Persist state bound to authenticated user and app type with exact redirect URI (Fix 3)
  await LinkedInOAuthState.create({
    state,
    userId: req.user._id,
    appType,
    redirectUri,
    expiresAt,
  });

  const authUrl = linkedinService.buildAuthorizationUrl(appType, state, redirectUri);

  if (req.query.format === 'json') {
    return res.json({
      success: true,
      url: authUrl,
      state,
      appType,
    });
  }

  res.redirect(authUrl);
});

// @desc    Handle LinkedIn OAuth authorization callback
// @route   GET /api/linkedin/:app/callback OR GET /api/linkedin/callback
// @access  Public (LinkedIn Authorization Code Redirect)
const callback = asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const rawRouteApp = req.params.app ? linkedinService.normalizeAppType(req.params.app) : null;

  // Clean up state if authorization failed or user denied consent
  if (error) {
    if (state) {
      await LinkedInOAuthState.findOneAndDelete({ state });
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (frontendUrl && !req.xhr && req.headers.accept?.includes('text/html')) {
      return res.redirect(
        `${frontendUrl}?linkedin_status=error&error=${encodeURIComponent(error)}&message=${encodeURIComponent(
          error_description || error
        )}`
      );
    }
    res.status(400);
    throw new Error(`LinkedIn authorization failed: ${error_description || error}`);
  }

  if (!code || !state) {
    if (state) {
      await LinkedInOAuthState.findOneAndDelete({ state });
    }
    res.status(400);
    throw new Error('Missing code or state parameter in LinkedIn callback');
  }

  // Atomic single-use state consumption to prevent replay & CSRF
  const stateRecord = await LinkedInOAuthState.findOneAndDelete({ state });

  if (!stateRecord) {
    res.status(400);
    throw new Error('Invalid or already consumed OAuth state token');
  }

  if (stateRecord.expiresAt < new Date()) {
    res.status(400);
    throw new Error('OAuth state token has expired. Please initiate connection again');
  }

  // Enforce OAuth redirect URI binding (Fix 3)
  if (!stateRecord.redirectUri) {
    res.status(400);
    throw new Error('OAuth state record is missing bound redirect URI');
  }

  // Prevent cross-app mix-ups if callback was accessed on a specific app route
  if (rawRouteApp && rawRouteApp !== stateRecord.appType) {
    res.status(400);
    throw new Error(
      `OAuth state app mismatch: state token belongs to '${stateRecord.appType}' but callback was directed to '${rawRouteApp}'`
    );
  }

  const effectiveAppType = stateRecord.appType;
  const config = linkedinService.getAppConfig(effectiveAppType);

  // Exchange code for tokens using strictly the bound redirect URI from state (Fix 3)
  const tokenData = await linkedinService.exchangeCodeForToken(
    effectiveAppType,
    code,
    stateRecord.redirectUri
  );

  // Fetch OpenID user profile
  const userProfile = await linkedinService.getLinkedInUserProfile(tokenData.accessToken);

  let tokenExpiresAt = null;
  if (tokenData.expiresIn) {
    tokenExpiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);
  }

  let refreshTokenExpiresAt = null;
  if (tokenData.refreshTokenExpiresIn) {
    refreshTokenExpiresAt = new Date(Date.now() + tokenData.refreshTokenExpiresIn * 1000);
  }

  // Fix 1: Never treat configured scopes as granted scopes if scope field is absent in token response.
  // Parse returned scopes according to format (space/comma separated).
  // If absent or empty, do NOT assume Advertising API or Community Management permissions are granted.
  let grantedScopes = [];
  if (typeof tokenData.scope === 'string' && tokenData.scope.trim().length > 0) {
    grantedScopes = tokenData.scope.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(tokenData.scope) && tokenData.scope.length > 0) {
    grantedScopes = tokenData.scope.map((s) => String(s).trim()).filter(Boolean);
  } else if (userProfile && userProfile.linkedinMemberId) {
    // Only basic OpenID scopes verified through member profile retrieval.
    // NEVER assume Advertising API or Community Management permissions are granted.
    grantedScopes = ['openid', 'profile', 'email'];
  }

  // Preserve existing refresh token if LinkedIn didn't re-issue one
  const existingIntegration = await LinkedInIntegration.findOne({
    userId: stateRecord.userId,
    appType: effectiveAppType,
  });

  const refreshTokenToSave =
    tokenData.refreshToken || (existingIntegration ? existingIntegration.refreshToken : null);

  await LinkedInIntegration.findOneAndUpdate(
    { userId: stateRecord.userId, appType: effectiveAppType },
    {
      linkedinMemberId: userProfile.linkedinMemberId,
      linkedinMemberName: userProfile.name,
      linkedinMemberEmail: userProfile.email,
      linkedinMemberPicture: userProfile.picture,
      accessToken: tokenData.accessToken,
      refreshToken: refreshTokenToSave,
      tokenExpiresAt,
      refreshTokenExpiresAt,
      grantedScopes,
      status: 'connected',
      approvalStatus: config.productStatus,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (frontendUrl && !req.xhr && req.headers.accept?.includes('text/html')) {
    return res.redirect(
      `${frontendUrl}?linkedin_status=success&app=${effectiveAppType}&member=${encodeURIComponent(
        userProfile.name
      )}`
    );
  }

  res.status(200).json({
    success: true,
    message: `LinkedIn account successfully connected for ${config.appName}`,
    data: {
      appType: effectiveAppType,
      appName: config.appName,
      member: {
        id: userProfile.linkedinMemberId,
        name: userProfile.name,
        email: userProfile.email,
      },
      grantedScopes,
    },
  });
});

// @desc    Get detailed connection status for a specific LinkedIn app
// @route   GET /api/linkedin/:app/status
// @access  Private (Protected by Gromentum JWT)
const getStatus = asyncHandler(async (req, res) => {
  const appType = linkedinService.normalizeAppType(req.params.app);
  if (!appType) {
    res.status(400);
    throw new Error("Invalid LinkedIn app parameter. Use 'ads' or 'community'.");
  }

  const config = linkedinService.getSafeAppInfo(appType);
  const integration = await LinkedInIntegration.findOne({ userId: req.user._id, appType });

  if (!integration || integration.status === 'disconnected') {
    return res.json({
      success: true,
      data: {
        connected: false,
        status: 'disconnected',
        appType,
        appName: config.appName,
        approvalStatus: config.productStatus,
        selectedAsset: null,
      },
    });
  }

  const selectedAsset = await linkedinService.getSelectedAsset(req.user._id, appType);

  res.json({
    success: true,
    data: integration.toSafeObject({ selectedAsset }),
  });
});

// @desc    Disconnect specific LinkedIn app for authenticated user (soft disconnect)
// @route   DELETE /api/linkedin/:app/disconnect
// @access  Private (Protected by Gromentum JWT)
const disconnect = asyncHandler(async (req, res) => {
  const appType = linkedinService.normalizeAppType(req.params.app);
  if (!appType) {
    res.status(400);
    throw new Error("Invalid LinkedIn app parameter. Use 'ads' or 'community'.");
  }

  const integration = await LinkedInIntegration.findOne({ userId: req.user._id, appType });

  if (!integration) {
    res.status(404);
    throw new Error(`No LinkedIn '${appType}' integration found to disconnect.`);
  }

  // Soft disconnect: wipe tokens and mark disconnected
  integration.status = 'disconnected';
  integration.accessToken = null;
  integration.refreshToken = null;
  integration.tokenExpiresAt = null;
  integration.refreshTokenExpiresAt = null;
  integration.selectedAssetId = null;
  await integration.save();

  // Deactivate or unselect stored assets for this app
  const LinkedInAsset = require('../models/LinkedInAsset');
  await LinkedInAsset.updateMany({ userId: req.user._id, appType }, { isSelected: false });

  res.json({
    success: true,
    message: `LinkedIn '${appType}' integration disconnected successfully.`,
  });
});

// @desc    List authorized assets for a specific LinkedIn app
// @route   GET /api/linkedin/:app/assets
// @access  Private (Protected by Gromentum JWT)
const getAssets = asyncHandler(async (req, res) => {
  const appType = linkedinService.normalizeAppType(req.params.app);
  if (!appType) {
    res.status(400);
    throw new Error("Invalid LinkedIn app parameter. Use 'ads' or 'community'.");
  }

  const result = await linkedinService.discoverAssets(req.user._id, appType);

  res.json({
    success: true,
    data: result,
  });
});

// @desc    Select active asset for a specific LinkedIn app
// @route   POST /api/linkedin/:app/selected-asset
// @access  Private (Protected by Gromentum JWT)
const selectAsset = asyncHandler(async (req, res) => {
  const appType = linkedinService.normalizeAppType(req.params.app);
  if (!appType) {
    res.status(400);
    throw new Error("Invalid LinkedIn app parameter. Use 'ads' or 'community'.");
  }

  const { assetId } = req.body;
  if (!assetId) {
    res.status(400);
    throw new Error('assetId is required in request body.');
  }

  const asset = await linkedinService.setSelectedAsset(req.user._id, appType, assetId);

  res.json({
    success: true,
    message: `LinkedIn asset '${asset.name}' selected successfully.`,
    data: asset,
  });
});

// @desc    Get currently selected asset for a specific LinkedIn app
// @route   GET /api/linkedin/:app/selected-asset
// @access  Private (Protected by Gromentum JWT)
const getSelectedAsset = asyncHandler(async (req, res) => {
  const appType = linkedinService.normalizeAppType(req.params.app);
  if (!appType) {
    res.status(400);
    throw new Error("Invalid LinkedIn app parameter. Use 'ads' or 'community'.");
  }

  const asset = await linkedinService.getSelectedAsset(req.user._id, appType);

  res.json({
    success: true,
    data: asset || null,
  });
});

module.exports = {
  getConfig,
  getAllStatus,
  connect,
  callback,
  getStatus,
  disconnect,
  getAssets,
  selectAsset,
  getSelectedAsset,
};
