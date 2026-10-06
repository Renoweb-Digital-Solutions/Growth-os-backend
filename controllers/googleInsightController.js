/**
 * Reason: Controller layer for Google Search Console properties and Search Analytics endpoints.
 * How: Handles incoming HTTP requests, invokes googleInsightService with authenticated user ID,
 * and returns standard normalized application response envelopes.
 */

const asyncHandler = require('../utils/asyncHandler');
const googleInsightService = require('../services/googleInsightService');

// @desc    List accessible Google Search Console properties/sites
// @route   GET /api/google/properties
// @access  Private (Protected by Gromentum JWT)
const getProperties = asyncHandler(async (req, res) => {
  const result = await googleInsightService.getProperties(req.user._id);

  res.json({
    success: true,
    data: result.properties,
    count: result.properties.length,
    capabilities: result.capabilities,
  });
});

// @desc    Executive overview of Search Console metrics (Clicks, Impressions, CTR, Position, Trends, Comparison)
// @route   GET /api/google/insights/overview
// @access  Private (Protected by Gromentum JWT)
const getOverview = asyncHandler(async (req, res) => {
  const { siteUrl, startDate, endDate, rangePreset, range } = req.query;

  const result = await googleInsightService.getOverview(req.user._id, {
    siteUrl,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Flexible dimension performance breakdown (queries, pages, countries, devices)
// @route   GET /api/google/insights/performance
// @access  Private (Protected by Gromentum JWT)
const getPerformance = asyncHandler(async (req, res) => {
  const { siteUrl, startDate, endDate, rangePreset, range, dimension, dimensions, rowLimit, limit } = req.query;

  const result = await googleInsightService.getPerformance(req.user._id, {
    siteUrl,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    dimension,
    dimensions,
    rowLimit: rowLimit || limit,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Search Analytics Query (Keyword) breakdown
// @route   GET /api/google/insights/queries
// @access  Private (Protected by Gromentum JWT)
const getQueries = asyncHandler(async (req, res) => {
  const { siteUrl, startDate, endDate, rangePreset, range, rowLimit, limit } = req.query;

  const result = await googleInsightService.getDimensionBreakdown(req.user._id, 'query', {
    siteUrl,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    rowLimit: rowLimit || limit,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Search Analytics Landing Page breakdown
// @route   GET /api/google/insights/pages
// @access  Private (Protected by Gromentum JWT)
const getPages = asyncHandler(async (req, res) => {
  const { siteUrl, startDate, endDate, rangePreset, range, rowLimit, limit } = req.query;

  const result = await googleInsightService.getDimensionBreakdown(req.user._id, 'page', {
    siteUrl,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    rowLimit: rowLimit || limit,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Search Analytics Country breakdown
// @route   GET /api/google/insights/countries
// @access  Private (Protected by Gromentum JWT)
const getCountries = asyncHandler(async (req, res) => {
  const { siteUrl, startDate, endDate, rangePreset, range, rowLimit, limit } = req.query;

  const result = await googleInsightService.getDimensionBreakdown(req.user._id, 'country', {
    siteUrl,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    rowLimit: rowLimit || limit,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Search Analytics Device category breakdown (DESKTOP, MOBILE, TABLET)
// @route   GET /api/google/insights/devices
// @access  Private (Protected by Gromentum JWT)
const getDevices = asyncHandler(async (req, res) => {
  const { siteUrl, startDate, endDate, rangePreset, range, rowLimit, limit } = req.query;

  const result = await googleInsightService.getDimensionBreakdown(req.user._id, 'device', {
    siteUrl,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    rowLimit: rowLimit || limit,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// @desc    Search Analytics Performance comparison endpoint (current vs comparison period, daily or hourly)
// @route   GET /api/google/insights/performance/compare
// @access  Private (Protected by Gromentum JWT)
const getPerformanceCompare = asyncHandler(async (req, res) => {
  const {
    siteUrl,
    startDate,
    endDate,
    rangePreset,
    range,
    comparisonType,
    comparisonStartDate,
    comparisonEndDate,
    granularity,
    timezone,
  } = req.query;

  const result = await googleInsightService.getPerformanceCompare(req.user._id, {
    siteUrl,
    startDate,
    endDate,
    rangePreset: rangePreset || range,
    comparisonType,
    comparisonStartDate,
    comparisonEndDate,
    granularity,
    timezone,
  });

  res.json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

module.exports = {
  getProperties,
  getOverview,
  getPerformance,
  getQueries,
  getPages,
  getCountries,
  getDevices,
  getPerformanceCompare,
};

