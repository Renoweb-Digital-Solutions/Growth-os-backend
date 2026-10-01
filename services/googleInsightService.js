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
 * Validates and normalizes YYYY-MM-DD date range inputs, supporting predefined range presets (7d, 28d, 3m, 6m, 12m, 16m)
 * matching native Google Search Console date boundary rules.
 */
const validateAndNormalizeDateRange = (startDateInput, endDateInput, rangePresetInput) => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  let endDateStr;
  if (endDateInput && dateRegex.test(endDateInput)) {
    endDateStr = endDateInput;
  } else {
    // Default endDate to 3 days ago in UTC due to Google Search Console data latency
    const nowUtc = new Date();
    const defaultEndUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - 3));
    endDateStr = formatUtcDate(defaultEndUtc);
  }

  const endUtc = parseUtcDate(endDateStr);
  let startDateStr;

  if (rangePresetInput) {
    const preset = String(rangePresetInput).toLowerCase().trim();
    switch (preset) {
      case '7d':
      case '7_days':
        startDateStr = formatUtcDate(new Date(endUtc.getTime() - 6 * 24 * 60 * 60 * 1000));
        break;
      case '28d':
      case '28_days':
        startDateStr = formatUtcDate(new Date(endUtc.getTime() - 27 * 24 * 60 * 60 * 1000));
        break;
      case '3m':
      case '3_months':
        startDateStr = formatUtcDate(new Date(Date.UTC(endUtc.getUTCFullYear(), endUtc.getUTCMonth() - 3, endUtc.getUTCDate() + 1)));
        break;
      case '6m':
      case '6_months':
        startDateStr = formatUtcDate(new Date(Date.UTC(endUtc.getUTCFullYear(), endUtc.getUTCMonth() - 6, endUtc.getUTCDate() + 1)));
        break;
      case '12m':
      case '12_months':
        startDateStr = formatUtcDate(new Date(Date.UTC(endUtc.getUTCFullYear(), endUtc.getUTCMonth() - 12, endUtc.getUTCDate() + 1)));
        break;
      case '16m':
      case '16_months':
        startDateStr = formatUtcDate(new Date(Date.UTC(endUtc.getUTCFullYear(), endUtc.getUTCMonth() - 16, endUtc.getUTCDate() + 1)));
        break;
      default:
        startDateStr = formatUtcDate(new Date(endUtc.getTime() - 27 * 24 * 60 * 60 * 1000));
    }
  } else if (startDateInput && dateRegex.test(startDateInput)) {
    startDateStr = startDateInput;
  } else {
    // Default startDate to 28 days before endDate (standard 28-day window)
    startDateStr = formatUtcDate(new Date(endUtc.getTime() - 27 * 24 * 60 * 60 * 1000));
  }

  const startUtc = parseUtcDate(startDateStr);

  if (isNaN(startUtc.getTime()) || isNaN(endUtc.getTime())) {
    const err = new Error('Invalid date format: startDate and endDate must be valid dates in YYYY-MM-DD format');
    err.statusCode = 400;
    throw err;
  }

  if (startUtc > endUtc) {
    const err = new Error('Invalid date range: startDate must be earlier than or equal to endDate');
    err.statusCode = 400;
    throw err;
  }

  return {
    startDateStr,
    endDateStr,
    startDateObj: startUtc,
    endDateObj: endUtc,
  };
};

/**
 * Calculates previous equivalent date range for period-over-period comparison using pure UTC arithmetic
 */
