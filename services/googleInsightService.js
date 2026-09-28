/**
 * Reason: High-level Google Search Console Analytics service layer (Phase 3 equivalent for Search Console).
 * How: Encapsulates user capability evaluation, Search Console property ownership verification,
 * date-range validation, metric derivation (Clicks, Impressions, CTR, Average Position),
 * trend series aggregation, period-over-period comparison, and response envelope normalization.
 */

const User = require('../models/User');
const GoogleIntegration = require('../models/GoogleIntegration');
const googleService = require('./googleSearchConsoleService');

/**
 * Evaluates Google Search Console capability status for the user
 */
const evaluateCapabilities = (integration, properties = []) => {
  const isConnected = Boolean(integration && integration.status === 'connected' && integration.accessToken);

  if (!isConnected) {
    return {
      available: false,
      code: 'NOT_CONNECTED',
      reason: 'Google Search Console account is not connected or authorization has expired',
    };
  }

  if (properties.length === 0) {
    return {
      available: false,
      code: 'ASSET_NOT_FOUND',
      reason: 'No accessible Google Search Console properties/sites discovered for this account',
    };
  }

  return {
    available: true,
    code: 'AVAILABLE',
    reason: null,
  };
};

/**
 * Validates and normalizes YYYY-MM-DD date range inputs
 */
const validateAndNormalizeDateRange = (startDateInput, endDateInput) => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  let endDate;
  if (endDateInput && dateRegex.test(endDateInput)) {
    endDate = new Date(endDateInput);
  } else {
    // Default endDate to 3 days ago due to Google Search Console data latency
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 3);
  }

  let startDate;
  if (startDateInput && dateRegex.test(startDateInput)) {
    startDate = new Date(startDateInput);
  } else {
    // Default startDate to 28 days before endDate (standard 28-day window)
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 27);
  }

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    const err = new Error('Invalid date format: startDate and endDate must be valid dates in YYYY-MM-DD format');
    err.statusCode = 400;
    throw err;
  }

  if (startDate > endDate) {
    const err = new Error('Invalid date range: startDate must be earlier than or equal to endDate');
    err.statusCode = 400;
    throw err;
  }

  const formatDateStr = (d) => d.toISOString().split('T')[0];

  return {
    startDateStr: formatDateStr(startDate),
    endDateStr: formatDateStr(endDate),
    startDateObj: startDate,
    endDateObj: endDate,
  };
};

/**
 * Calculates previous equivalent date range for period-over-period comparison
 */
const calculatePreviousPeriod = (startDateObj, endDateObj) => {
  const diffTime = Math.abs(endDateObj.getTime() - startDateObj.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  const prevEndDate = new Date(startDateObj);
  prevEndDate.setDate(prevEndDate.getDate() - 1);

  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - (diffDays - 1));

  const formatDateStr = (d) => d.toISOString().split('T')[0];

  return {
    prevStartDateStr: formatDateStr(prevStartDate),
    prevEndDateStr: formatDateStr(prevEndDate),
  };
};

/**
 * Fetches user Search Console properties and returns normalized properties + capabilities
 */
const getProperties = async (userId) => {
  const integration = await GoogleIntegration.findOne({ userId });

  if (!integration || integration.status !== 'connected') {
    const capabilities = evaluateCapabilities(integration, []);
    return {
      properties: [],
      capabilities,
    };
  }

  const accessToken = await googleService.getValidAccessToken(userId);
  const properties = await googleService.listProperties(accessToken);
  const capabilities = evaluateCapabilities(integration, properties);

  return {
    properties,
    capabilities,
  };
};

/**
 * Verifies that the requested siteUrl is owned or accessible by the authenticated user
 */
const verifyPropertyAccess = async (userId, targetSiteUrl) => {
  if (!targetSiteUrl || !targetSiteUrl.trim()) {
    const err = new Error(
      'Missing required query parameter: siteUrl. Please specify a Google Search Console property.'
    );
    err.statusCode = 400;
    throw err;
  }

  const { properties } = await getProperties(userId);

  if (properties.length === 0) {
    const err = new Error('No accessible Google Search Console properties found');
    err.statusCode = 404;
    throw err;
  }

  const matchedProperty = properties.find((p) => p.siteUrl === targetSiteUrl || p.displayName === targetSiteUrl);

  if (!matchedProperty) {
    const err = new Error(`Access denied: Google Search Console property '${targetSiteUrl}' is not accessible by this account`);
    err.statusCode = 403;
    throw err;
  }

  return matchedProperty;
};

/**
 * GET /api/google/insights/overview
 * Executive summary across Search Console metrics (Clicks, Impressions, CTR, Position) with date trends and period comparisons
 */
