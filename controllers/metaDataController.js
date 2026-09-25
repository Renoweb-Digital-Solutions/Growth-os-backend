const asyncHandler = require('../utils/asyncHandler');
const MetaIntegration = require('../models/MetaIntegration');
const metaService = require('../services/metaService');
const metaInsightService = require('../services/metaInsightService');

/**
 * Helper to fetch active accessToken for authenticated user
 */
const getAccessToken = async (userId) => {
  const integration = await MetaIntegration.findOne({ userId });

  if (!integration || !integration.accessToken || integration.status !== 'connected') {
    const err = new Error('Meta account is not connected or authorization has expired');
    err.statusCode = 401;
    throw err;
  }

  if (integration.tokenExpiresAt && new Date() > integration.tokenExpiresAt) {
    integration.status = 'expired';
    integration.accessToken = null;
    await integration.save();
    const err = new Error('Meta access token has expired. Please reconnect your Meta account');
    err.statusCode = 401;
    throw err;
  }

  return integration.accessToken;
};

/**
 * Helper to validate since / until date range parameters
 */
const validateDateRange = (since, until) => {
  if (since && until) {
    const startDate = new Date(since);
    const endDate = new Date(until);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      const err = new Error('Invalid date parameters: since and until must be valid date strings (YYYY-MM-DD)');
      err.statusCode = 400;
      throw err;
    }

    if (startDate > endDate) {
      const err = new Error('Invalid date range: since parameter must be earlier than or equal to until parameter');
      err.statusCode = 400;
      throw err;
    }
  }
};

// @desc    Discover all accessible Meta assets & capability flags
// @route   GET /api/meta/assets
// @access  Private (Protected by Gromentum JWT)
const getAssets = asyncHandler(async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const ctx = await metaInsightService.getUserContextAndAssets(req.user._id, forceRefresh);

  if (!ctx.integration || ctx.integration.status !== 'connected') {
    const err = new Error('Meta account is not connected or authorization has expired');
    err.statusCode = 401;
    throw err;
  }

  const result = ctx.assets;

  const safePages = result.pages.map((p) => {
    const { pageToken, ...safePage } = p;
    return safePage;
  });

  res.json({
    success: true,
    data: { ...result, pages: safePages },
  });
});

// @desc    List accessible Facebook Pages
// @route   GET /api/meta/pages
// @access  Private (Protected by Gromentum JWT)
const getPages = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const pages = await metaService.getFacebookPages(accessToken, req.user._id);

  const safePages = pages.map((p) => {
    const { pageToken, ...safePage } = p;
    return safePage;
  });

  res.json({
    success: true,
    data: {
      pages: safePages,
      count: safePages.length,
    },
  });
});

// @desc    Get details for a specific Facebook Page
// @route   GET /api/meta/pages/:pageId
// @access  Private (Protected by Gromentum JWT)
const getPageById = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const page = await metaService.getFacebookPageDetails(req.params.pageId, accessToken, req.user._id);

  const { pageToken, ...safePage } = page;

  res.json({
    success: true,
    data: safePage,
  });
});

// @desc    Get posts for a specific Facebook Page
// @route   GET /api/meta/pages/:pageId/posts
// @access  Private (Protected by Gromentum JWT)
const getPagePosts = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const { limit, after } = req.query;

  const result = await metaService.getFacebookPagePosts(
    req.params.pageId,
    accessToken,
    { limit, after },
    req.user._id
  );

  res.json({
    success: true,
    data: result.posts,
    pagination: result.pagination,
  });
});

// @desc    Get metrics insights for a Facebook Page
// @route   GET /api/meta/pages/:pageId/insights
// @access  Private (Protected by Gromentum JWT)
const getPageInsights = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const { since, until } = req.query;

  validateDateRange(since, until);

  const result = await metaService.getFacebookPageInsights(
    req.params.pageId,
    accessToken,
    { since, until },
    req.user._id
  );

  res.json({
    success: true,
    data: result,
  });
});