const calculatePreviousPeriod = (startDateObj, endDateObj) => {
  const startUtc = typeof startDateObj === 'string' ? parseUtcDate(startDateObj) : startDateObj;
  const endUtc = typeof endDateObj === 'string' ? parseUtcDate(endDateObj) : endDateObj;

  const diffMs = endUtc.getTime() - startUtc.getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1;

  const prevEndUtc = new Date(startUtc.getTime() - 24 * 60 * 60 * 1000);
  const prevStartUtc = new Date(prevEndUtc.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  return {
    prevStartDateStr: formatUtcDate(prevStartUtc),
    prevEndDateStr: formatUtcDate(prevEndUtc),
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

  const { startDateStr, endDateStr, startDateObj, endDateObj } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    queryParams.rangePreset || queryParams.range
  );
  const { prevStartDateStr, prevEndDateStr } = calculatePreviousPeriod(startDateObj, endDateObj);

  // 1. Query Property-Level Aggregate Summary (No Dimensions)
  const summaryResult = await googleService.querySearchAnalytics(accessToken, property.siteUrl, {
    startDate: startDateStr,
    endDate: endDateStr,
  });

  const summaryRows = summaryResult.rows || [];
  const summaryRow = summaryRows.length > 0 ? summaryRows[0] : null;

  const currentSummary = summaryRow
    ? {
        clicks: summaryRow.clicks,
        impressions: summaryRow.impressions,
        ctr: summaryRow.ctr,
        position: summaryRow.position,
      }
    : null;

  // 2. Query Current Period Trend Series (Date Dimension)
  const trendResult = await googleService.querySearchAnalytics(accessToken, property.siteUrl, {
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: ['date'],
    rowLimit: 1000,
  });

  const trendRows = trendResult.rows || [];

  // 3. Query Previous Period Aggregate Summary for Comparison (No Dimensions)
  let previousSummary = null;
  let comparison = null;

  try {
    const prevSummaryResult = await googleService.querySearchAnalytics(accessToken, property.siteUrl, {
      startDate: prevStartDateStr,
      endDate: prevEndDateStr,
    });

    const prevRows = prevSummaryResult.rows || [];
    const prevRow = prevRows.length > 0 ? prevRows[0] : null;

    if (prevRow) {
      previousSummary = {
        clicks: prevRow.clicks,
        impressions: prevRow.impressions,
        ctr: prevRow.ctr,
        position: prevRow.position,
      };

      if (currentSummary) {
        const calcPctChange = (current, previous) => {
          if (previous === 0) return current > 0 ? 100 : 0;
          return Number((((current - previous) / previous) * 100).toFixed(2));
        };

        comparison = {
          clicksChangePct: calcPctChange(currentSummary.clicks, previousSummary.clicks),
          impressionsChangePct: calcPctChange(currentSummary.impressions, previousSummary.impressions),
          ctrChangeDiff: Number((currentSummary.ctr - previousSummary.ctr).toFixed(4)),
          positionChangeDiff: Number((currentSummary.position - previousSummary.position).toFixed(2)), // Note: Negative position difference indicates ranking improvement
        };
      }
    }
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
      clicks: currentSummary ? currentSummary.clicks : null,
      impressions: currentSummary ? currentSummary.impressions : null,
      ctr: currentSummary ? currentSummary.ctr : null,
      position: currentSummary ? currentSummary.position : null,
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

  const { startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    queryParams.rangePreset || queryParams.range
  );

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

/**
 * Parses YYYY-MM-DD string into a Date object using UTC midnight
 */
const parseUtcDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

/**
 * Formats a Date object into YYYY-MM-DD string using UTC values
 */
const formatUtcDate = (d) => {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Calculates aggregate summary metrics (clicks, impressions, ctr, position) from rows.
 * CTR is totalClicks / totalImpressions.
 * Position is impression-weighted average position.
 */
const calculateSummaryFromRows = (rows) => {
  let totalClicks = 0;
  let totalImpressions = 0;
  let weightedPositionSum = 0;

  for (const row of rows) {
    const clicks = typeof row.clicks === 'number' ? row.clicks : 0;
    const impressions = typeof row.impressions === 'number' ? row.impressions : 0;
    const position = typeof row.position === 'number' ? row.position : 0;

    totalClicks += clicks;
    totalImpressions += impressions;
    weightedPositionSum += position * impressions;
  }

  const ctr = totalImpressions > 0 ? Number((totalClicks / totalImpressions).toFixed(4)) : 0;
  const avgPosition = totalImpressions > 0 ? Number((weightedPositionSum / totalImpressions).toFixed(2)) : 0;

  return {
    clicks: totalClicks,
    impressions: totalImpressions,
    ctr: ctr,
    position: avgPosition,
  };
};

/**
 * Validates whether a given timezone string is a valid IANA timezone name.
 * Defaults to 'UTC' if unprovided.
 */
const validateTimezone = (tzStr) => {
  if (!tzStr) return 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tzStr });
    return tzStr;
  } catch (e) {
    const err = new Error(`Invalid timezone parameter: '${tzStr}' is not a valid IANA timezone string (e.g. "Asia/Kolkata", "UTC")`);
    err.statusCode = 400;
    throw err;
  }
};

/**
 * Converts wall-clock date (YYYY-MM-DD) and hour (0..23) in a specific IANA timezone (e.g., America/Los_Angeles)
 * into exact UTC epoch milliseconds.
 */
const wallClockToUtcMs = (dateStr, hourNum, timeZone = 'America/Los_Angeles') => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const hour = Number(hourNum);

  const baseUtc = Date.UTC(year, month - 1, day, hour, 0, 0);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = {};
  formatter.formatToParts(new Date(baseUtc)).forEach(({ type, value }) => {
    parts[type] = value;
  });

  let formattedHour = parseInt(parts.hour, 10);
  if (formattedHour === 24) formattedHour = 0;

  const formattedUtc = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    formattedHour,
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );

  const offsetMs = formattedUtc - baseUtc;
  return baseUtc - offsetMs;
};