const getOverview = async (userId, queryParams = {}) => {
  const integration = await GoogleIntegration.findOne({ userId });
  const property = await verifyPropertyAccess(userId, queryParams.siteUrl);
  const accessToken = await googleService.getValidAccessToken(userId);

  const { startDateStr, endDateStr, startDateObj, endDateObj } = validateAndNormalizeDateRange(queryParams.startDate, queryParams.endDate);
  const { prevStartDateStr, prevEndDateStr } = calculatePreviousPeriod(startDateObj, endDateObj);

  // 1. Query Current Period Overall Metrics & Trend Series
  const trendResult = await googleService.querySearchAnalytics(accessToken, property.siteUrl, {
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: ['date'],
    rowLimit: 1000,
  });

  const trendRows = trendResult.rows || [];

  // Calculate current period overall summary totals
  const totalClicks = trendRows.reduce((sum, r) => sum + r.clicks, 0);
  const totalImpressions = trendRows.reduce((sum, r) => sum + r.impressions, 0);
  const avgCtr = totalImpressions > 0 ? Number((totalClicks / totalImpressions).toFixed(4)) : 0;
  
  // Weighted average position across impressions
  const weightedPositionSum = trendRows.reduce((sum, r) => sum + r.position * r.impressions, 0);
  const avgPosition = totalImpressions > 0 ? Number((weightedPositionSum / totalImpressions).toFixed(2)) : 0;

  const currentSummary = {
    clicks: totalClicks,
    impressions: totalImpressions,
    ctr: avgCtr,
    position: avgPosition,
  };

  // 2. Query Previous Period Metrics for Comparison
  let previousSummary = null;
  let comparison = null;

  try {
    const prevResult = await googleService.querySearchAnalytics(accessToken, property.siteUrl, {
      startDate: prevStartDateStr,
      endDate: prevEndDateStr,
      dimensions: ['date'],
      rowLimit: 1000,
    });

    const prevRows = prevResult.rows || [];
    const prevClicks = prevRows.reduce((sum, r) => sum + r.clicks, 0);
    const prevImpressions = prevRows.reduce((sum, r) => sum + r.impressions, 0);
    const prevCtr = prevImpressions > 0 ? Number((prevClicks / prevImpressions).toFixed(4)) : 0;
    const prevWeightedPositionSum = prevRows.reduce((sum, r) => sum + r.position * r.impressions, 0);
    const prevPosition = prevImpressions > 0 ? Number((prevWeightedPositionSum / prevImpressions).toFixed(2)) : 0;

    previousSummary = {
      clicks: prevClicks,
      impressions: prevImpressions,
      ctr: prevCtr,
      position: prevPosition,
    };

    // Calculate percentage and absolute changes
    const calcPctChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(2));
    };

    comparison = {
      clicksChangePct: calcPctChange(totalClicks, prevClicks),
      impressionsChangePct: calcPctChange(totalImpressions, prevImpressions),
      ctrChangeDiff: Number((avgCtr - prevCtr).toFixed(4)),
      positionChangeDiff: Number((avgPosition - prevPosition).toFixed(2)), // Note: Negative position difference indicates ranking improvement
    };
  } catch (err) {
    previousSummary = null;
    comparison = null;
  }

  // Format trend series items
  const trendSeries = trendRows.map((row) => ({
    date: row.keys[0] || null,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  })).sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0));

  const { capabilities } = await getProperties(userId);

  return {
    data: {
      property: {
        siteUrl: property.siteUrl,
        displayName: property.displayName,
        permissionLevel: property.permissionLevel,
        propertyType: property.propertyType,
      },
      summary: currentSummary,
      previousPeriodSummary: previousSummary,
      comparison: comparison,
      trend: trendSeries,
    },
    meta: {
      source: 'google_search_console',
      dateRange: {
        startDate: startDateStr,
        endDate: endDateStr,
        previousStartDate: prevStartDateStr,
        previousEndDate: prevEndDateStr,
      },
      capabilities,
    },
  };
};

/**
 * GET /api/google/insights/performance
 * Flexible dimension performance breakdown (queries, pages, countries, devices, date)
 */
const getPerformance = async (userId, queryParams = {}) => {
  const property = await verifyPropertyAccess(userId, queryParams.siteUrl);
  const accessToken = await googleService.getValidAccessToken(userId);

  const { startDateStr, endDateStr } = validateAndNormalizeDateRange(queryParams.startDate, queryParams.endDate);

  const rawDimension = queryParams.dimension || queryParams.dimensions;
  let dimensions = ['query']; // Default dimension

  if (typeof rawDimension === 'string') {
    dimensions = [rawDimension];
  } else if (Array.isArray(rawDimension)) {
    dimensions = rawDimension;
  }

  const allowedDimensions = ['date', 'query', 'page', 'country', 'device', 'searchAppearance'];
  const validDimensions = dimensions.filter((d) => allowedDimensions.includes(d));
  if (validDimensions.length === 0) validDimensions.push('query');

  const rowLimit = queryParams.rowLimit || queryParams.limit || 1000;

  const result = await googleService.querySearchAnalytics(accessToken, property.siteUrl, {
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: validDimensions,
    rowLimit,
  });

  const rows = result.rows || [];

  const items = rows.map((row) => {
    const itemObj = {
      keys: row.keys,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    };

    // Attach named keys for single dimension queries for developer convenience
    if (validDimensions.length === 1) {
      const dimName = validDimensions[0];
      itemObj[dimName] = row.keys[0] || '';
    }

    return itemObj;
  });

  const { capabilities } = await getProperties(userId);

  return {
    data: {
      property: {
        siteUrl: property.siteUrl,
        displayName: property.displayName,
        permissionLevel: property.permissionLevel,
        propertyType: property.propertyType,
      },
      dimensions: validDimensions,
      items: items,
      count: items.length,
    },
    meta: {
      source: 'google_search_console',
      dateRange: {
        startDate: startDateStr,
        endDate: endDateStr,
      },
      capabilities,
    },
  };
};

/**
 * Helper to fetch dimension-specific breakdowns (queries, pages, countries, devices)
 */
const getDimensionBreakdown = async (userId, dimensionName, queryParams = {}) => {
  return await getPerformance(userId, {
    ...queryParams,
    dimension: dimensionName,
  });
};

module.exports = {
  evaluateCapabilities,
  validateAndNormalizeDateRange,
  getProperties,
  verifyPropertyAccess,
  getOverview,
  getPerformance,
  getDimensionBreakdown,
};
