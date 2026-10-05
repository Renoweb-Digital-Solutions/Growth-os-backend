/**
 * Reason: Controller layer handling Google Analytics 4 property discovery and selection endpoints.
 * How: Invokes googleAnalyticsAdminService with authenticated user ID, enforcing protection, and returning standard normalized JSON envelopes.
 */

const asyncHandler = require('../utils/asyncHandler');
const googleAnalyticsAdminService = require('../services/googleAnalyticsAdminService');
const GoogleIntegration = require('../models/GoogleIntegration');

// @desc    List and discover accessible Google Analytics 4 properties
// @route   GET /api/google/analytics/properties
// @access  Private (Protected by Gromentum JWT)
const getProperties = asyncHandler(async (req, res) => {
  const result = await googleAnalyticsAdminService.discoverAndSyncProperties(req.user._id);

  res.json({
    success: true,
    data: {
      properties: result.properties,
      selectedProperty: result.selectedProperty,
      count: result.count,
    },
    capabilities: result.capabilities,
    meta: {
      source: 'google_analytics_admin_api',
    },
  });
});

// @desc    Select active GA4 property for authenticated user
// @route   POST /api/google/analytics/property
// @access  Private (Protected by Gromentum JWT)
const selectProperty = asyncHandler(async (req, res) => {
  const { propertyId } = req.body;

  const selectedProperty = await googleAnalyticsAdminService.setSelectedProperty(req.user._id, propertyId);

  res.json({
    success: true,
    message: `Google Analytics 4 property '${selectedProperty.displayName}' selected successfully`,
    data: selectedProperty,
  });
});

// @desc    Get Google Analytics 4 integration and scope status for authenticated user
// @route   GET /api/google/analytics/status
// @access  Private (Protected by Gromentum JWT)
const getStatus = asyncHandler(async (req, res) => {
  const integration = await GoogleIntegration.findOne({ userId: req.user._id });

  if (!integration || integration.status === 'disconnected') {
    return res.json({
      connected: false,
      status: 'disconnected',
      hasAnalyticsScope: false,
    });
  }

  const hasScope = googleAnalyticsAdminService.hasAnalyticsScope(integration.grantedScopes);
  const selectedProperty = await googleAnalyticsAdminService.getSelectedProperty(req.user._id);

  let currentStatus = integration.status;
  if (integration.tokenExpiresAt && new Date() > integration.tokenExpiresAt) {
    if (!integration.refreshToken) {
      currentStatus = 'expired';
    }
  }

  res.json({
    connected: currentStatus === 'connected',
    status: currentStatus,
    hasAnalyticsScope: hasScope,
    googleUserId: integration.googleUserId,
    grantedScopes: integration.grantedScopes,
    selectedProperty: selectedProperty
      ? {
          propertyId: selectedProperty.propertyId,
          propertyName: selectedProperty.propertyName,
          displayName: selectedProperty.displayName,
          timeZone: selectedProperty.timeZone,
          currencyCode: selectedProperty.currencyCode,
        }
      : null,
    connectedAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  });
});

const googleAnalyticsDataService = require('../services/googleAnalyticsDataService');

// @desc    Executive overview of GA4 metrics (Active Users, Sessions, Engagement, Revenue, Trends, Comparison)
// @route   GET /api/google/analytics/insights/overview
// @access  Private (Protected by Gromentum JWT)
const getOverview = asyncHandler(async (req, res) => {
  const {
    propertyId,
    metrics,
    kpiMetrics,
    kpis,
    startDate,
    endDate,
    rangePreset,
    range,
    comparisonType,
    comparisonStartDate,
    comparisonEndDate,
    trendMetric,
    metric,
  } = req.query;

  const result = await googleAnalyticsDataService.getOverview(req.user._id, {
    propertyId,
    metrics: metrics || kpiMetrics || kpis,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    comparisonType,
    comparisonStartDate,
    comparisonEndDate,
    trendMetric: trendMetric || metric,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});


// @desc    Session-level Traffic Acquisition report (Channels, Sources, Mediums, Campaigns)
// @route   GET /api/google/analytics/insights/acquisition
// @access  Private (Protected by Gromentum JWT)
const getTrafficAcquisition = asyncHandler(async (req, res) => {
  const {
    propertyId,
    startDate,
    endDate,
    rangePreset,
    range,
    dimension,
    dimensions,
    comparisonType,
    comparisonStartDate,
    comparisonEndDate,
    orderBy,
    limit,
    rowLimit,
    channel,
    source,
    medium,
    campaign,
  } = req.query;

  const result = await googleAnalyticsDataService.getTrafficAcquisition(req.user._id, {
    propertyId,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    dimension: dimension || dimensions,
    comparisonType,
    comparisonStartDate,
    comparisonEndDate,
    orderBy,
    limit: limit || rowLimit,
    channel,
    source,
    medium,
    campaign,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    First-user Acquisition report (First-User Channels, Sources, Mediums, Campaigns)
// @route   GET /api/google/analytics/insights/user-acquisition
// @access  Private (Protected by Gromentum JWT)
const getUserAcquisition = asyncHandler(async (req, res) => {
  const {
    propertyId,
    startDate,
    endDate,
    rangePreset,
    range,
    dimension,
    dimensions,
    comparisonType,
    comparisonStartDate,
    comparisonEndDate,
    orderBy,
    limit,
    rowLimit,
    channel,
    source,
    medium,
    campaign,
  } = req.query;

  const result = await googleAnalyticsDataService.getUserAcquisition(req.user._id, {
    propertyId,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    dimension: dimension || dimensions,
    comparisonType,
    comparisonStartDate,
    comparisonEndDate,
    orderBy,
    limit: limit || rowLimit,
    channel,
    source,
    medium,
    campaign,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    GA4 Suggested-for-You Card Data APIs with per-card independent date ranges
// @route   GET /api/google/analytics/insights/suggested-cards
// @route   GET /api/google/analytics/insights/suggested-cards/:cardKey
// @access  Private (Protected by Gromentum JWT)
const getSuggestedCards = asyncHandler(async (req, res) => {
  const cardKey = req.params.cardKey || req.query.card || req.query.cardKey;

  const result = await googleAnalyticsDataService.getSuggestedCards(req.user._id, {
    ...req.query,
    card: cardKey,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    GA4 Realtime Data API for "Active users in last 30 minutes" card
// @route   GET /api/google/analytics/insights/realtime
// @access  Private (Protected by Gromentum JWT)
const getRealtime = asyncHandler(async (req, res) => {
  const result = await googleAnalyticsDataService.getRealtimeData(req.user._id, req.query);

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

module.exports = {
  getProperties,
  selectProperty,
  getStatus,
  getOverview,
  getTrafficAcquisition,
  getUserAcquisition,
  getSuggestedCards,
  getRealtime,
};