/**
 * Formats an epoch UTC timestamp into wall-clock date (YYYY-MM-DD), hour (0..23), and ISO string in a target timezone.
 */
const getWallClockInTimeZone = (timestampMs, timeZone) => {
  const d = new Date(timestampMs);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = {};
  formatter.formatToParts(d).forEach(({ type, value }) => {
    parts[type] = value;
  });

  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;

  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date: dateStr,
    hour: hour,
    timestamp: d.toISOString(),
  };
};

/**
 * Formats epoch UTC timestamp into YYYY-MM-DD string in America/Los_Angeles timezone (Google Search Console API timezone)
 */
const formatPacificDate = (timestampMs) => {
  const d = new Date(timestampMs);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = {};
  formatter.formatToParts(d).forEach(({ type, value }) => {
    parts[type] = value;
  });
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/**
 * Dedicated rolling 24-hour performance comparison handler for granularity=hour.
 * Calculates rolling last 24 hours (current) vs previous 24 hours (comparison),
 * converting Pacific Time Google Search Console hourly API rows to user display timezone.
 */
const getRolling24HourPerformanceCompare = async (userId, queryParams = {}) => {
  const displayTimeZone = validateTimezone(queryParams.timezone);

  const nowMs = Date.now();
  const currentEndMs = Math.floor(nowMs / 3600000) * 3600000;
  const currentStartMs = currentEndMs - 23 * 3600000;

  const comparisonEndMs = currentStartMs - 3600000;
  const comparisonStartMs = comparisonEndMs - 23 * 3600000;

  const gscStartDateStr = formatPacificDate(comparisonStartMs);
  const gscEndDateStr = formatPacificDate(currentEndMs);

  const property = await verifyPropertyAccess(userId, queryParams.siteUrl);
  const accessToken = await googleService.getValidAccessToken(userId);

  const gscResult = await googleService.querySearchAnalytics(accessToken, property.siteUrl, {
    startDate: gscStartDateStr,
    endDate: gscEndDateStr,
    dimensions: ['hour'],
    dataState: 'hourly_all',
    rowLimit: 25000,
  });

  const rawRows = gscResult.rows || [];

  const gscRowsByTimestamp = new Map();
  for (const row of rawRows) {
    if (Array.isArray(row.keys) && row.keys.length > 0) {
      let utcMs = null;
      if (row.keys.length === 1 && String(row.keys[0]).includes('T')) {
        // ISO timestamp format returned by Google API when dimensions=['hour'] (e.g. '2026-09-30T04:00:00-07:00')
        utcMs = new Date(row.keys[0]).getTime();
      } else if (row.keys.length >= 2) {
        const dateKey = String(row.keys[0]).trim();
        const hourKey = String(row.keys[1]).trim();
        const hourNum = parseInt(hourKey, 10);
        if (dateKey && !isNaN(hourNum)) {
          utcMs = wallClockToUtcMs(dateKey, hourNum, 'America/Los_Angeles');
        }
      }

      if (utcMs !== null && !isNaN(utcMs)) {
        gscRowsByTimestamp.set(utcMs, row);
      }
    }
  }

  const currentRows = [];
  for (let i = 0; i < 24; i++) {
    const slotMs = currentStartMs + i * 3600000;
    const wallClock = getWallClockInTimeZone(slotMs, displayTimeZone);
    const matchedRow = gscRowsByTimestamp.get(slotMs);

    currentRows.push({
      date: wallClock.date,
      hour: wallClock.hour,
      timestamp: wallClock.timestamp,
      clicks: matchedRow ? matchedRow.clicks : 0,
      impressions: matchedRow ? matchedRow.impressions : 0,
      ctr: matchedRow ? matchedRow.ctr : 0,
      position: matchedRow ? matchedRow.position : 0,
    });
  }

  const comparisonRows = [];
  for (let i = 0; i < 24; i++) {
    const slotMs = comparisonStartMs + i * 3600000;
    const wallClock = getWallClockInTimeZone(slotMs, displayTimeZone);
    const matchedRow = gscRowsByTimestamp.get(slotMs);

    comparisonRows.push({
      date: wallClock.date,
      hour: wallClock.hour,
      timestamp: wallClock.timestamp,
      clicks: matchedRow ? matchedRow.clicks : 0,
      impressions: matchedRow ? matchedRow.impressions : 0,
      ctr: matchedRow ? matchedRow.ctr : 0,
      position: matchedRow ? matchedRow.position : 0,
    });
  }

  const currentSummary = calculateSummaryFromRows(currentRows);
  const comparisonSummary = calculateSummaryFromRows(comparisonRows);

  const { capabilities } = await getProperties(userId);

  const currentStartDate = currentRows[0].date;
  const currentEndDate = currentRows[23].date;
  const compStartDate = comparisonRows[0].date;
  const compEndDate = comparisonRows[23].date;
  const firstIncompleteHour = gscResult.metadata?.firstIncompleteHour || null;

  return {
    data: {
      property: {
        siteUrl: property.siteUrl,
        displayName: property.displayName,
        permissionLevel: property.permissionLevel,
        propertyType: property.propertyType,
      },
      current: {
        startDate: currentStartDate,
        endDate: currentEndDate,
        summary: currentSummary,
        rows: currentRows,
      },
      comparison: {
        startDate: compStartDate,
        endDate: compEndDate,
        summary: comparisonSummary,
        rows: comparisonRows,
      },
      comparisonType: 'previous_period',
      granularity: 'hour',
    },
    meta: {
      source: 'google_search_console',
      capabilities,
      timezone: displayTimeZone,
      dataState: 'hourly_all',
      firstIncompleteHour,
      requestedWindow: {
        start: new Date(currentStartMs).toISOString(),
        end: new Date(currentEndMs).toISOString(),
      },
    },
  };
};

/**
 * GET /api/google/insights/performance/compare
 * Dedicated Google Search Console performance comparison service method supporting:
 * - comparisonType: previous_period, year_over_year, custom
 * - granularity: date (daily), hour (24-hour hourly)
 */
const getPerformanceCompare = async (userId, queryParams = {}) => {
  // 1. Validate granularity
  const preset = (queryParams.rangePreset || queryParams.range || '').toLowerCase().trim();
  const is24hPreset = ['24h', '24_hours', '1d', '1_day'].includes(preset);
  const granularity = queryParams.granularity || (is24hPreset ? 'hour' : 'date');

  if (!['date', 'hour'].includes(granularity)) {
    const err = new Error('Invalid granularity: must be "date" or "hour"');
    err.statusCode = 400;
    throw err;
  }

  // Handle rolling 24-hour analytics path
  if (granularity === 'hour') {
    return await getRolling24HourPerformanceCompare(userId, queryParams);
  }

  // 2. Validate and normalize current date range
  const { startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    queryParams.rangePreset || queryParams.range
  );

  // 3. Validate comparisonType
  const comparisonType = queryParams.comparisonType || 'previous_period';
  if (!['previous_period', 'year_over_year', 'custom'].includes(comparisonType)) {
    const err = new Error('Invalid comparisonType: must be "previous_period", "year_over_year", or "custom"');
    err.statusCode = 400;
    throw err;
  }

  // 4. Calculate or validate comparison date range
  let compStartDateStr;
  let compEndDateStr;

  const startUtc = parseUtcDate(startDateStr);
  const endUtc = parseUtcDate(endDateStr);

  if (comparisonType === 'previous_period') {
    const diffMs = endUtc.getTime() - startUtc.getTime();
    const days = Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1;

    const prevEndUtc = new Date(startUtc.getTime() - 24 * 60 * 60 * 1000);
    const prevStartUtc = new Date(prevEndUtc.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    compStartDateStr = formatUtcDate(prevStartUtc);
    compEndDateStr = formatUtcDate(prevEndUtc);
  } else if (comparisonType === 'year_over_year') {
    const prevYearStartUtc = new Date(Date.UTC(startUtc.getUTCFullYear() - 1, startUtc.getUTCMonth(), startUtc.getUTCDate()));
    const prevYearEndUtc = new Date(Date.UTC(endUtc.getUTCFullYear() - 1, endUtc.getUTCMonth(), endUtc.getUTCDate()));

    compStartDateStr = formatUtcDate(prevYearStartUtc);
    compEndDateStr = formatUtcDate(prevYearEndUtc);
  } else if (comparisonType === 'custom') {
    if (!queryParams.comparisonStartDate || !queryParams.comparisonEndDate) {
      const err = new Error('Missing required query parameters for custom comparison: comparisonStartDate and comparisonEndDate are required');
      err.statusCode = 400;
      throw err;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(queryParams.comparisonStartDate) || !dateRegex.test(queryParams.comparisonEndDate)) {
      const err = new Error('Invalid date format for custom comparison: comparisonStartDate and comparisonEndDate must be valid dates in YYYY-MM-DD format');
      err.statusCode = 400;
      throw err;
    }

    const customStartUtc = parseUtcDate(queryParams.comparisonStartDate);
    const customEndUtc = parseUtcDate(queryParams.comparisonEndDate);

    if (isNaN(customStartUtc.getTime()) || isNaN(customEndUtc.getTime())) {
      const err = new Error('Invalid date values for custom comparison');
      err.statusCode = 400;
      throw err;
    }

    if (customStartUtc > customEndUtc) {
      const err = new Error('Invalid custom comparison date range: comparisonStartDate must be earlier than or equal to comparisonEndDate');
      err.statusCode = 400;
      throw err;
    }

    compStartDateStr = queryParams.comparisonStartDate;
    compEndDateStr = queryParams.comparisonEndDate;
  }

  // 5. Verify property access and obtain valid access token
  const property = await verifyPropertyAccess(userId, queryParams.siteUrl);
  const accessToken = await googleService.getValidAccessToken(userId);

  // 6. Query Search Analytics for Current Period
  const queryOptionsCurrent = {
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: ['date'],
    rowLimit: 25000,
  };

  const currentResult = await googleService.querySearchAnalytics(accessToken, property.siteUrl, queryOptionsCurrent);

  // 7. Query Search Analytics for Comparison Period
  const queryOptionsComparison = {
    startDate: compStartDateStr,
    endDate: compEndDateStr,
    dimensions: ['date'],
    rowLimit: 25000,
  };

  const comparisonResult = await googleService.querySearchAnalytics(accessToken, property.siteUrl, queryOptionsComparison);

  // 8. Format Rows
  const formatCompareRows = (rawRows) => {
    return (rawRows || []).map((row) => ({
      date: row.keys[0] || null,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }));
  };

  const currentRows = formatCompareRows(currentResult.rows);
  const comparisonRows = formatCompareRows(comparisonResult.rows);

  currentRows.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0));
  comparisonRows.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0));

  // 9. Calculate Aggregate Summaries from formatted rows
  const currentSummary = calculateSummaryFromRows(currentRows);
  const comparisonSummary = calculateSummaryFromRows(comparisonRows);

  const { capabilities } = await getProperties(userId);

  return {
    data: {
      property: {
        siteUrl: property.siteUrl,
        displayName: property.displayName,
        permissionLevel: property.permissionLevel,
        propertyType: property.propertyType,
      },
      current: {
        startDate: startDateStr,
        endDate: endDateStr,
        summary: currentSummary,
        rows: currentRows,
      },
      comparison: {
        startDate: compStartDateStr,
        endDate: compEndDateStr,
        summary: comparisonSummary,
        rows: comparisonRows,
      },
      comparisonType,
      granularity,
    },
    meta: {
      source: 'google_search_console',
      capabilities,
    },
  };
};

module.exports = {
  evaluateCapabilities,
  validateAndNormalizeDateRange,
  getProperties,
  verifyPropertyAccess,
  getOverview,
  getPerformance,
  getDimensionBreakdown,
  getPerformanceCompare,
};