// @desc    List connected Instagram Professional Accounts
// @route   GET /api/meta/instagram
// @access  Private (Protected by Gromentum JWT)
const getInstagramAccounts = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const instagramAccounts = await metaService.getInstagramAccounts(accessToken, req.user._id);

  res.json({
    success: true,
    data: {
      available: instagramAccounts.length > 0,
      instagramAccounts,
      count: instagramAccounts.length,
    },
  });
});

// @desc    Get media posts for an Instagram Professional Account
// @route   GET /api/meta/instagram/:instagramAccountId/media
// @access  Private (Protected by Gromentum JWT)
const getInstagramMedia = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const { limit, after } = req.query;

  const result = await metaService.getInstagramMedia(
    req.params.instagramAccountId,
    accessToken,
    { limit, after },
    req.user._id
  );

  res.json({
    success: true,
    data: result.media,
    pagination: result.pagination,
  });
});

// @desc    Get account insights for an Instagram Professional Account
// @route   GET /api/meta/instagram/:instagramAccountId/insights
// @access  Private (Protected by Gromentum JWT)
const getInstagramInsights = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const { since, until } = req.query;

  validateDateRange(since, until);

  const result = await metaService.getInstagramInsights(
    req.params.instagramAccountId,
    accessToken,
    { since, until },
    req.user._id
  );

  res.json({
    success: true,
    data: result,
  });
});

// @desc    List accessible Meta Ad Accounts
// @route   GET /api/meta/ad-accounts
// @access  Private (Protected by Gromentum JWT)
const getAdAccounts = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  
  let adAccounts = [];
  try {
    adAccounts = await metaService.getAdAccounts(accessToken, req.user._id);
  } catch (error) {
    adAccounts = [];
  }

  res.json({
    success: true,
    data: {
      available: adAccounts.length > 0,
      adAccounts,
      count: adAccounts.length,
    },
  });
});

// @desc    Get campaigns for an Ad Account
// @route   GET /api/meta/ad-accounts/:adAccountId/campaigns
// @access  Private (Protected by Gromentum JWT)
const getCampaigns = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const { limit, after } = req.query;

  const result = await metaService.getCampaigns(
    req.params.adAccountId,
    accessToken,
    { limit, after },
    req.user._id
  );

  res.json({
    success: true,
    data: result.campaigns,
    pagination: result.pagination,
  });
});

// @desc    Get Ad Sets for an Ad Account or Campaign
// @route   GET /api/meta/ad-accounts/:adAccountId/adsets
// @access  Private (Protected by Gromentum JWT)
const getAdSets = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const { campaignId, limit, after } = req.query;

  const result = await metaService.getAdSets(
    req.params.adAccountId,
    accessToken,
    { campaignId, limit, after },
    req.user._id
  );

  res.json({
    success: true,
    data: result.adSets,
    pagination: result.pagination,
  });
});

// @desc    Get Ads for an Ad Account, Ad Set, or Campaign
// @route   GET /api/meta/ad-accounts/:adAccountId/ads
// @access  Private (Protected by Gromentum JWT)
const getAds = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const { campaignId, adSetId, limit, after } = req.query;

  const result = await metaService.getAds(
    req.params.adAccountId,
    accessToken,
    { campaignId, adSetId, limit, after },
    req.user._id
  );

  res.json({
    success: true,
    data: result.ads,
    pagination: result.pagination,
  });
});

// @desc    Get Ads Insights metrics for an Ad Account
// @route   GET /api/meta/ad-accounts/:adAccountId/insights
// @access  Private (Protected by Gromentum JWT)
const getAdsInsights = asyncHandler(async (req, res) => {
  const accessToken = await getAccessToken(req.user._id);
  const { level, datePreset, since, until, limit, after } = req.query;

  validateDateRange(since, until);

  const result = await metaService.getAdsInsights(
    req.params.adAccountId,
    accessToken,
    { level, datePreset, since, until, limit, after },
    req.user._id
  );

  res.json({
    success: true,
    data: result.insights,
    level: result.level,
    pagination: result.pagination,
  });
});

module.exports = {
  getAssets,
  getPages,
  getPageById,
  getPagePosts,
  getPageInsights,
  getInstagramAccounts,
  getInstagramMedia,
  getInstagramInsights,
  getAdAccounts,
  getCampaigns,
  getAdSets,
  getAds,
  getAdsInsights,
};
