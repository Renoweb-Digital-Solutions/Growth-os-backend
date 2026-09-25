/**
 * Reason: Controller layer for Phase 3 GROmentum Insights & Data Delivery endpoints.
 * How: Handles incoming HTTP requests, validates date range query parameters, 
 * invokes metaInsightService with authenticated user ID, and returns standard Gromentum response envelopes.
 */

const asyncHandler = require('../utils/asyncHandler');
const metaInsightService = require('../services/metaInsightService');

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

// @desc    Executive overview of Social and Ads performance metrics
// @route   GET /api/meta/insights/overview
// @access  Private (Protected by Gromentum JWT)
const getOverview = asyncHandler(async (req, res) => {
  const { pageId, instagramAccountId, instagramId, adAccountId, datePreset, since, until } = req.query;
  validateDateRange(since, until);

  const result = await metaInsightService.getOverview(req.user._id, {
    pageId,
    instagramAccountId: instagramAccountId || instagramId,
    instagramId,
    adAccountId,
    datePreset,
    since,
    until,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Unified Social insights for Facebook Pages and Instagram Accounts
// @route   GET /api/meta/insights/social
// @access  Private (Protected by Gromentum JWT)
const getSocialInsights = asyncHandler(async (req, res) => {
  const { pageId, instagramAccountId, instagramId, datePreset, since, until } = req.query;
  validateDateRange(since, until);

  const result = await metaInsightService.getSocialInsights(req.user._id, {
    pageId,
    instagramAccountId: instagramAccountId || instagramId,
    instagramId,
    datePreset,
    since,
    until,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Consolidated post & media content insights list
// @route   GET /api/meta/insights/content
// @access  Private (Protected by Gromentum JWT)
const getContentInsights = asyncHandler(async (req, res) => {
  const { pageId, instagramAccountId, instagramId, platform, limit, after, since, until, datePreset } = req.query;
  validateDateRange(since, until);

  const result = await metaInsightService.getContentInsights(req.user._id, {
    pageId,
    instagramAccountId: instagramAccountId || instagramId,
    instagramId,
    platform,
    limit,
    after,
    since,
    until,
    datePreset,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Get details and insights for a specific published post/media item
// @route   GET /api/meta/insights/content/:contentId
// @access  Private (Protected by Gromentum JWT)
const getSingleContentInsights = asyncHandler(async (req, res) => {
  const { contentId } = req.params;
  const { platform, assetId } = req.query;

  const result = await metaInsightService.getSingleContentInsights(req.user._id, contentId, {
    platform,
    assetId,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Advertising Insights across Ad Accounts with derived metrics
// @route   GET /api/meta/insights/ads
// @access  Private (Protected by Gromentum JWT)
const getAdsInsights = asyncHandler(async (req, res) => {
  const { adAccountId, level, datePreset, since, until, limit, after } = req.query;
  validateDateRange(since, until);

  const result = await metaInsightService.getAdsInsights(req.user._id, {
    adAccountId,
    level,
    datePreset,
    since,
    until,
    limit,
    after,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Campaign-level performance breakdown with currency subunit conversion
// @route   GET /api/meta/insights/campaigns
// @access  Private (Protected by Gromentum JWT)
const getCampaignInsights = asyncHandler(async (req, res) => {
  const { adAccountId, status, limit, after } = req.query;

  const result = await metaInsightService.getCampaignInsights(req.user._id, {
    adAccountId,
    status,
    limit,
    after,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    AdSet-level performance breakdown
// @route   GET /api/meta/insights/adsets
// @access  Private (Protected by Gromentum JWT)
const getAdSetInsights = asyncHandler(async (req, res) => {
  const { adAccountId, campaignId, limit, after } = req.query;

  const result = await metaInsightService.getAdSetInsights(req.user._id, {
    adAccountId,
    campaignId,
    limit,
    after,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Ad-level performance breakdown
// @route   GET /api/meta/insights/ads-level
// @access  Private (Protected by Gromentum JWT)
const getAdInsights = asyncHandler(async (req, res) => {
  const { adAccountId, adSetId, campaignId, limit, after } = req.query;

  const result = await metaInsightService.getAdInsights(req.user._id, {
    adAccountId,
    adSetId,
    campaignId,
    limit,
    after,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

module.exports = {
  getOverview,
  getSocialInsights,
  getContentInsights,
  getSingleContentInsights,
  getAdsInsights,
  getCampaignInsights,
  getAdSetInsights,
  getAdInsights,
};
