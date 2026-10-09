/**
 * Reason: Core Google Analytics 4 Data API service layer handling reporting queries, date range normalization,
 * period-over-period comparisons, property authorization verification, dynamic KPI metric resolution, and standardized response envelope formatting.
 * How: Reuses OAuth token management, calls GA4 Data API (analyticsdata.googleapis.com/v1beta), transforms raw GA4 metric/dimension rows,
 * and handles Google API error codes safely.
 */

const GoogleIntegration = require('../models/GoogleIntegration');
const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const googleService = require('./googleSearchConsoleService');
const googleAnalyticsAdminService = require('./googleAnalyticsAdminService');

const DATA_API_BASE_URL = 'https://analyticsdata.googleapis.com/v1beta';

/**
 * Explicit GA4 KPI Allowlist dictionary mapping friendly keys to official GA4 Data API metric names/expressions and formatting types.
 */
const ALLOWED_KPI_METRICS = {
  activeUsers: {
    key: 'activeUsers',
    label: 'Active users',
    gaMetric: { name: 'activeUsers' },
    type: 'INTEGER',
  },
  sessions: {
    key: 'sessions',
    label: 'Sessions',
    gaMetric: { name: 'sessions' },
    type: 'INTEGER',
  },
  engagementRate: {
    key: 'engagementRate',
    label: 'Engagement rate',
    gaMetric: { name: 'engagementRate' },
    type: 'PERCENTAGE',
  },
  screenPageViews: {
    key: 'screenPageViews',
    label: 'Views',
    gaMetric: { name: 'screenPageViews' },
    type: 'INTEGER',
  },
  views: {
    key: 'screenPageViews',
    label: 'Views',
    gaMetric: { name: 'screenPageViews' },
    type: 'INTEGER',
  },
  engagedSessions: {
    key: 'engagedSessions',
    label: 'Engaged sessions',
    gaMetric: { name: 'engagedSessions' },
    type: 'INTEGER',
  },
  eventCount: {
    key: 'eventCount',
    label: 'Event count',
    gaMetric: { name: 'eventCount' },
    type: 'INTEGER',
  },
  keyEvents: {
    key: 'keyEvents',
    label: 'Key events',
    gaMetric: { name: 'keyEvents' },
    type: 'INTEGER',
  },
  newUsers: {
    key: 'newUsers',
    label: 'New users',
    gaMetric: { name: 'newUsers' },
    type: 'INTEGER',
  },
  totalUsers: {
    key: 'totalUsers',
    label: 'Total users',
    gaMetric: { name: 'totalUsers' },
    type: 'INTEGER',
  },
  bounceRate: {
    key: 'bounceRate',
    label: 'Bounce rate',
    gaMetric: { name: 'bounceRate' },
    type: 'PERCENTAGE',
  },
  screenPageViewsPerUser: {
    key: 'screenPageViewsPerUser',
    label: 'Views per active user',
    gaMetric: { name: 'screenPageViewsPerUser' },
    type: 'FLOAT',
  },
  viewsPerActiveUser: {
    key: 'screenPageViewsPerUser',
    label: 'Views per active user',
    gaMetric: { name: 'screenPageViewsPerUser' },
    type: 'FLOAT',
  },
  averageEngagementTimePerActiveUser: {
    key: 'averageEngagementTimePerActiveUser',
    label: 'Average engagement time per active user',
    gaMetric: {
      name: 'averageEngagementTimePerUser',
      expression: 'userEngagementDuration/activeUsers',
    },
    type: 'DURATION',
  },
  averageEngagementTimePerUser: {
    key: 'averageEngagementTimePerActiveUser',
    label: 'Average engagement time per active user',
    gaMetric: {
      name: 'averageEngagementTimePerUser',
      expression: 'userEngagementDuration/activeUsers',
    },
    type: 'DURATION',
  },
  'userEngagementDuration/activeUsers': {
    key: 'averageEngagementTimePerActiveUser',
    label: 'Average engagement time per active user',
    gaMetric: {
      name: 'averageEngagementTimePerUser',
      expression: 'userEngagementDuration/activeUsers',
    },
    type: 'DURATION',
  },
  firstVisits: {
    key: 'firstVisits',
    label: 'First visits',
    isSpecialFirstVisits: true,
    gaMetric: { name: 'eventCount' },
    dimensions: [{ name: 'eventName' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: {
          matchType: 'EXACT',
          value: 'first_visit',
        },
      },
    },
    type: 'INTEGER',
  },
  first_visits: {
    key: 'firstVisits',
    label: 'First visits',
    isSpecialFirstVisits: true,
    gaMetric: { name: 'eventCount' },
    dimensions: [{ name: 'eventName' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: {
          matchType: 'EXACT',
          value: 'first_visit',
        },
      },
    },
    type: 'INTEGER',
  },
};

/**
 * Validates and resolves the target GA4 property for the user.
 * If propertyIdInput is provided, verifies that it belongs to the user and is active.
 * Otherwise, resolves the user's currently selected active GA4 property.
 */
const resolveSelectedProperty = async (userId, propertyIdInput = null) => {
  let targetProperty = null;

  if (propertyIdInput && String(propertyIdInput).trim()) {
    const cleanId = String(propertyIdInput).replace('properties/', '').trim();
    targetProperty = await GoogleAnalyticsProperty.findOne({ userId, propertyId: cleanId, isActive: true });

    if (!targetProperty) {
      const err = new Error(`Access denied: Google Analytics 4 property '${cleanId}' is not accessible by this account`);
      err.statusCode = 403;
      err.code = 'GA4_ACCESS_DENIED';
      throw err;
    }
  } else {
    targetProperty = await GoogleAnalyticsProperty.findOne({ userId, isSelected: true, isActive: true });

    if (!targetProperty) {
      // Fallback: check if user has any active property at all
      const anyProperty = await GoogleAnalyticsProperty.findOne({ userId, isActive: true });

      if (anyProperty) {
        anyProperty.isSelected = true;
        await anyProperty.save();
        targetProperty = anyProperty;
      } else {
        const err = new Error('No Google Analytics 4 property is selected for this account. Please select a property first.');
        err.statusCode = 400;
        err.code = 'NO_PROPERTY_SELECTED';
        throw err;
      }
    }
  }

  return targetProperty;
};

/**
 * Base Google Analytics Data API request wrapper with error normalization
 */
const fetchGA4DataApi = async (url, accessToken, options = {}) => {
  const reqHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: reqHeaders,
    });
  } catch (networkErr) {
    const err = new Error(`Google Analytics Data API network error: ${networkErr.message}`);
    err.statusCode = 502;
    err.code = 'GA4_API_ERROR';
    throw err;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const errorObj = data.error || {};
    const code = errorObj.code || response.status;
    const message = errorObj.message || 'Google Analytics Data API request failed';

    let statusCode = response.status >= 400 && response.status < 600 ? response.status : 500;
    let errCode = 'GA4_API_ERROR';

    if (code === 401) {
      statusCode = 401;
      errCode = 'TOKEN_EXPIRED';
    } else if (code === 403) {
      statusCode = 403;
      errCode = 'GA4_ACCESS_DENIED';
    } else if (code === 404) {
      statusCode = 404;
      errCode = 'PROPERTY_NOT_FOUND';
    } else if (code === 429) {
      statusCode = 429;
      errCode = 'GA4_RATE_LIMITED';
    } else if (code === 400) {
      statusCode = 400;
      errCode = message.toLowerCase().includes('date') ? 'INVALID_DATE_RANGE' : 'INCOMPATIBLE_METRIC_DIMENSION';
    }

    const err = new Error(`Google Analytics Data API error (${code}): ${message}`);
    err.statusCode = statusCode;
    err.code = errCode;
    err.googleError = errorObj;
    throw err;
  }

  return data;
};

const ga4ReportCache = new Map();
const ga4InFlightPromises = new Map();
const GA4_REPORT_CACHE_TTL_MS = 30000;

let activeGA4Requests = 0;
const MAX_CONCURRENT_GA4_REQUESTS = 5;
const ga4RequestQueue = [];

const enqueueGA4Request = (requestFn) => {
  return new Promise((resolve, reject) => {
    const task = async () => {
      activeGA4Requests++;
      try {
        const result = await requestFn();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        activeGA4Requests--;
        if (ga4RequestQueue.length > 0) {
          const nextTask = ga4RequestQueue.shift();
          nextTask();
        }
      }
    };

    if (activeGA4Requests < MAX_CONCURRENT_GA4_REQUESTS) {
      task();
    } else {
      ga4RequestQueue.push(task);
    }
  });
};

/**
 * Generic reusable runReport foundation calling GA4 Data API v1beta
 */
const runGA4Report = async ({
  accessToken,
  propertyId,
  dateRanges = [],
  dimensions = [],
  metrics = [],
  dimensionFilter = null,
  metricFilter = null,
  orderBys = [],
  limit = 1000,
  offset = 0,
  keepEmptyRows = false,
  skipCache = false,
}) => {
  const cleanPropertyId = String(propertyId).replace('properties/', '').trim();
  const cacheKey = `runReport:${cleanPropertyId}:${JSON.stringify({
    dateRanges,
    dimensions,
    metrics,
    dimensionFilter,
    metricFilter,
    orderBys,
    limit,
    offset,
    keepEmptyRows,
  })}`;

  const now = Date.now();

  // 1. Return cached response if within TTL
  if (!skipCache && ga4ReportCache.has(cacheKey)) {
    const cached = ga4ReportCache.get(cacheKey);
    if (now - cached.timestamp < GA4_REPORT_CACHE_TTL_MS) {
      return cached.data;
    }
    ga4ReportCache.delete(cacheKey);
  }

  // 2. Return in-flight promise if duplicate request is currently executing
  if (!skipCache && ga4InFlightPromises.has(cacheKey)) {
    return ga4InFlightPromises.get(cacheKey);
  }

  // 3. Create fresh execution promise throttled by concurrency queue
  const executeReportPromise = enqueueGA4Request(async () => {
    const url = `${DATA_API_BASE_URL}/properties/${cleanPropertyId}:runReport`;

    const requestBody = {
      dateRanges: dateRanges.map((d) => ({
        startDate: d.startDate,
        endDate: d.endDate,
        ...(d.name ? { name: d.name } : {}),
      })),
      dimensions: dimensions.map((d) => (typeof d === 'string' ? { name: d } : d)),
      metrics: metrics.map((m) => (typeof m === 'string' ? { name: m } : m)),
      ...(dimensionFilter ? { dimensionFilter } : {}),
      ...(metricFilter ? { metricFilter } : {}),
      ...(Array.isArray(orderBys) && orderBys.length > 0 ? { orderBys } : {}),
      limit: limit ? Math.min(parseInt(limit, 10), 100000) : 1000,
      offset: offset ? parseInt(offset, 10) : 0,
      keepEmptyRows: Boolean(keepEmptyRows),
      metricAggregations: ['TOTAL'],
    };

    const responseData = await fetchGA4DataApi(url, accessToken, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    const rawRows = Array.isArray(responseData.rows) ? responseData.rows : [];
    const dimensionHeaders = Array.isArray(responseData.dimensionHeaders)
      ? responseData.dimensionHeaders.map((h) => h.name)
      : [];
    const metricHeaders = Array.isArray(responseData.metricHeaders)
      ? responseData.metricHeaders.map((h) => ({ name: h.name, type: h.type }))
      : [];

    const normalizedRows = rawRows.map((row) => {
      const dimValues = (row.dimensionValues || []).map((v) => v.value);
      const metValues = (row.metricValues || []).map((v) => {
        const valStr = v.value;
        const num = Number(valStr);
        return isNaN(num) ? valStr : num;
      });

      return {
        dimensionValues: dimValues,
        metricValues: metValues,
      };
    });

    const normalizedTotals = Array.isArray(responseData.totals) && responseData.totals.length > 0
      ? (responseData.totals[0].metricValues || []).map((v) => {
          const valStr = v.value;
          const num = Number(valStr);
          return isNaN(num) ? valStr : num;
        })
      : null;

    const result = {
      rows: normalizedRows,
      dimensionHeaders,
      metricHeaders,
      rowCount: responseData.rowCount || normalizedRows.length,
      metadata: responseData.metadata || null,
      quota: responseData.quota || null,
      totals: normalizedTotals,
    };

    ga4ReportCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }).finally(() => {
    ga4InFlightPromises.delete(cacheKey);
  });

  ga4InFlightPromises.set(cacheKey, executeReportPromise);
  return executeReportPromise;
};

/**
 * Safely extracts a metric value from report result by looking up metricName in metricHeaders.
 * periodIndex: 0 for current period, 1 for comparison period.
 * Returns { hasValue: boolean, rawValue: number | null }
 */
const getMetricValueFromReport = (reportResult, periodIndex, targetMetricName) => {
  if (!reportResult || !Array.isArray(reportResult.rows) || reportResult.rows.length === 0) {
    return { hasValue: false, rawValue: null };
  }

  let row = null;
  const expectedName = periodIndex === 0 ? 'current_period' : 'previous_period';
  const expectedFallback = periodIndex === 0 ? 'date_range_0' : 'date_range_1';

  row = reportResult.rows.find((r) => {
    if (!r.dimensionValues || r.dimensionValues.length === 0) return false;
    return r.dimensionValues.includes(expectedName) || r.dimensionValues.includes(expectedFallback);
  });

  if (!row) {
    row = reportResult.rows[periodIndex];
  }

  if (!row || !Array.isArray(row.metricValues)) {
    return { hasValue: false, rawValue: null };
  }

  const headers = reportResult.metricHeaders || [];
  const cleanTarget = String(targetMetricName).replace(/\s+/g, '');

  const headerIdx = headers.findIndex((h) => {
    const nameStr = typeof h === 'string' ? h : h.name;
    const cleanHeader = String(nameStr).replace(/\s+/g, '');
    return cleanHeader === cleanTarget;
  });

  const targetIdx = headerIdx !== -1 ? headerIdx : (headers.length === 1 ? 0 : -1);

  if (targetIdx === -1 || targetIdx >= row.metricValues.length) {
    return { hasValue: false, rawValue: null };
  }

  const rawVal = row.metricValues[targetIdx];
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return { hasValue: false, rawValue: null };
  }

  const numVal = Number(rawVal);
  if (isNaN(numVal)) {
    return { hasValue: false, rawValue: null };
  }

  return { hasValue: true, rawValue: numVal };
};

/**
 * Safely searches across multiple batched report results for a target metric value.
 */
const getValueFromBatchResults = (batchResults, periodIndex, targetMetricName) => {
  if (!Array.isArray(batchResults)) return { hasValue: false, rawValue: null };
  const cleanTarget = String(targetMetricName).replace(/\s+/g, '');

  for (const reportResult of batchResults) {
    const headers = reportResult?.metricHeaders || [];
    const hasHeader = headers.some((h) => {
      const nameStr = typeof h === 'string' ? h : h.name;
      return String(nameStr).replace(/\s+/g, '') === cleanTarget;
    });

    if (hasHeader) {
      return getMetricValueFromReport(reportResult, periodIndex, targetMetricName);
    }
  }

  return { hasValue: false, rawValue: null };
};

/**
 * Formats YYYYMMDD string returned by GA4 into YYYY-MM-DD ISO date string
 */
const formatGA4DateString = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return dateStr;
  if (/^\d{8}$/.test(dateStr)) {
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  }
  return dateStr;
};

/**
 * Formats date components (year, month, day) into YYYY-MM-DD string
 */
const formatDateString = (year, month, day) => {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Returns date components in the selected timezone
 */
const getPropertyLocalDateComponents = (timeZone = 'UTC', dateObj = new Date()) => {
  let tz = timeZone || 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch (e) {
    tz = 'UTC';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(dateObj);
  const p = {};
  parts.forEach(({ type, value }) => { p[type] = value; });

  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[p.weekday] !== undefined ? weekdayMap[p.weekday] : 0;

  return {
    year: parseInt(p.year, 10),
    month: parseInt(p.month, 10),
    day: parseInt(p.day, 10),
    hour,
    minute: parseInt(p.minute, 10),
    dayOfWeek,
  };
};

/**
 * Adds offsetDays to (year, month, day) in calendar terms
 */
const addDays = (year, month, day, offsetDays) => {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dayOfWeek: d.getUTCDay(),
  };
};

/**
 * Parses YYYY-MM-DD string into component object { year, month, day }
 */
const parseDateStr = (str) => {
  const [year, month, day] = str.split('-').map(Number);
  return { year, month, day };
};

const VALID_DATE_PRESETS = [
  '24h', '24hours',
  '7d', '7days', 'last7days',
  '28d', '28days', 'last28days',
  '30d', '30days', 'last30days',
  '3m', '3months', '90d', '90days', 'last90days',
  'today',
  'yesterday',
  'thisweek',
  'lastweek',
  'thismonth',
  'lastmonth',
  'quartertodate', 'qtd',
  'thisyear',
  'lastcalendaryear', 'lastyear',
  'custom',
];

/**
 * Validates and normalizes date range inputs based on property timezone, supporting all 18 exact logical presets.
 */
const validateAndNormalizeDateRange = (startDateInput, endDateInput, rangePresetInput, propertyTimeZone = 'UTC') => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const localNow = getPropertyLocalDateComponents(propertyTimeZone, new Date());

  const todayStr = formatDateString(localNow.year, localNow.month, localNow.day);
  const yesterdayComp = addDays(localNow.year, localNow.month, localNow.day, -1);
  const yesterdayStr = formatDateString(yesterdayComp.year, yesterdayComp.month, yesterdayComp.day);

  let startDateStr;
  let endDateStr;
  let resolvedPreset = '28D';

  const rawPreset = rangePresetInput ? String(rangePresetInput).trim() : null;
  const normalizedPresetKey = rawPreset ? rawPreset.toLowerCase().replace(/[\s\-_]/g, '') : null;

  if (rawPreset && normalizedPresetKey !== 'custom') {
    if (!VALID_DATE_PRESETS.includes(normalizedPresetKey)) {
      const err = new Error(`Invalid date preset: '${rawPreset}'. Supported presets: 24H, 7D, 28D, 3M, Today, Yesterday, This week, Last 7 days, Last week, Last 28 days, Last 30 days, This month, Last month, Last 90 days, Quarter to date, This year, Last calendar year, Custom.`);
      err.statusCode = 400;
      err.code = 'INVALID_DATE_PRESET';
      throw err;
    }

    switch (normalizedPresetKey) {
      case '24h':
      case '24hours':
        resolvedPreset = '24H';
        startDateStr = yesterdayStr;
        endDateStr = todayStr;
        break;

      case 'today':
        resolvedPreset = 'Today';
        startDateStr = todayStr;
        endDateStr = todayStr;
        break;

      case 'yesterday':
        resolvedPreset = 'Yesterday';
        startDateStr = yesterdayStr;
        endDateStr = yesterdayStr;
        break;

      case '7d':
      case '7days':
      case 'last7days': {
        resolvedPreset = '7D';
        const maxEnd7 = yesterdayStr;
        endDateStr = endDateInput && dateRegex.test(endDateInput) ? (endDateInput > maxEnd7 ? maxEnd7 : endDateInput) : maxEnd7;
        const end7Comp = parseDateStr(endDateStr);
        const start7Comp = addDays(end7Comp.year, end7Comp.month, end7Comp.day, -6);
        startDateStr = formatDateString(start7Comp.year, start7Comp.month, start7Comp.day);
        break;
      }

      case '28d':
      case '28days':
      case 'last28days': {
        resolvedPreset = '28D';
        const maxEnd28 = yesterdayStr;
        endDateStr = endDateInput && dateRegex.test(endDateInput) ? (endDateInput > maxEnd28 ? maxEnd28 : endDateInput) : maxEnd28;
        const end28Comp = parseDateStr(endDateStr);
        const start28Comp = addDays(end28Comp.year, end28Comp.month, end28Comp.day, -27);
        startDateStr = formatDateString(start28Comp.year, start28Comp.month, start28Comp.day);
        break;
      }

      case '30d':
      case '30days':
      case 'last30days': {
        resolvedPreset = 'Last 30 days';
        const maxEnd30 = yesterdayStr;
        endDateStr = endDateInput && dateRegex.test(endDateInput) ? (endDateInput > maxEnd30 ? maxEnd30 : endDateInput) : maxEnd30;
        const end30Comp = parseDateStr(endDateStr);
        const start30Comp = addDays(end30Comp.year, end30Comp.month, end30Comp.day, -29);
        startDateStr = formatDateString(start30Comp.year, start30Comp.month, start30Comp.day);
        break;
      }

      case '3m':
      case '3months':
      case '90d':
      case '90days':
      case 'last90days': {
        resolvedPreset = '3M';
        const maxEnd90 = yesterdayStr;
        endDateStr = endDateInput && dateRegex.test(endDateInput) ? (endDateInput > maxEnd90 ? maxEnd90 : endDateInput) : maxEnd90;
        const end90Comp = parseDateStr(endDateStr);
        const start90Comp = addDays(end90Comp.year, end90Comp.month, end90Comp.day, -89);
        startDateStr = formatDateString(start90Comp.year, start90Comp.month, start90Comp.day);
        break;
      }

      case 'thisweek': {
        resolvedPreset = 'This week';
        const sundayComp = addDays(localNow.year, localNow.month, localNow.day, -localNow.dayOfWeek);
        startDateStr = formatDateString(sundayComp.year, sundayComp.month, sundayComp.day);
        const maxAllowedEnd = yesterdayStr >= startDateStr ? yesterdayStr : todayStr;
        endDateStr = endDateInput && dateRegex.test(endDateInput)
          ? (endDateInput > maxAllowedEnd ? maxAllowedEnd : endDateInput)
          : maxAllowedEnd;
        break;
      }

      case 'lastweek': {
        resolvedPreset = 'Last week';
        const prevSatComp = addDays(localNow.year, localNow.month, localNow.day, -localNow.dayOfWeek - 1);
        const prevSunComp = addDays(prevSatComp.year, prevSatComp.month, prevSatComp.day, -6);
        endDateStr = formatDateString(prevSatComp.year, prevSatComp.month, prevSatComp.day);
        startDateStr = formatDateString(prevSunComp.year, prevSunComp.month, prevSunComp.day);
        break;
      }

      case 'thismonth': {
        resolvedPreset = 'This month';
        startDateStr = formatDateString(localNow.year, localNow.month, 1);
        const maxAllowedEnd = yesterdayStr >= startDateStr ? yesterdayStr : todayStr;
        endDateStr = endDateInput && dateRegex.test(endDateInput)
          ? (endDateInput > maxAllowedEnd ? maxAllowedEnd : endDateInput)
          : maxAllowedEnd;
        break;
      }

      case 'lastmonth': {
        resolvedPreset = 'Last month';
        const prevMonth = localNow.month === 1 ? 12 : localNow.month - 1;
        const prevMonthYear = localNow.month === 1 ? localNow.year - 1 : localNow.year;
        const lastDayOfPrevMonth = new Date(Date.UTC(prevMonthYear, prevMonth, 0)).getUTCDate();
        startDateStr = formatDateString(prevMonthYear, prevMonth, 1);
        endDateStr = formatDateString(prevMonthYear, prevMonth, lastDayOfPrevMonth);
        break;
      }

      case 'quartertodate':
      case 'qtd': {
        resolvedPreset = 'Quarter to date';
        const qStartMonth = Math.floor((localNow.month - 1) / 3) * 3 + 1;
        startDateStr = formatDateString(localNow.year, qStartMonth, 1);
        const maxAllowedEnd = yesterdayStr >= startDateStr ? yesterdayStr : todayStr;
        endDateStr = endDateInput && dateRegex.test(endDateInput)
          ? (endDateInput > maxAllowedEnd ? maxAllowedEnd : endDateInput)
          : maxAllowedEnd;
        break;
      }

      case 'thisyear': {
        resolvedPreset = 'This year';
        startDateStr = formatDateString(localNow.year, 1, 1);
        const maxAllowedEnd = yesterdayStr >= startDateStr ? yesterdayStr : todayStr;
        endDateStr = endDateInput && dateRegex.test(endDateInput)
          ? (endDateInput > maxAllowedEnd ? maxAllowedEnd : endDateInput)
          : maxAllowedEnd;
        break;
      }

      case 'lastcalendaryear':
      case 'lastyear': {
        resolvedPreset = 'Last calendar year';
        const prevYr = localNow.year - 1;
        startDateStr = formatDateString(prevYr, 1, 1);
        endDateStr = formatDateString(prevYr, 12, 31);
        break;
      }

      default:
        resolvedPreset = '28D';
        endDateStr = yesterdayStr;
        const defComp = addDays(localNow.year, localNow.month, localNow.day, -27);
        startDateStr = formatDateString(defComp.year, defComp.month, defComp.day);
        break;
    }
  } else if (startDateInput && endDateInput) {
    resolvedPreset = 'Custom';
    if (!dateRegex.test(startDateInput) || !dateRegex.test(endDateInput)) {
      const err = new Error('Invalid custom date range: startDate and endDate must be valid dates in YYYY-MM-DD format');
      err.statusCode = 400;
      err.code = 'INVALID_DATE_RANGE';
      throw err;
    }
    startDateStr = startDateInput;
    endDateStr = endDateInput;
  } else {
    resolvedPreset = '28D';
    endDateStr = yesterdayStr;
    const defComp = addDays(localNow.year, localNow.month, localNow.day, -27);
    startDateStr = formatDateString(defComp.year, defComp.month, defComp.day);
  }

  if (startDateStr > endDateStr) {
    const err = new Error('Invalid date range: startDate must be earlier than or equal to endDate');
    err.statusCode = 400;
    err.code = 'INVALID_DATE_RANGE';
    throw err;
  }

  return {
    preset: resolvedPreset,
    startDateStr,
    endDateStr,
  };
};

/**
 * Calculates comparison date range based on comparisonType (previous_period, year_over_year, custom).
 * Aligns preceding period date comparison semantics with GA4 (day-of-week matching for multi-day ranges).
 */
const calculateComparisonDateRange = (startDateStr, endDateStr, comparisonType, customStart, customEnd) => {
  const startComp = parseDateStr(startDateStr);
  const endComp = parseDateStr(endDateStr);

  if (comparisonType === 'year_over_year') {
    return {
      compStartDateStr: formatDateString(startComp.year - 1, startComp.month, startComp.day),
      compEndDateStr: formatDateString(endComp.year - 1, endComp.month, endComp.day),
    };
  }

  if (comparisonType === 'custom') {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!customStart || !customEnd || !dateRegex.test(customStart) || !dateRegex.test(customEnd)) {
      const err = new Error('Invalid custom comparison date range: comparisonStartDate and comparisonEndDate are required in YYYY-MM-DD format');
      err.statusCode = 400;
      err.code = 'INVALID_DATE_RANGE';
      throw err;
    }
    return {
      compStartDateStr: customStart,
      compEndDateStr: customEnd,
    };
  }

  // Default: previous_period (day-of-week matched preceding period, aligned with GA4 date comparison semantics)
  const startUtc = new Date(Date.UTC(startComp.year, startComp.month - 1, startComp.day));
  const endUtc = new Date(Date.UTC(endComp.year, endComp.month - 1, endComp.day));
  const days = Math.round((endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  if (days <= 2) {
    const prevEndComp = addDays(startComp.year, startComp.month, startComp.day, -1);
    const prevStartComp = addDays(prevEndComp.year, prevEndComp.month, prevEndComp.day, -(days - 1));
    return {
      compStartDateStr: formatDateString(prevStartComp.year, prevStartComp.month, prevStartComp.day),
      compEndDateStr: formatDateString(prevEndComp.year, prevEndComp.month, prevEndComp.day),
    };
  }

  const shiftWeeks = Math.max(1, Math.round(days / 7));
  const shiftDays = shiftWeeks * 7;

  const prevStartComp = addDays(startComp.year, startComp.month, startComp.day, -shiftDays);
  const prevEndComp = addDays(endComp.year, endComp.month, endComp.day, -shiftDays);

  const res = {
    compStartDateStr: formatDateString(prevStartComp.year, prevStartComp.month, prevStartComp.day),
    compEndDateStr: formatDateString(prevEndComp.year, prevEndComp.month, prevEndComp.day),
  };

  console.log(`[GA4 COMPARISON DATE RESOLVER] Range: ${startDateStr} -> ${endDateStr} (${days} days) | Previous: ${res.compStartDateStr} -> ${res.compEndDateStr} (shifted ${shiftDays} days / ${shiftWeeks} weeks)`);

  return res;
};

/**
 * Calculates metric comparison structure ({ value, previous, changePct, changeDiff, comparisonStatus }) based on type.
 * Handles previous = 0 explicitly according to GA4 reporting rules.
 */
const calculateMetricComparison = (currentVal, previousVal, metricType = 'INTEGER') => {
  const curr = typeof currentVal === 'number' && !isNaN(currentVal) ? currentVal : 0;
  const prev = typeof previousVal === 'number' && !isNaN(previousVal) ? previousVal : 0;

  let value = curr;
  let previous = prev;

  if (metricType === 'INTEGER') {
    value = Math.round(curr);
    previous = Math.round(prev);
  } else if (metricType === 'PERCENTAGE' || metricType === 'FLOAT' || metricType === 'DURATION') {
    value = Number(curr.toFixed(4));
    previous = Number(prev.toFixed(4));
  }

  const changeDiff = Number((curr - prev).toFixed(4));

  let changePct = 0;
  let comparisonStatus = 'CALCULATED';

  if (prev === 0) {
    comparisonStatus = 'NO_PREVIOUS_BASE';
    if (curr === 0) {
      changePct = 0;
    } else {
      changePct = null;
    }
  } else {
    changePct = Number((((curr - prev) / prev) * 100).toFixed(2));
  }

  return {
    value,
    previous,
    changePct,
    changeDiff,
    comparisonStatus,
  };
};

/**
 * Formats a metric value according to its type (INTEGER, FLOAT, PERCENTAGE, DURATION)
 */
const formatMetricValue = (val, metricType = 'INTEGER') => {
  const num = typeof val === 'number' && !isNaN(val) ? val : 0;
  if (metricType === 'INTEGER') {
    return Math.round(num);
  }
  return Number(num.toFixed(4));
};

const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Resolves appropriate temporal trend granularity (hour, day, week, month)
 * based on preset and date range duration.
 */
const resolveTrendGranularity = (presetInput, startDateStr, endDateStr) => {
  const rawPreset = presetInput ? String(presetInput).trim() : '';
  const normalizedPresetKey = rawPreset.toLowerCase().replace(/[\s\-_]/g, '');

  if (normalizedPresetKey === '24h' || normalizedPresetKey === '24hours') {
    return 'hour';
  }

  if (
    normalizedPresetKey === 'thisyear' ||
    normalizedPresetKey === 'lastcalendaryear' ||
    normalizedPresetKey === 'lastyear'
  ) {
    return 'month';
  }

  // Calculate calendar days in resolved range
  if (startDateStr && endDateStr) {
    const startComp = parseDateStr(startDateStr);
    const endComp = parseDateStr(endDateStr);
    const startUtc = new Date(Date.UTC(startComp.year, startComp.month - 1, startComp.day));
    const endUtc = new Date(Date.UTC(endComp.year, endComp.month - 1, endComp.day));
    const days = Math.round((endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    if (days <= 30) {
      return 'day';
    } else {
      return 'week';
    }
  }

  return 'day';
};

/**
 * Calculates GA4 yearWeek string (YYYYWW) for a given Sunday date.
 * GA4 defines weeks as Sunday-starting (Sunday to Saturday).
 */
const getGA4YearWeek = (year, month, day) => {
  const targetDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = targetDate.getUTCDay(); // 0 = Sunday
  const sundayDate = new Date(Date.UTC(year, month - 1, day - dayOfWeek));

  const satDate = new Date(Date.UTC(sundayDate.getUTCFullYear(), sundayDate.getUTCMonth(), sundayDate.getUTCDate() + 6));
  const weekYear = satDate.getUTCFullYear();

  const jan1 = new Date(Date.UTC(weekYear, 0, 1));
  const jan1Sunday = new Date(Date.UTC(weekYear, 0, 1 - jan1.getUTCDay()));

  const diffMs = sundayDate.getTime() - jan1Sunday.getTime();
  const weekNum = Math.floor(diffMs / (7 * 24 * 3600 * 1000)) + 1;

  return `${weekYear}${String(weekNum).padStart(2, '0')}`;
};

/**
 * Generates structured bucket definitions and GA4 date ranges for current and comparison periods.
 */
const generateTrendBuckets = (
  startDateStr,
  endDateStr,
  granularity,
  isComparisonEnabled = false,
  comparisonType = 'previous_period',
  customCompStart = null,
  customCompEnd = null
) => {
  const startComp = parseDateStr(startDateStr);
  const endComp = parseDateStr(endDateStr);

  let trendDimension = 'date';
  let currentBuckets = [];
  let previousBuckets = [];
  let currentReportRange = { startDate: startDateStr, endDate: endDateStr };
  let previousReportRange = null;

  if (granularity === 'hour') {
    trendDimension = 'dateHour';
    const startDateObj = new Date(Date.UTC(startComp.year, startComp.month - 1, startComp.day));
    const endDateObj = new Date(Date.UTC(endComp.year, endComp.month - 1, endComp.day, 23));

    let curr = new Date(startDateObj.getTime());
    while (curr <= endDateObj) {
      const yyyy = curr.getUTCFullYear();
      const mm = String(curr.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(curr.getUTCDate()).padStart(2, '0');
      const hh = String(curr.getUTCHours()).padStart(2, '0');
      const monthName = MONTH_SHORT_NAMES[curr.getUTCMonth()];
      const dayNum = curr.getUTCDate();

      currentBuckets.push({
        key: `${yyyy}${mm}${dd}${hh}`,
        date: `${yyyy}-${mm}-${dd} ${hh}:00`,
        label: `${monthName} ${dayNum}, ${hh}:00`,
      });
      curr.setUTCHours(curr.getUTCHours() + 1);
    }

    if (isComparisonEnabled) {
      const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
        startDateStr,
        endDateStr,
        comparisonType,
        customCompStart,
        customCompEnd
      );
      previousReportRange = { startDate: compStartDateStr, endDate: compEndDateStr };

      const compStartParts = parseDateStr(compStartDateStr);
      const compEndParts = parseDateStr(compEndDateStr);
      const compStartObj = new Date(Date.UTC(compStartParts.year, compStartParts.month - 1, compStartParts.day));
      const compEndObj = new Date(Date.UTC(compEndParts.year, compEndParts.month - 1, compEndParts.day, 23));

      let currComp = new Date(compStartObj.getTime());
      while (currComp <= compEndObj) {
        const yyyy = currComp.getUTCFullYear();
        const mm = String(currComp.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(currComp.getUTCDate()).padStart(2, '0');
        const hh = String(currComp.getUTCHours()).padStart(2, '0');
        const monthName = MONTH_SHORT_NAMES[currComp.getUTCMonth()];
        const dayNum = currComp.getUTCDate();

        previousBuckets.push({
          key: `${yyyy}${mm}${dd}${hh}`,
          date: `${yyyy}-${mm}-${dd} ${hh}:00`,
          label: `${monthName} ${dayNum}, ${hh}:00`,
        });
        currComp.setUTCHours(currComp.getUTCHours() + 1);
      }
    }
  } else if (granularity === 'day') {
    trendDimension = 'date';
    let curr = new Date(Date.UTC(startComp.year, startComp.month - 1, startComp.day));
    const endUtc = new Date(Date.UTC(endComp.year, endComp.month - 1, endComp.day));

    while (curr <= endUtc) {
      const yyyy = curr.getUTCFullYear();
      const mm = String(curr.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(curr.getUTCDate()).padStart(2, '0');
      const monthName = MONTH_SHORT_NAMES[curr.getUTCMonth()];
      const dayNum = curr.getUTCDate();

      currentBuckets.push({
        key: `${yyyy}${mm}${dd}`,
        date: `${yyyy}-${mm}-${dd}`,
        label: `${monthName} ${dayNum}`,
      });
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    if (isComparisonEnabled) {
      const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
        startDateStr,
        endDateStr,
        comparisonType,
        customCompStart,
        customCompEnd
      );
      previousReportRange = { startDate: compStartDateStr, endDate: compEndDateStr };

      const compStartParts = parseDateStr(compStartDateStr);
      const compEndParts = parseDateStr(compEndDateStr);
      let currComp = new Date(Date.UTC(compStartParts.year, compStartParts.month - 1, compStartParts.day));
      const compEndUtc = new Date(Date.UTC(compEndParts.year, compEndParts.month - 1, compEndParts.day));

      while (currComp <= compEndUtc) {
        const yyyy = currComp.getUTCFullYear();
        const mm = String(currComp.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(currComp.getUTCDate()).padStart(2, '0');
        const monthName = MONTH_SHORT_NAMES[currComp.getUTCMonth()];
        const dayNum = currComp.getUTCDate();

        previousBuckets.push({
          key: `${yyyy}${mm}${dd}`,
          date: `${yyyy}-${mm}-${dd}`,
          label: `${monthName} ${dayNum}`,
        });
        currComp.setUTCDate(currComp.getUTCDate() + 1);
      }
    }
  } else if (granularity === 'week') {
    trendDimension = 'yearWeek';

    // Find Sunday on or before startDateStr
    const startUtcDate = new Date(Date.UTC(startComp.year, startComp.month - 1, startComp.day));
    const startDayOfWeek = startUtcDate.getUTCDay();
    const currentStartSunComp = addDays(startComp.year, startComp.month, startComp.day, -startDayOfWeek);

    // Find Saturday on or after endDateStr
    const endUtcDate = new Date(Date.UTC(endComp.year, endComp.month - 1, endComp.day));
    const endDayOfWeek = endUtcDate.getUTCDay();
    const currentEndSatComp = addDays(endComp.year, endComp.month, endComp.day, 6 - endDayOfWeek);

    currentReportRange = {
      startDate: formatDateString(currentStartSunComp.year, currentStartSunComp.month, currentStartSunComp.day),
      endDate: formatDateString(currentEndSatComp.year, currentEndSatComp.month, currentEndSatComp.day),
    };

    let currSun = { ...currentStartSunComp };
    const endSatUtc = new Date(Date.UTC(currentEndSatComp.year, currentEndSatComp.month - 1, currentEndSatComp.day));

    while (new Date(Date.UTC(currSun.year, currSun.month - 1, currSun.day)) <= endSatUtc) {
      const currSat = addDays(currSun.year, currSun.month, currSun.day, 6);
      const startStr = formatDateString(currSun.year, currSun.month, currSun.day);
      const endStr = formatDateString(currSat.year, currSat.month, currSat.day);

      const startMonthName = MONTH_SHORT_NAMES[currSun.month - 1];
      const endMonthName = MONTH_SHORT_NAMES[currSat.month - 1];
      const label = startMonthName === endMonthName
        ? `${startMonthName} ${currSun.day} – ${currSat.day}`
        : `${startMonthName} ${currSun.day} – ${endMonthName} ${currSat.day}`;

      const yearWeekKey = getGA4YearWeek(currSun.year, currSun.month, currSun.day);

      currentBuckets.push({
        key: yearWeekKey,
        date: startStr,
        endDate: endStr,
        label,
        sunYear: currSun.year,
        sunMonth: currSun.month,
        sunDay: currSun.day,
      });

      currSun = addDays(currSun.year, currSun.month, currSun.day, 7);
    }

    if (isComparisonEnabled) {
      // Calculate selected date range duration in calendar days
      const startUtc = new Date(Date.UTC(startComp.year, startComp.month - 1, startComp.day));
      const endUtc = new Date(Date.UTC(endComp.year, endComp.month - 1, endComp.day));
      const daysInRange = Math.round((endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      const shiftWeeks = Math.max(1, Math.round(daysInRange / 7));

      if (comparisonType === 'custom' && customCompStart) {
        const cStartComp = parseDateStr(customCompStart);
        const cStartUtcDate = new Date(Date.UTC(cStartComp.year, cStartComp.month - 1, cStartComp.day));
        const cStartDayOfWeek = cStartUtcDate.getUTCDay();
        const baseSunComp = addDays(cStartComp.year, cStartComp.month, cStartComp.day, -cStartDayOfWeek);

        currentBuckets.forEach((cBucket, index) => {
          const prevSun = addDays(baseSunComp.year, baseSunComp.month, baseSunComp.day, index * 7);
          const prevSat = addDays(prevSun.year, prevSun.month, prevSun.day, 6);
          const startStr = formatDateString(prevSun.year, prevSun.month, prevSun.day);
          const endStr = formatDateString(prevSat.year, prevSat.month, prevSat.day);

          const startMonthName = MONTH_SHORT_NAMES[prevSun.month - 1];
          const endMonthName = MONTH_SHORT_NAMES[prevSat.month - 1];
          const label = startMonthName === endMonthName
            ? `${startMonthName} ${prevSun.day} – ${prevSat.day}`
            : `${startMonthName} ${prevSun.day} – ${endMonthName} ${prevSat.day}`;

          const yearWeekKey = getGA4YearWeek(prevSun.year, prevSun.month, prevSun.day);

          previousBuckets.push({
            key: yearWeekKey,
            date: startStr,
            endDate: endStr,
            label,
          });
        });
      } else {
        // previous_period or year_over_year
        const daysShift = comparisonType === 'year_over_year' ? 364 : shiftWeeks * 7;

        currentBuckets.forEach((cBucket) => {
          const prevSun = addDays(cBucket.sunYear, cBucket.sunMonth, cBucket.sunDay, -daysShift);
          const prevSat = addDays(prevSun.year, prevSun.month, prevSun.day, 6);
          const startStr = formatDateString(prevSun.year, prevSun.month, prevSun.day);
          const endStr = formatDateString(prevSat.year, prevSat.month, prevSat.day);

          const startMonthName = MONTH_SHORT_NAMES[prevSun.month - 1];
          const endMonthName = MONTH_SHORT_NAMES[prevSat.month - 1];
          const label = startMonthName === endMonthName
            ? `${startMonthName} ${prevSun.day} – ${prevSat.day}`
            : `${startMonthName} ${prevSun.day} – ${endMonthName} ${prevSat.day}`;

          const yearWeekKey = getGA4YearWeek(prevSun.year, prevSun.month, prevSun.day);

          previousBuckets.push({
            key: yearWeekKey,
            date: startStr,
            endDate: endStr,
            label,
          });
        });
      }

      if (previousBuckets.length > 0) {
        previousReportRange = {
          startDate: previousBuckets[0].date,
          endDate: previousBuckets[previousBuckets.length - 1].endDate,
        };
      }
    }
  } else if (granularity === 'month') {
    trendDimension = 'yearMonth';

    let currYr = startComp.year;
    let currMo = startComp.month;

    currentReportRange = {
      startDate: formatDateString(startComp.year, startComp.month, 1),
      endDate: formatDateString(endComp.year, endComp.month, new Date(Date.UTC(endComp.year, endComp.month, 0)).getUTCDate()),
    };

    while (currYr < endComp.year || (currYr === endComp.year && currMo <= endComp.month)) {
      const startStr = formatDateString(currYr, currMo, 1);
      const lastDay = new Date(Date.UTC(currYr, currMo, 0)).getUTCDate();
      const endStr = formatDateString(currYr, currMo, lastDay);

      const monthName = MONTH_SHORT_NAMES[currMo - 1];
      const yearMonthKey = `${currYr}${String(currMo).padStart(2, '0')}`;

      currentBuckets.push({
        key: yearMonthKey,
        date: startStr,
        endDate: endStr,
        label: `${monthName} ${currYr}`,
      });

      currMo++;
      if (currMo > 12) {
        currMo = 1;
        currYr++;
      }
    }

    const M = currentBuckets.length;

    if (isComparisonEnabled) {
      let prevStartYr;
      let prevStartMo;

      if (comparisonType === 'year_over_year') {
        prevStartYr = startComp.year - 1;
        prevStartMo = startComp.month;
      } else if (comparisonType === 'custom' && customCompStart) {
        const cStartComp = parseDateStr(customCompStart);
        prevStartYr = cStartComp.year;
        prevStartMo = cStartComp.month;
      } else {
        // Default: previous_period (M months prior)
        let totalMonths = startComp.year * 12 + (startComp.month - 1) - M;
        prevStartYr = Math.floor(totalMonths / 12);
        prevStartMo = (totalMonths % 12) + 1;
      }

      let currPrevYr = prevStartYr;
      let currPrevMo = prevStartMo;

      for (let i = 0; i < M; i++) {
        const startStr = formatDateString(currPrevYr, currPrevMo, 1);
        const lastDay = new Date(Date.UTC(currPrevYr, currPrevMo, 0)).getUTCDate();
        const endStr = formatDateString(currPrevYr, currPrevMo, lastDay);

        const monthName = MONTH_SHORT_NAMES[currPrevMo - 1];
        const yearMonthKey = `${currPrevYr}${String(currPrevMo).padStart(2, '0')}`;

        previousBuckets.push({
          key: yearMonthKey,
          date: startStr,
          endDate: endStr,
          label: `${monthName} ${currPrevYr}`,
        });

        if (i === 0) {
          previousReportRange = { startDate: startStr, endDate: endStr };
        }
        if (i === M - 1) {
          previousReportRange.endDate = endStr;
        }

        currPrevMo++;
        if (currPrevMo > 12) {
          currPrevMo = 1;
          currPrevYr++;
        }
      }
    }
  }

  return {
    trendDimension,
    currentBuckets,
    previousBuckets,
    currentReportRange,
    previousReportRange,
  };
};

/**
 * Formats report result rows into normalized time-series points matching bucket definitions
 */
const formatTrendPointsWithBuckets = (reportResult, buckets, metricKey, metricType) => {
  const rowMap = new Map();

  if (reportResult && Array.isArray(reportResult.rows)) {
    reportResult.rows.forEach((row) => {
      const rawDimStr = (row.dimensionValues && row.dimensionValues[0]) || '';
      const cleanKey = String(rawDimStr).trim();

      const rawVal = row.metricValues && row.metricValues[0] !== undefined ? row.metricValues[0] : 0;
      const numVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : 0;
      rowMap.set(cleanKey, numVal);
    });
  }

  const points = buckets.map((bucket) => {
    let rawVal = 0;

    if (rowMap.has(bucket.key)) {
      rawVal = rowMap.get(bucket.key);
    }

    const formattedVal = formatMetricValue(rawVal, metricType);

    const point = {
      date: bucket.date,
      value: formattedVal,
      label: bucket.label,
      [metricKey]: formattedVal,
    };

    if (bucket.endDate) {
      point.endDate = bucket.endDate;
    }

    return point;
  });

  return points;
};

/**
 * Legacy daily/hourly generator retained for backwards compatibility
 */
const generateDateRangeList = (startDateStr, endDateStr, is24H) => {
  const list = [];
  if (!startDateStr || !endDateStr) return list;

  if (is24H) {
    const startComp = parseDateStr(startDateStr);
    const endComp = parseDateStr(endDateStr);
    const startDateObj = new Date(Date.UTC(startComp.year, startComp.month - 1, startComp.day));
    const endDateObj = new Date(Date.UTC(endComp.year, endComp.month - 1, endComp.day, 23));

    let curr = new Date(startDateObj.getTime());
    while (curr <= endDateObj) {
      const yyyy = curr.getUTCFullYear();
      const mm = String(curr.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(curr.getUTCDate()).padStart(2, '0');
      const hh = String(curr.getUTCHours()).padStart(2, '0');
      list.push(`${yyyy}-${mm}-${dd} ${hh}:00`);
      curr.setUTCHours(curr.getUTCHours() + 1);
    }
  } else {
    const startComp = parseDateStr(startDateStr);
    const endComp = parseDateStr(endDateStr);
    let curr = new Date(Date.UTC(startComp.year, startComp.month - 1, startComp.day));
    const endUtc = new Date(Date.UTC(endComp.year, endComp.month - 1, endComp.day));

    while (curr <= endUtc) {
      const yyyy = curr.getUTCFullYear();
      const mm = String(curr.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(curr.getUTCDate()).padStart(2, '0');
      list.push(`${yyyy}-${mm}-${dd}`);
      curr.setUTCDate(curr.getUTCDate() + 1);
    }
  }
  return list;
};

/**
 * GET /api/google/analytics/insights/overview
 * Executive summary supporting dynamic KPI selections, exact GA4 metrics, property reporting timezone date ranges, and hourly/daily/weekly/monthly trends.
 */
const getOverview = async (userId, queryParams = {}) => {
  // 1. Resolve selected property & verify user authorization
  const property = await resolveSelectedProperty(userId, queryParams.propertyId);

  // 2. Retrieve valid access token
  const accessToken = await googleService.getValidAccessToken(userId);

  // 3. Parse and validate requested KPI metrics
  let rawMetricsList = [];
  if (queryParams.metrics) {
    if (Array.isArray(queryParams.metrics)) {
      rawMetricsList = queryParams.metrics;
    } else if (typeof queryParams.metrics === 'string') {
      rawMetricsList = queryParams.metrics.split(',').map((s) => s.trim()).filter(Boolean);
    }
  } else if (queryParams.kpiMetrics) {
    rawMetricsList = Array.isArray(queryParams.kpiMetrics) ? queryParams.kpiMetrics : String(queryParams.kpiMetrics).split(',');
  } else if (queryParams.kpis) {
    rawMetricsList = Array.isArray(queryParams.kpis) ? queryParams.kpis : String(queryParams.kpis).split(',');
  }

  // If no metric list specified, default to all 13 supported KPI metrics
  if (rawMetricsList.length === 0) {
    rawMetricsList = [
      'activeUsers',
      'averageEngagementTimePerActiveUser',
      'engagedSessions',
      'engagementRate',
      'eventCount',
      'keyEvents',
      'newUsers',
      'sessions',
      'screenPageViews',
      'screenPageViewsPerUser',
      'firstVisits',
      'bounceRate',
      'totalUsers',
    ];
  }

  const resolvedKpis = [];
  for (const metricKey of rawMetricsList) {
    const keyTrimmed = String(metricKey).trim();
    const config = ALLOWED_KPI_METRICS[keyTrimmed];

    if (!config) {
      const err = new Error(`Unsupported KPI metric: '${keyTrimmed}'. Must be one of the supported GA4 metrics.`);
      err.statusCode = 400;
      err.code = 'UNSUPPORTED_KPI_METRIC';
      throw err;
    }

    // Deduplicate by normalized key
    if (!resolvedKpis.some((k) => k.key === config.key)) {
      resolvedKpis.push(config);
    }
  }

  // 4. Normalize date range with property timezone
  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    queryParams.rangePreset || queryParams.range,
    property.timeZone
  );

  // 5. Comparison range setup
  const comparisonType = (queryParams.comparisonType || 'previous_period').toLowerCase().trim();
  const isComparisonEnabled = comparisonType !== 'none';

  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
    startDateStr,
    endDateStr,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const summaryDateRanges = [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }];
  if (isComparisonEnabled) {
    summaryDateRanges.push({ startDate: compStartDateStr, endDate: compEndDateStr, name: 'previous_period' });
  }

  // 6. Partition requested metrics into standard GA4 metrics vs isolated firstVisits
  const standardKpiConfigs = resolvedKpis.filter((k) => !k.isSpecialFirstVisits);
  const firstVisitsConfig = resolvedKpis.find((k) => k.isSpecialFirstVisits);

  const standardGaMetrics = standardKpiConfigs.map((k) => k.gaMetric);

  // GA4 Data API allows max 10 metrics per runReport call.
  // Split standard metrics into chunks of max 10 metrics.
  const BATCH_SIZE = 10;
  const standardBatches = [];
  for (let i = 0; i < standardGaMetrics.length; i += BATCH_SIZE) {
    standardBatches.push(standardGaMetrics.slice(i, i + BATCH_SIZE));
  }

  const standardPromises = standardBatches.map((batchMetrics) =>
    runGA4Report({
      accessToken,
      propertyId: property.propertyId,
      dateRanges: summaryDateRanges,
      metrics: batchMetrics,
      keepEmptyRows: true,
    })
  );

  let firstVisitsPromise = null;
  if (firstVisitsConfig) {
    firstVisitsPromise = runGA4Report({
      accessToken,
      propertyId: property.propertyId,
      dateRanges: summaryDateRanges,
      dimensions: firstVisitsConfig.dimensions,
      metrics: [firstVisitsConfig.gaMetric],
      dimensionFilter: firstVisitsConfig.dimensionFilter,
      keepEmptyRows: true,
    });
  }

  const batchResults = await Promise.all(standardPromises);
  const firstVisitsResult = firstVisitsPromise ? await firstVisitsPromise : null;

  const hasAnyDataForProperty = batchResults.some(
    (res) => res && Array.isArray(res.rows) && res.rows.length > 0 && res.rows.some((r) => r.metricValues && r.metricValues.some((v) => Number(v) > 0))
  );

  // Build KPI Output lists & backward compatible metrics dictionary
  const kpisFormatted = [];
  const metricsFormatted = {};

  resolvedKpis.forEach((config) => {
    let currRes = { hasValue: false, rawValue: null };
    let prevRes = { hasValue: false, rawValue: null };

    if (config.isSpecialFirstVisits) {
      currRes = getMetricValueFromReport(firstVisitsResult, 0, 'eventCount');
      if (isComparisonEnabled) {
        prevRes = getMetricValueFromReport(firstVisitsResult, 1, 'eventCount');
      }

      // If property has overall activity in date range but 0 first_visit events, treat as numeric 0
      if (!currRes.hasValue && hasAnyDataForProperty) {
        currRes = { hasValue: true, rawValue: 0 };
      }
      if (isComparisonEnabled && !prevRes.hasValue && hasAnyDataForProperty) {
        prevRes = { hasValue: true, rawValue: 0 };
      }
    } else {
      const targetName = config.gaMetric.name;
      currRes = getValueFromBatchResults(batchResults, 0, targetName);
      if (isComparisonEnabled) {
        prevRes = getValueFromBatchResults(batchResults, 1, targetName);
      }
    }

    let formattedVal = null;
    let comparisonObj = null;

    if (currRes.hasValue) {
      formattedVal = formatMetricValue(currRes.rawValue, config.type);
      if (isComparisonEnabled && prevRes.hasValue) {
        comparisonObj = calculateMetricComparison(currRes.rawValue, prevRes.rawValue, config.type);
      } else if (isComparisonEnabled) {
        comparisonObj = calculateMetricComparison(currRes.rawValue, 0, config.type);
      }
    }

    kpisFormatted.push({
      key: config.key,
      label: config.label,
      value: formattedVal,
      type: config.type,
      status: currRes.hasValue ? 'AVAILABLE' : 'UNAVAILABLE',
      ...(isComparisonEnabled ? { comparison: comparisonObj } : {}),
    });

    metricsFormatted[config.key] = currRes.hasValue
      ? (isComparisonEnabled ? comparisonObj : { value: formattedVal })
      : { value: null, status: 'UNAVAILABLE' };
  });

  // 7. Execute Dynamic Trend Report for selected trendMetric with temporal granularity
  const rawTrendMetricKey = (queryParams.trendMetric || queryParams.metric || 'activeUsers').trim();
  const trendMetricConfig = ALLOWED_KPI_METRICS[rawTrendMetricKey];

  if (!trendMetricConfig) {
    const err = new Error(`Unsupported trend metric: '${rawTrendMetricKey}'. Must be one of the supported GA4 metrics.`);
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_TREND_METRIC';
    throw err;
  }

  const granularity = resolveTrendGranularity(preset, startDateStr, endDateStr);

  const {
    trendDimension,
    currentBuckets,
    previousBuckets,
    currentReportRange,
    previousReportRange,
  } = generateTrendBuckets(
    startDateStr,
    endDateStr,
    granularity,
    isComparisonEnabled,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const currentTrendPromise = runGA4Report({
    accessToken,
    propertyId: property.propertyId,
    dateRanges: [{ startDate: currentReportRange.startDate, endDate: currentReportRange.endDate, name: 'current_period' }],
    dimensions: trendMetricConfig.isSpecialFirstVisits
      ? [{ name: trendDimension }, { name: 'eventName' }]
      : [{ name: trendDimension }],
    metrics: [trendMetricConfig.gaMetric],
    ...(trendMetricConfig.dimensionFilter ? { dimensionFilter: trendMetricConfig.dimensionFilter } : {}),
    keepEmptyRows: true,
    limit: 1000,
  });

  let previousTrendPromise = null;
  if (isComparisonEnabled && previousReportRange) {
    previousTrendPromise = runGA4Report({
      accessToken,
      propertyId: property.propertyId,
      dateRanges: [{ startDate: previousReportRange.startDate, endDate: previousReportRange.endDate, name: 'previous_period' }],
      dimensions: trendMetricConfig.isSpecialFirstVisits
        ? [{ name: trendDimension }, { name: 'eventName' }]
        : [{ name: trendDimension }],
      metrics: [trendMetricConfig.gaMetric],
      ...(trendMetricConfig.dimensionFilter ? { dimensionFilter: trendMetricConfig.dimensionFilter } : {}),
      keepEmptyRows: true,
      limit: 1000,
    });
  }

  const [currentTrendResult, previousTrendResult] = await Promise.all([
    currentTrendPromise,
    previousTrendPromise,
  ]);

  const currentTrendPoints = formatTrendPointsWithBuckets(currentTrendResult, currentBuckets, trendMetricConfig.key, trendMetricConfig.type);
  const previousTrendPoints = isComparisonEnabled && previousReportRange
    ? formatTrendPointsWithBuckets(previousTrendResult, previousBuckets, trendMetricConfig.key, trendMetricConfig.type)
    : [];

  const integration = await GoogleIntegration.findOne({ userId });
  const capabilities = googleAnalyticsAdminService.evaluateCapabilities(integration, [property]);

  return {
    data: {
      property: {
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        displayName: property.displayName,
        timeZone: property.timeZone,
        currencyCode: property.currencyCode,
      },
      kpis: kpisFormatted,
      metrics: metricsFormatted,
      trend: {
        metric: trendMetricConfig.key,
        granularity,
        current: currentTrendPoints,
        previous: previousTrendPoints,
      },
    },
    meta: {
      source: 'google_analytics_4',
      dateRange: {
        preset,
        startDate: startDateStr,
        endDate: endDateStr,
      },
      comparison: {
        type: comparisonType,
        enabled: isComparisonEnabled,
        startDate: isComparisonEnabled ? compStartDateStr : null,
        endDate: isComparisonEnabled ? compEndDateStr : null,
      },
      capabilities,
      quota: batchResults[0]?.quota || firstVisitsResult?.quota || null,
    },
  };
};

/**
 * Helper to build allowlisted dimensionFilter for acquisition endpoints
 */
const buildAcquisitionDimensionFilter = (filterParams = {}, isFirstUser = false) => {
  const expressions = [];
  const prefix = isFirstUser ? 'firstUser' : 'session';
  const filterMap = {
    channel: `${prefix}DefaultChannelGroup`,
    source: `${prefix}Source`,
    medium: `${prefix}Medium`,
    campaign: `${prefix}CampaignName`,
  };

  Object.entries(filterMap).forEach(([paramKey, gaFieldName]) => {
    if (filterParams[paramKey] && String(filterParams[paramKey]).trim()) {
      expressions.push({
        filter: {
          fieldName: gaFieldName,
          stringFilter: {
            matchType: 'EXACT',
            value: String(filterParams[paramKey]).trim(),
          },
        },
      });
    }
  });

  if (expressions.length === 0) return null;
  if (expressions.length === 1) return expressions[0];
  return { andGroup: { expressions } };
};

/**
 * Registry of supported Traffic Acquisition metrics
 */
const TRAFFIC_ACQUISITION_METRICS = {
  sessions: { name: 'sessions', label: 'Sessions', type: 'INTEGER' },
  engagedsessions: { name: 'engagedSessions', label: 'Engaged sessions', type: 'INTEGER' },
  activeusers: { name: 'activeUsers', label: 'Active users', type: 'INTEGER' },
  totalusers: { name: 'totalUsers', label: 'Total users', type: 'INTEGER' },
  engagementrate: { name: 'engagementRate', label: 'Engagement rate', type: 'PERCENTAGE' },
  keyevents: { name: 'keyEvents', label: 'Key events', type: 'INTEGER' },
};

/**
 * Registry of supported Traffic Acquisition dimensions
 */
const TRAFFIC_ACQUISITION_DIMENSIONS = {
  // Session primary channel group
  sessionprimarychannelgroup: { gaDimension: 'sessionPrimaryChannelGroup', label: 'Session primary channel group (Default channel group)', key: 'sessionPrimaryChannelGroup' },
  primarychannel: { gaDimension: 'sessionPrimaryChannelGroup', label: 'Session primary channel group (Default channel group)', key: 'sessionPrimaryChannelGroup' },

  // Session default channel group
  sessiondefaultchannelgroup: { gaDimension: 'sessionDefaultChannelGroup', label: 'Session default channel group', key: 'sessionDefaultChannelGroup' },
  channel: { gaDimension: 'sessionDefaultChannelGroup', label: 'Session default channel group', key: 'sessionDefaultChannelGroup' },

  // Session medium
  sessionmedium: { gaDimension: 'sessionMedium', label: 'Session medium', key: 'sessionMedium' },
  medium: { gaDimension: 'sessionMedium', label: 'Session medium', key: 'sessionMedium' },

  // Session campaign
  sessioncampaignname: { gaDimension: 'sessionCampaignName', label: 'Session campaign', key: 'sessionCampaignName' },
  sessioncampaign: { gaDimension: 'sessionCampaignName', label: 'Session campaign', key: 'sessionCampaignName' },
  campaign: { gaDimension: 'sessionCampaignName', label: 'Session campaign', key: 'sessionCampaignName' },

  // Session source
  sessionsource: { gaDimension: 'sessionSource', label: 'Session source', key: 'sessionSource' },
  source: { gaDimension: 'sessionSource', label: 'Session source', key: 'sessionSource' },

  // Session source / medium
  sessionsourcomedium: { gaDimension: 'sessionSourceMedium', label: 'Session source / medium', key: 'sessionSourceMedium' },
  sourcomedium: { gaDimension: 'sessionSourceMedium', label: 'Session source / medium', key: 'sessionSourceMedium' },
  source_medium: { gaDimension: 'sessionSourceMedium', label: 'Session source / medium', key: 'sessionSourceMedium' },
};

const resolveAcquisitionMetricConfig = (metricInput) => {
  if (!metricInput || typeof metricInput !== 'string') {
    return TRAFFIC_ACQUISITION_METRICS.sessions;
  }
  const cleanKey = metricInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (TRAFFIC_ACQUISITION_METRICS[cleanKey]) {
    return TRAFFIC_ACQUISITION_METRICS[cleanKey];
  }
  const err = new Error(`Unsupported acquisition metric: '${metricInput}'. Supported metrics: sessions, engagedSessions, activeUsers, totalUsers, engagementRate, keyEvents.`);
  err.statusCode = 400;
  err.code = 'UNSUPPORTED_ACQUISITION_METRIC';
  throw err;
};

const resolveAcquisitionDimensionConfig = (dimensionInput) => {
  if (!dimensionInput || typeof dimensionInput !== 'string') {
    return TRAFFIC_ACQUISITION_DIMENSIONS.sessiondefaultchannelgroup;
  }
  const cleanKey = dimensionInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (TRAFFIC_ACQUISITION_DIMENSIONS[cleanKey]) {
    return TRAFFIC_ACQUISITION_DIMENSIONS[cleanKey];
  }
  const err = new Error(`Unsupported acquisition dimension: '${dimensionInput}'. Supported dimensions: sessionPrimaryChannelGroup, sessionDefaultChannelGroup, sessionMedium, sessionCampaignName, sessionSource.`);
  err.statusCode = 400;
  err.code = 'UNSUPPORTED_ACQUISITION_DIMENSION';
  throw err;
};

/**
 * GET /api/google/analytics/insights/acquisition
 * Session-level Traffic Acquisition reporting across Channels, Sources, Mediums, and Campaigns.
 */
const getTrafficAcquisition = async (userId, queryParams = {}) => {
  const property = await resolveSelectedProperty(userId, queryParams.propertyId);
  const accessToken = await googleService.getValidAccessToken(userId);

  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    queryParams.rangePreset || queryParams.range || '28D',
    property.timeZone
  );

  const comparisonType = (queryParams.comparisonType || 'previous_period').toLowerCase().trim();
  const isComparisonEnabled = comparisonType !== 'none';
  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
    startDateStr,
    endDateStr,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const rawDimension = queryParams.dimension || queryParams.dimensions || 'channel';
  const selectedDimConfig = resolveAcquisitionDimensionConfig(rawDimension);

  const rawMetricInput = queryParams.metric || queryParams.metrics || 'sessions';
  const primaryMetricConfig = resolveAcquisitionMetricConfig(Array.isArray(rawMetricInput) ? rawMetricInput[0] : rawMetricInput);

  const allAcquisitionMetrics = ['sessions', 'engagedSessions', 'activeUsers', 'totalUsers', 'engagementRate', 'keyEvents'];
  if (!allAcquisitionMetrics.includes(primaryMetricConfig.name)) {
    allAcquisitionMetrics.push(primaryMetricConfig.name);
  }

  const limit = Math.min(Math.max(1, parseInt(queryParams.limit || queryParams.rowLimit, 10) || 10), 100);
  const orderBys = [{ metric: { metricName: primaryMetricConfig.name }, desc: true }];
  const dimensionFilter = buildAcquisitionDimensionFilter(queryParams, false);

  let targetGaDimension = selectedDimConfig.gaDimension;
  let currentResult = null;

  try {
    currentResult = await runGA4Report({
      accessToken,
      propertyId: property.propertyId,
      dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
      dimensions: [targetGaDimension],
      metrics: allAcquisitionMetrics,
      dimensionFilter,
      orderBys,
      limit,
    });
  } catch (err) {
    if (selectedDimConfig.fallbackDimension && (err.statusCode === 400 || err.code === 'INCOMPATIBLE_METRIC_DIMENSION')) {
      targetGaDimension = selectedDimConfig.fallbackDimension;
      currentResult = await runGA4Report({
        accessToken,
        propertyId: property.propertyId,
        dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
        dimensions: [targetGaDimension],
        metrics: allAcquisitionMetrics,
        dimensionFilter,
        orderBys,
        limit,
      });
    } else {
      throw err;
    }
  }

  let compResult = null;
  let comparisonMap = new Map();
  if (isComparisonEnabled) {
    try {
      compResult = await runGA4Report({
        accessToken,
        propertyId: property.propertyId,
        dateRanges: [{ startDate: compStartDateStr, endDate: compEndDateStr, name: 'previous_period' }],
        dimensions: [targetGaDimension],
        metrics: allAcquisitionMetrics,
        dimensionFilter,
        limit: 1000,
      });

      (compResult.rows || []).forEach((row) => {
        const dimLabel = row.dimensionValues && row.dimensionValues[0] !== undefined ? String(row.dimensionValues[0]).trim() : '(not set)';
        comparisonMap.set(dimLabel, row.metricValues);
      });
    } catch (compErr) {
      comparisonMap = new Map();
    }
  }

  const primaryMetricIdx = allAcquisitionMetrics.indexOf(primaryMetricConfig.name);

  let currentTotalVal = 0;
  if (currentResult && Array.isArray(currentResult.totals) && currentResult.totals.length > primaryMetricIdx) {
    const rawVal = currentResult.totals[primaryMetricIdx];
    currentTotalVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
  } else if (currentResult && Array.isArray(currentResult.rows)) {
    currentTotalVal = currentResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[primaryMetricIdx]) || 0), 0);
  }

  let previousTotalVal = 0;
  if (isComparisonEnabled && compResult && Array.isArray(compResult.totals) && compResult.totals.length > primaryMetricIdx) {
    const rawVal = compResult.totals[primaryMetricIdx];
    previousTotalVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
  } else if (isComparisonEnabled && compResult && Array.isArray(compResult.rows)) {
    previousTotalVal = compResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[primaryMetricIdx]) || 0), 0);
  }

  const totalComparison = isComparisonEnabled
    ? calculateMetricComparison(currentTotalVal, previousTotalVal, primaryMetricConfig.type)
    : { value: formatMetricValue(currentTotalVal, primaryMetricConfig.type) };

  const currentRows = currentResult.rows || [];

  const formattedRows = currentRows.map((row) => {
    const dimLabel = row.dimensionValues && row.dimensionValues[0] !== undefined ? String(row.dimensionValues[0]).trim() : '(not set)';
    const prevValues = comparisonMap.get(dimLabel) || null;
    const currPrimaryVal = typeof row.metricValues[primaryMetricIdx] === 'number' ? row.metricValues[primaryMetricIdx] : 0;
    const prevPrimaryVal = prevValues && typeof prevValues[primaryMetricIdx] === 'number' ? prevValues[primaryMetricIdx] : 0;

    const rowMetrics = {};
    allAcquisitionMetrics.forEach((metricName, index) => {
      const currVal = typeof row.metricValues[index] === 'number' ? row.metricValues[index] : 0;
      const isRate = metricName === 'engagementRate' || metricName === 'bounceRate';

      if (isComparisonEnabled) {
        const prevVal = prevValues && typeof prevValues[index] === 'number' ? prevValues[index] : 0;
        rowMetrics[metricName] = calculateMetricComparison(currVal, prevVal, isRate ? 'PERCENTAGE' : 'INTEGER');
      } else {
        rowMetrics[metricName] = isRate ? Number(currVal.toFixed(4)) : (Number.isInteger(currVal) ? currVal : Number(currVal.toFixed(2)));
      }
    });

    const primaryComp = isComparisonEnabled
      ? calculateMetricComparison(currPrimaryVal, prevPrimaryVal, primaryMetricConfig.type)
      : null;

    return {
      dimension: dimLabel,
      dimensionValue: dimLabel,
      label: dimLabel,
      value: formatMetricValue(currPrimaryVal, primaryMetricConfig.type),
      current: formatMetricValue(currPrimaryVal, primaryMetricConfig.type),
      ...(isComparisonEnabled ? {
        previous: formatMetricValue(prevPrimaryVal, primaryMetricConfig.type),
        changePct: primaryComp.changePct,
        changeDiff: primaryComp.changeDiff,
        comparisonStatus: primaryComp.comparisonStatus,
      } : {}),
      metrics: rowMetrics,
    };
  });

  const integration = await GoogleIntegration.findOne({ userId });
  const capabilities = googleAnalyticsAdminService.evaluateCapabilities(integration, [property]);

  return {
    data: {
      property: {
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        displayName: property.displayName,
        timeZone: property.timeZone,
        currencyCode: property.currencyCode,
      },
      metric: primaryMetricConfig.name,
      metricLabel: primaryMetricConfig.label,
      dimension: selectedDimConfig.key,
      gaDimension: targetGaDimension,
      dimensionLabel: selectedDimConfig.label,
      dateRange: {
        preset,
        startDate: startDateStr,
        endDate: endDateStr,
      },
      ...(isComparisonEnabled ? {
        comparison: {
          type: comparisonType,
          enabled: isComparisonEnabled,
          startDate: compStartDateStr,
          endDate: compEndDateStr,
        }
      } : {}),
      total: formatMetricValue(currentTotalVal, primaryMetricConfig.type),
      ...(isComparisonEnabled ? { totalComparison } : {}),
      rows: formattedRows,
      count: formattedRows.length,
    },
    meta: {
      source: 'google_analytics_4',
      reportType: 'traffic_acquisition',
      dateRange: {
        preset,
        startDate: startDateStr,
        endDate: endDateStr,
      },
      comparison: {
        type: comparisonType,
        enabled: isComparisonEnabled,
        startDate: isComparisonEnabled ? compStartDateStr : null,
        endDate: isComparisonEnabled ? compEndDateStr : null,
      },
      capabilities,
      quota: currentResult.quota || null,
    },
  };
};

/**
 * GET /api/google/analytics/insights/user-acquisition
 * First-user acquisition level reporting across First-User Channels, Sources, Mediums, and Campaigns.
 */
const getUserAcquisition = async (userId, queryParams = {}) => {
  const property = await resolveSelectedProperty(userId, queryParams.propertyId);
  const accessToken = await googleService.getValidAccessToken(userId);

  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    queryParams.rangePreset || queryParams.range,
    property.timeZone
  );

  const comparisonType = (queryParams.comparisonType || 'none').toLowerCase().trim();
  const isComparisonEnabled = comparisonType !== 'none';
  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
    startDateStr,
    endDateStr,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const dimensionKey = (queryParams.dimension || queryParams.dimensions || 'channel').toLowerCase().trim();
  const dimensionAllowlist = {
    channel: { gaDimension: 'firstUserDefaultChannelGroup', label: 'First User Channel' },
    source: { gaDimension: 'firstUserSource', label: 'First User Source' },
    medium: { gaDimension: 'firstUserMedium', label: 'First User Medium' },
    source_medium: { gaDimension: 'firstUserSourceMedium', label: 'First User Source / Medium' },
    campaign: { gaDimension: 'firstUserCampaignName', label: 'First User Campaign' },
  };

  const selectedDimConfig = dimensionAllowlist[dimensionKey] || dimensionAllowlist.channel;

  const metrics = [
    'totalUsers',
    'newUsers',
    'sessions',
    'engagedSessions',
    'engagementRate',
    'keyEvents',
    'totalRevenue',
  ];

  const rawOrderBy = (queryParams.orderBy || 'totalUsers').trim();
  const validOrderMetric = metrics.includes(rawOrderBy) ? rawOrderBy : 'totalUsers';
  const orderBys = [{ metric: { metricName: validOrderMetric }, desc: true }];

  const limit = Math.min(Math.max(1, parseInt(queryParams.limit || queryParams.rowLimit, 10) || 50), 100);
  const dimensionFilter = buildAcquisitionDimensionFilter(queryParams, true);

  const currentResult = await runGA4Report({
    accessToken,
    propertyId: property.propertyId,
    dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
    dimensions: [selectedDimConfig.gaDimension],
    metrics,
    dimensionFilter,
    orderBys,
    limit,
  });

  const currentRows = currentResult.rows || [];

  let comparisonMap = new Map();
  if (isComparisonEnabled) {
    try {
      const compResult = await runGA4Report({
        accessToken,
        propertyId: property.propertyId,
        dateRanges: [{ startDate: compStartDateStr, endDate: compEndDateStr, name: 'previous_period' }],
        dimensions: [selectedDimConfig.gaDimension],
        metrics,
        dimensionFilter,
        limit: 1000,
      });

      (compResult.rows || []).forEach((row) => {
        const dimLabel = row.dimensionValues[0] || '(not set)';
        comparisonMap.set(dimLabel, row.metricValues);
      });
    } catch (compErr) {
      comparisonMap = new Map();
    }
  }

  const formattedRows = currentRows.map((row) => {
    const dimLabel = row.dimensionValues[0] || '(not set)';
    const prevValues = comparisonMap.get(dimLabel) || null;

    const rowMetrics = {};
    metrics.forEach((metricName, index) => {
      const currVal = typeof row.metricValues[index] === 'number' ? row.metricValues[index] : 0;
      const isRate = metricName === 'engagementRate' || metricName === 'bounceRate';

      if (isComparisonEnabled) {
        const prevVal = prevValues && typeof prevValues[index] === 'number' ? prevValues[index] : 0;
        rowMetrics[metricName] = calculateMetricComparison(currVal, prevVal, isRate ? 'PERCENTAGE' : 'INTEGER');
      } else {
        rowMetrics[metricName] = isRate ? Number(currVal.toFixed(4)) : (Number.isInteger(currVal) ? currVal : Number(currVal.toFixed(2)));
      }
    });

    return {
      label: dimLabel,
      metrics: rowMetrics,
    };
  });

  const integration = await GoogleIntegration.findOne({ userId });
  const capabilities = googleAnalyticsAdminService.evaluateCapabilities(integration, [property]);

  return {
    data: {
      property: {
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        displayName: property.displayName,
        timeZone: property.timeZone,
        currencyCode: property.currencyCode,
      },
      dimension: {
        key: dimensionKey,
        gaDimension: selectedDimConfig.gaDimension,
        label: selectedDimConfig.label,
      },
      rows: formattedRows,
      count: formattedRows.length,
    },
    meta: {
      source: 'google_analytics_4',
      reportType: 'user_acquisition',
      dateRange: {
        preset,
        startDate: startDateStr,
        endDate: endDateStr,
      },
      comparison: {
        type: comparisonType,
        enabled: isComparisonEnabled,
        startDate: isComparisonEnabled ? compStartDateStr : null,
        endDate: isComparisonEnabled ? compEndDateStr : null,
      },
      capabilities,
      quota: currentResult.quota || null,
    },
  };
};

/**
 * Registry of supported GA4 "Suggested for You" Cards
 */
const SUGGESTED_CARDS_REGISTRY = {
  'key-events-by-event': {
    key: 'key-events-by-event',
    aliases: ['key_events_by_event', 'keyEventsByEvent', 'key-events-event'],
    title: 'Key events by Event name',
    gaDimension: 'eventName',
    dimensionLabel: 'Event name',
    gaMetric: 'keyEvents',
    metricLabel: 'Key events',
    metricType: 'INTEGER',
    defaultPreset: '28D',
  },
  'new-users-by-channel': {
    key: 'new-users-by-channel',
    aliases: ['new_users_by_channel', 'newUsersByChannel', 'new-users-channel'],
    title: 'New users by First user primary channel group',
    gaDimension: 'firstUserPrimaryChannelGroup',
    dimensionLabel: 'First user primary channel group',
    gaMetric: 'newUsers',
    metricLabel: 'New users',
    metricType: 'INTEGER',
    defaultPreset: '28D',
  },
  'sessions-by-channel': {
    key: 'sessions-by-channel',
    aliases: [
      'sessions_by_channel',
      'sessionsByChannel',
      'sessions-by-session-primary-channel-group',
      'sessions_by_session_primary_channel_group',
      'sessionsBySessionPrimaryChannelGroup',
      'sessions-channel',
      'sessions-primary-channel-group',
    ],
    title: 'Sessions by Session primary channel group',
    gaDimension: 'sessionPrimaryChannelGroup',
    dimensionLabel: 'Session primary channel group',
    gaMetric: 'sessions',
    metricLabel: 'Sessions',
    metricType: 'INTEGER',
    defaultPreset: '28D',
    limit: 8,
  },
  'key-events-by-platform': {
    key: 'key-events-by-platform',
    aliases: ['key_events_by_platform', 'keyEventsByPlatform', 'key-events-platform'],
    title: 'Key events by Platform',
    gaDimension: 'platform',
    dimensionLabel: 'Platform',
    gaMetric: 'keyEvents',
    metricLabel: 'Key events',
    metricType: 'INTEGER',
    defaultPreset: '28D',
  },
  'active-users-by-country': {
    key: 'active-users-by-country',
    aliases: ['active_users_by_country', 'activeUsersByCountry', 'active-users-country'],
    title: 'Active users by Country',
    gaDimension: 'country',
    dimensionLabel: 'Country',
    gaMetric: 'activeUsers',
    metricLabel: 'Active users',
    metricType: 'INTEGER',
    defaultPreset: '28D',
  },
  'active-users-by-source-medium': {
    key: 'active-users-by-source-medium',
    aliases: ['active_users_by_source_medium', 'activeUsersBySourceMedium', 'active-users-source-medium'],
    title: 'Active users by First user source / medium',
    gaDimension: 'firstUserSourceMedium',
    dimensionLabel: 'First user source / medium',
    gaMetric: 'activeUsers',
    metricLabel: 'Active users',
    metricType: 'INTEGER',
    defaultPreset: '28D',
    limit: 8,
  },
  'views-by-page-title': {
    key: 'views-by-page-title',
    aliases: ['views_by_page_title', 'viewsByPageTitle', 'views-page-title'],
    title: 'Views by Page title and screen class',
    gaDimension: 'pageTitle',
    dimensionLabel: 'Page title and screen class',
    gaMetric: 'screenPageViews',
    metricLabel: 'Views',
    metricType: 'INTEGER',
    defaultPreset: '28D',
    limit: 8,
  },
  'active-users-by-city': {
    key: 'active-users-by-city',
    aliases: ['active_users_by_city', 'activeUsersByCity', 'active-users-city'],
    title: 'Active users by Town/City',
    gaDimension: 'city',
    dimensionLabel: 'Town/City',
    gaMetric: 'activeUsers',
    metricLabel: 'Active users',
    metricType: 'INTEGER',
    defaultPreset: '28D',
    limit: 8,
  },
};

/**
 * Resolves a card configuration by canonical key or friendly alias
 */
const resolveSuggestedCardConfig = (cardKeyInput) => {
  if (!cardKeyInput || typeof cardKeyInput !== 'string') return null;
  const cleanInput = cardKeyInput.trim();
  const lowerInput = cleanInput.toLowerCase().replace(/[\s\-_]/g, '');

  for (const cardConfig of Object.values(SUGGESTED_CARDS_REGISTRY)) {
    const cardKeyNormalized = cardConfig.key.toLowerCase().replace(/[\s\-_]/g, '');
    if (cardKeyNormalized === lowerInput) return cardConfig;

    if (Array.isArray(cardConfig.aliases)) {
      for (const alias of cardConfig.aliases) {
        if (alias.toLowerCase().replace(/[\s\-_]/g, '') === lowerInput) return cardConfig;
      }
    }
  }

  return null;
};

/**
 * Country card metric dictionary & resolver
 */
const COUNTRY_CARD_METRICS = {
  activeusers: { name: 'activeUsers', label: 'Active users', gaMetric: 'activeUsers', dimensionFilter: null },
  newusers: { name: 'newUsers', label: 'New users', gaMetric: 'newUsers', dimensionFilter: null },
  returningusers: {
    name: 'returningUsers',
    label: 'Returning users',
    gaMetric: 'activeUsers',
    dimensionFilter: {
      filter: {
        fieldName: 'newVsReturning',
        stringFilter: { value: 'returning' },
      },
    },
  },
};

const COUNTRY_CARD_DIMENSIONS = {
  countryid: { key: 'countryId', label: 'Country ID', gaDimension: 'countryId' },
  countrycode: { key: 'countryId', label: 'Country ID', gaDimension: 'countryId' },
  country: { key: 'country', label: 'Country', gaDimension: 'country' },
  countryname: { key: 'country', label: 'Country', gaDimension: 'country' },
};

const resolveCountryMetricConfig = (metricInput) => {
  if (!metricInput || typeof metricInput !== 'string') {
    return COUNTRY_CARD_METRICS.activeusers;
  }
  const cleanKey = metricInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (COUNTRY_CARD_METRICS[cleanKey]) {
    return COUNTRY_CARD_METRICS[cleanKey];
  }
  const err = new Error(`Unsupported country metric: '${metricInput}'. Supported metrics: activeUsers, newUsers, returningUsers.`);
  err.statusCode = 400;
  err.code = 'UNSUPPORTED_COUNTRY_METRIC';
  throw err;
};

const resolveCountryDimensionConfig = (dimensionInput) => {
  if (!dimensionInput || typeof dimensionInput !== 'string') {
    return COUNTRY_CARD_DIMENSIONS.country;
  }
  const cleanKey = dimensionInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (COUNTRY_CARD_DIMENSIONS[cleanKey]) {
    return COUNTRY_CARD_DIMENSIONS[cleanKey];
  }
  const err = new Error(`Unsupported country dimension: '${dimensionInput}'. Supported dimensions: countryId, country.`);
  err.statusCode = 400;
  err.code = 'UNSUPPORTED_COUNTRY_DIMENSION';
  throw err;
};

/**
 * Dedicated reporter for "Active users by Country" Suggested Card with metric/dimension selection & comparison.
 */
const fetchCountryCardData = async (userId, cardConfig, queryParams = {}, options = {}) => {
  const property = options.property || (await resolveSelectedProperty(userId, queryParams.propertyId));
  const accessToken = options.accessToken || (await googleService.getValidAccessToken(userId));

  const rawPresetInput =
    queryParams.preset ||
    queryParams.datePreset ||
    queryParams.rangePreset ||
    queryParams.range ||
    (cardConfig ? cardConfig.defaultPreset : '28D');

  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    rawPresetInput,
    property.timeZone
  );

  const comparisonType = (queryParams.comparisonType || 'previous_period').toLowerCase().trim();
  const isComparisonEnabled = comparisonType !== 'none';
  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
    startDateStr,
    endDateStr,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const metricInput = queryParams.metric || queryParams.metrics;
  const metricConfig = resolveCountryMetricConfig(metricInput);

  const dimensionInput = queryParams.dimension || queryParams.dimensions;
  const dimConfig = resolveCountryDimensionConfig(dimensionInput);

  const limit = queryParams.limit ? Math.min(Math.max(parseInt(queryParams.limit, 10), 1), 7) : 7;

  const currentReportPromise = runGA4Report({
    accessToken,
    propertyId: property.propertyId,
    dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
    dimensions: [{ name: dimConfig.gaDimension }],
    metrics: [{ name: metricConfig.gaMetric }],
    dimensionFilter: metricConfig.dimensionFilter,
    orderBys: [
      {
        metric: { metricName: metricConfig.gaMetric },
        desc: true,
      },
    ],
    limit: 1000,
    keepEmptyRows: false,
  }).catch((err) => {
    if (err.statusCode === 400 || err.code === 'INCOMPATIBLE_METRIC_DIMENSION') {
      return { rows: [] };
    }
    throw err;
  });

  const compReportPromise = isComparisonEnabled
    ? runGA4Report({
        accessToken,
        propertyId: property.propertyId,
        dateRanges: [{ startDate: compStartDateStr, endDate: compEndDateStr, name: 'previous_period' }],
        dimensions: [{ name: dimConfig.gaDimension }],
        metrics: [{ name: metricConfig.gaMetric }],
        dimensionFilter: metricConfig.dimensionFilter,
        limit: 1000,
        keepEmptyRows: false,
      }).catch(() => ({ rows: [] }))
    : Promise.resolve({ rows: [] });

  const [reportResult, compResult] = await Promise.all([
    currentReportPromise,
    compReportPromise,
  ]);

  const comparisonMap = new Map();
  if (isComparisonEnabled && compResult && Array.isArray(compResult.rows)) {
    compResult.rows.forEach((row) => {
      const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '';
      const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
      const numVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
      if (dimVal) {
        comparisonMap.set(dimVal, numVal);
      }
    });
  }

  const totalCurrent = (reportResult && Array.isArray(reportResult.totals) && reportResult.totals.length > 0)
    ? Number(reportResult.totals[0]) || 0
    : ((reportResult && Array.isArray(reportResult.rows))
        ? reportResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalPrevious = (compResult && Array.isArray(compResult.totals) && compResult.totals.length > 0)
    ? Number(compResult.totals[0]) || 0
    : ((compResult && Array.isArray(compResult.rows))
        ? compResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalComp = isComparisonEnabled
    ? calculateMetricComparison(totalCurrent, totalPrevious, 'INTEGER')
    : null;

  const isInvalidCountry = (c) => !c || String(c).trim() === '' || String(c).trim().toLowerCase() === '(not set)';

  const rawRows = (reportResult && Array.isArray(reportResult.rows)) ? reportResult.rows : [];

  // Filter out (not set) and blank values ONLY from displayed country rows
  const validRows = rawRows.filter((row) => {
    const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '';
    return !isInvalidCountry(dimVal);
  });

  // Top 7 valid country rows
  const top7ValidRows = validRows.slice(0, limit);

  const rows = top7ValidRows.map((row) => {
    const dimVal = String(row.dimensionValues[0]).trim();
    const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
    const currentVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
    const previousVal = comparisonMap.get(dimVal) || 0;

    const comp = calculateMetricComparison(currentVal, previousVal, 'INTEGER');

    return {
      dimensionValue: dimVal,
      dimensionLabel: dimVal,
      current: currentVal,
      previous: previousVal,
      changePct: comp.changePct,
      changeDiff: comp.changeDiff,
      comparisonStatus: comp.comparisonStatus,
    };
  });

  return {
    card: cardConfig ? cardConfig.key : 'active-users-by-country',
    title: cardConfig ? cardConfig.title : 'Active users by Country',
    dimension: dimConfig.key,
    dimensionLabel: dimConfig.label,
    gaDimension: dimConfig.gaDimension,
    metric: metricConfig.name,
    metricLabel: metricConfig.label,
    gaMetric: metricConfig.gaMetric,
    dateRange: {
      preset,
      startDate: startDateStr,
      endDate: endDateStr,
    },
    comparison: {
      type: comparisonType,
      enabled: isComparisonEnabled,
      startDate: isComparisonEnabled ? compStartDateStr : null,
      endDate: isComparisonEnabled ? compEndDateStr : null,
    },
    total: totalCurrent,
    totalComparison: isComparisonEnabled ? {
      current: totalCurrent,
      previous: totalPrevious,
      changePct: totalComp.changePct,
      changeDiff: totalComp.changeDiff,
      comparisonStatus: totalComp.comparisonStatus,
    } : null,
    rows,
  };
};

/**
 * Platform card metric dictionary & resolver for "Key events by Platform"
 */
const PLATFORM_CARD_METRICS = {
  keyevents: { name: 'keyEvents', label: 'Key events', gaMetric: 'keyEvents', metricType: 'INTEGER' },
  key_events: { name: 'keyEvents', label: 'Key events', gaMetric: 'keyEvents', metricType: 'INTEGER' },
  totalrevenue: { name: 'totalRevenue', label: 'Total revenue', gaMetric: 'totalRevenue', metricType: 'CURRENCY' },
  total_revenue: { name: 'totalRevenue', label: 'Total revenue', gaMetric: 'totalRevenue', metricType: 'CURRENCY' },
  revenue: { name: 'totalRevenue', label: 'Total revenue', gaMetric: 'totalRevenue', metricType: 'CURRENCY' },
  eventcount: { name: 'eventCount', label: 'Event count', gaMetric: 'eventCount', metricType: 'INTEGER' },
  event_count: { name: 'eventCount', label: 'Event count', gaMetric: 'eventCount', metricType: 'INTEGER' },
};

const resolvePlatformMetricConfig = (metricInput) => {
  if (!metricInput || typeof metricInput !== 'string') {
    return PLATFORM_CARD_METRICS.keyevents;
  }
  const cleanKey = metricInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (PLATFORM_CARD_METRICS[cleanKey]) {
    return PLATFORM_CARD_METRICS[cleanKey];
  }
  const err = new Error(`Unsupported platform card metric: '${metricInput}'. Supported metrics: keyEvents, totalRevenue, eventCount.`);
  err.statusCode = 400;
  err.code = 'UNSUPPORTED_PLATFORM_METRIC';
  throw err;
};

const resolvePlatformDimensionConfig = (dimensionInput) => {
  if (!dimensionInput || typeof dimensionInput !== 'string') {
    return { key: 'platform', label: 'Platform', gaDimension: 'platform' };
  }
  const cleanKey = dimensionInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanKey === 'platform') {
    return { key: 'platform', label: 'Platform', gaDimension: 'platform' };
  }
  const err = new Error(`Unsupported platform card dimension: '${dimensionInput}'. Supported dimension: platform.`);
  err.statusCode = 400;
  err.code = 'UNSUPPORTED_PLATFORM_DIMENSION';
  throw err;
};

/**
 * Dedicated reporter for "Key events by Platform" Suggested Card
 */
const fetchPlatformCardData = async (userId, cardConfig, queryParams = {}, options = {}) => {
  const property = options.property || (await resolveSelectedProperty(userId, queryParams.propertyId));
  const accessToken = options.accessToken || (await googleService.getValidAccessToken(userId));

  const rawPresetInput =
    queryParams.preset ||
    queryParams.datePreset ||
    queryParams.rangePreset ||
    queryParams.range ||
    (cardConfig ? cardConfig.defaultPreset : '28D');

  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    rawPresetInput,
    property.timeZone
  );

  const comparisonType = (queryParams.comparisonType || 'previous_period').toLowerCase().trim();
  const isComparisonEnabled = comparisonType !== 'none';
  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
    startDateStr,
    endDateStr,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const metricInput = queryParams.metric || queryParams.metrics;
  const metricConfig = resolvePlatformMetricConfig(metricInput);

  const dimensionInput = queryParams.dimension || queryParams.dimensions;
  const dimConfig = resolvePlatformDimensionConfig(dimensionInput);

  const currentReportPromise = runGA4Report({
    accessToken,
    propertyId: property.propertyId,
    dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
    dimensions: [{ name: dimConfig.gaDimension }],
    metrics: [{ name: metricConfig.gaMetric }],
    orderBys: [
      {
        metric: { metricName: metricConfig.gaMetric },
        desc: true,
      },
    ],
    limit: 100,
    keepEmptyRows: false,
  }).catch((err) => {
    if (err.statusCode === 400 || err.code === 'INCOMPATIBLE_METRIC_DIMENSION') {
      return { rows: [] };
    }
    throw err;
  });

  const compReportPromise = isComparisonEnabled
    ? runGA4Report({
        accessToken,
        propertyId: property.propertyId,
        dateRanges: [{ startDate: compStartDateStr, endDate: compEndDateStr, name: 'previous_period' }],
        dimensions: [{ name: dimConfig.gaDimension }],
        metrics: [{ name: metricConfig.gaMetric }],
        limit: 1000,
        keepEmptyRows: false,
      }).catch(() => ({ rows: [] }))
    : Promise.resolve({ rows: [] });

  const [reportResult, compResult] = await Promise.all([
    currentReportPromise,
    compReportPromise,
  ]);

  const comparisonMap = new Map();
  if (isComparisonEnabled && compResult && Array.isArray(compResult.rows)) {
    compResult.rows.forEach((row) => {
      const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '(not set)';
      const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
      const numVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
      comparisonMap.set(dimVal, numVal);
    });
  }

  const totalCurrent = (reportResult && Array.isArray(reportResult.totals) && reportResult.totals.length > 0)
    ? Number(reportResult.totals[0]) || 0
    : ((reportResult && Array.isArray(reportResult.rows))
        ? reportResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalPrevious = (compResult && Array.isArray(compResult.totals) && compResult.totals.length > 0)
    ? Number(compResult.totals[0]) || 0
    : ((compResult && Array.isArray(compResult.rows))
        ? compResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalComp = isComparisonEnabled
    ? calculateMetricComparison(totalCurrent, totalPrevious, metricConfig.metricType || 'INTEGER')
    : null;

  const rows = [];
  if (reportResult && Array.isArray(reportResult.rows)) {
    reportResult.rows.forEach((row) => {
      const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '(not set)';
      const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
      const currentVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
      const previousVal = comparisonMap.get(dimVal) || 0;

      const comp = calculateMetricComparison(currentVal, previousVal, metricConfig.metricType || 'INTEGER');

      rows.push({
        dimensionValue: dimVal,
        dimensionLabel: dimVal,
        platform: dimVal,
        value: currentVal,
        current: currentVal,
        previous: previousVal,
        changePct: comp.changePct,
        changeDiff: comp.changeDiff,
        comparisonStatus: comp.comparisonStatus,
      });
    });
  }

  return {
    card: cardConfig ? cardConfig.key : 'key-events-by-platform',
    title: cardConfig ? cardConfig.title : 'Key events by Platform',
    dimension: dimConfig.key,
    dimensionLabel: dimConfig.label,
    gaDimension: dimConfig.gaDimension,
    metric: metricConfig.name,
    metricLabel: metricConfig.label,
    gaMetric: metricConfig.gaMetric,
    dateRange: {
      preset,
      startDate: startDateStr,
      endDate: endDateStr,
    },
    comparison: {
      type: comparisonType,
      enabled: isComparisonEnabled,
      startDate: isComparisonEnabled ? compStartDateStr : null,
      endDate: isComparisonEnabled ? compEndDateStr : null,
    },
    total: totalCurrent,
    totalComparison: isComparisonEnabled ? {
      current: totalCurrent,
      previous: totalPrevious,
      changePct: totalComp.changePct,
      changeDiff: totalComp.changeDiff,
      comparisonStatus: totalComp.comparisonStatus,
    } : null,
    rows,
  };
};

/**
 * Dimension dictionary & resolvers for "New users by First user primary channel group" Card
 */
const NEW_USERS_CARD_DIMENSIONS = {
  firstuserprimarychannelgroup: {
    key: 'firstUserPrimaryChannelGroup',
    label: 'First user primary channel group',
    gaDimension: 'firstUserPrimaryChannelGroup',
  },
  primarychannelgroup: {
    key: 'firstUserPrimaryChannelGroup',
    label: 'First user primary channel group',
    gaDimension: 'firstUserPrimaryChannelGroup',
  },
  channel: {
    key: 'firstUserPrimaryChannelGroup',
    label: 'First user primary channel group',
    gaDimension: 'firstUserPrimaryChannelGroup',
  },
  firstuserdefaultchannelgroup: {
    key: 'firstUserDefaultChannelGroup',
    label: 'First user default channel group',
    gaDimension: 'firstUserDefaultChannelGroup',
  },
  defaultchannelgroup: {
    key: 'firstUserDefaultChannelGroup',
    label: 'First user default channel group',
    gaDimension: 'firstUserDefaultChannelGroup',
  },
  firstusermedium: {
    key: 'firstUserMedium',
    label: 'First user medium',
    gaDimension: 'firstUserMedium',
  },
  medium: {
    key: 'firstUserMedium',
    label: 'First user medium',
    gaDimension: 'firstUserMedium',
  },
  firstusercampaignname: {
    key: 'firstUserCampaignName',
    label: 'First user campaign',
    gaDimension: 'firstUserCampaignName',
  },
  firstusercampaign: {
    key: 'firstUserCampaignName',
    label: 'First user campaign',
    gaDimension: 'firstUserCampaignName',
  },
  campaign: {
    key: 'firstUserCampaignName',
    label: 'First user campaign',
    gaDimension: 'firstUserCampaignName',
  },
  firstusersource: {
    key: 'firstUserSource',
    label: 'First user source',
    gaDimension: 'firstUserSource',
  },
  source: {
    key: 'firstUserSource',
    label: 'First user source',
    gaDimension: 'firstUserSource',
  },
};

const resolveNewUsersMetricConfig = (metricInput) => {
  if (!metricInput || typeof metricInput !== 'string') {
    return { name: 'newUsers', label: 'New users', gaMetric: 'newUsers', metricType: 'INTEGER' };
  }
  const cleanKey = metricInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanKey === 'newusers') {
    return { name: 'newUsers', label: 'New users', gaMetric: 'newUsers', metricType: 'INTEGER' };
  }
  const err = new Error(`Unsupported metric for New Users card: '${metricInput}'. Metric must be newUsers.`);
  err.statusCode = 400;
  err.code = 'UNSUPPORTED_NEW_USERS_METRIC';
  throw err;
};

const resolveNewUsersDimensionConfig = (dimensionInput) => {
  if (!dimensionInput || typeof dimensionInput !== 'string') {
    return NEW_USERS_CARD_DIMENSIONS.firstuserprimarychannelgroup;
  }
  const cleanKey = dimensionInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (NEW_USERS_CARD_DIMENSIONS[cleanKey]) {
    return NEW_USERS_CARD_DIMENSIONS[cleanKey];
  }
  const err = new Error(`Unsupported first-user dimension: '${dimensionInput}'. Supported dimensions: firstUserPrimaryChannelGroup, firstUserDefaultChannelGroup, firstUserMedium, firstUserCampaignName, firstUserSource.`);
  err.statusCode = 400;
  err.code = 'UNSUPPORTED_FIRST_USER_DIMENSION';
  throw err;
};

/**
 * Dedicated reporter for "New users by First user primary channel group" Suggested Card
 */
const fetchNewUsersCardData = async (userId, cardConfig, queryParams = {}, options = {}) => {
  const property = options.property || (await resolveSelectedProperty(userId, queryParams.propertyId));
  const accessToken = options.accessToken || (await googleService.getValidAccessToken(userId));

  const rawPresetInput =
    queryParams.preset ||
    queryParams.datePreset ||
    queryParams.rangePreset ||
    queryParams.range ||
    (cardConfig ? cardConfig.defaultPreset : '28D');

  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    rawPresetInput,
    property.timeZone
  );

  const comparisonType = (queryParams.comparisonType || 'previous_period').toLowerCase().trim();
  const isComparisonEnabled = comparisonType !== 'none';
  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
    startDateStr,
    endDateStr,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const metricInput = queryParams.metric || queryParams.metrics;
  const metricConfig = resolveNewUsersMetricConfig(metricInput);

  const dimensionInput = queryParams.dimension || queryParams.dimensions;
  const dimConfig = resolveNewUsersDimensionConfig(dimensionInput);

  const limit = queryParams.limit ? Math.min(Math.max(parseInt(queryParams.limit, 10), 1), 8) : 8;

  const currentReportPromise = runGA4Report({
    accessToken,
    propertyId: property.propertyId,
    dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
    dimensions: [{ name: dimConfig.gaDimension }],
    metrics: [{ name: metricConfig.gaMetric }],
    orderBys: [
      {
        metric: { metricName: metricConfig.gaMetric },
        desc: true,
      },
    ],
    limit,
    keepEmptyRows: false,
  }).catch((err) => {
    if (err.statusCode === 400 || err.code === 'INCOMPATIBLE_METRIC_DIMENSION') {
      return { rows: [] };
    }
    throw err;
  });

  const compReportPromise = isComparisonEnabled
    ? runGA4Report({
        accessToken,
        propertyId: property.propertyId,
        dateRanges: [{ startDate: compStartDateStr, endDate: compEndDateStr, name: 'previous_period' }],
        dimensions: [{ name: dimConfig.gaDimension }],
        metrics: [{ name: metricConfig.gaMetric }],
        limit: 1000,
        keepEmptyRows: false,
      }).catch(() => ({ rows: [] }))
    : Promise.resolve({ rows: [] });

  const [reportResult, compResult] = await Promise.all([
    currentReportPromise,
    compReportPromise,
  ]);

  const comparisonMap = new Map();
  if (isComparisonEnabled && compResult && Array.isArray(compResult.rows)) {
    compResult.rows.forEach((row) => {
      const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '(not set)';
      const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
      const numVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
      comparisonMap.set(dimVal, numVal);
    });
  }

  const totalCurrent = (reportResult && Array.isArray(reportResult.totals) && reportResult.totals.length > 0)
    ? Number(reportResult.totals[0]) || 0
    : ((reportResult && Array.isArray(reportResult.rows))
        ? reportResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalPrevious = (compResult && Array.isArray(compResult.totals) && compResult.totals.length > 0)
    ? Number(compResult.totals[0]) || 0
    : ((compResult && Array.isArray(compResult.rows))
        ? compResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalComp = isComparisonEnabled
    ? calculateMetricComparison(totalCurrent, totalPrevious, 'INTEGER')
    : null;

  const rows = [];
  if (reportResult && Array.isArray(reportResult.rows)) {
    reportResult.rows.forEach((row) => {
      const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '(not set)';
      const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
      const currentVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
      const previousVal = comparisonMap.get(dimVal) || 0;

      const comp = calculateMetricComparison(currentVal, previousVal, 'INTEGER');

      rows.push({
        dimensionValue: dimVal,
        dimensionLabel: dimVal,
        dimension: dimVal,
        value: currentVal,
        current: currentVal,
        previous: previousVal,
        changePct: comp.changePct,
        changeDiff: comp.changeDiff,
        comparisonStatus: comp.comparisonStatus,
      });
    });
  }

  return {
    card: cardConfig ? cardConfig.key : 'new-users-by-channel',
    title: cardConfig ? cardConfig.title : 'New users by First user primary channel group',
    dimension: dimConfig.key,
    dimensionLabel: dimConfig.label,
    gaDimension: dimConfig.gaDimension,
    metric: 'newUsers',
    metricLabel: 'New users',
    gaMetric: 'newUsers',
    dateRange: {
      preset,
      startDate: startDateStr,
      endDate: endDateStr,
    },
    comparison: {
      type: comparisonType,
      enabled: isComparisonEnabled,
      startDate: isComparisonEnabled ? compStartDateStr : null,
      endDate: isComparisonEnabled ? compEndDateStr : null,
    },
    total: totalCurrent,
    totalComparison: isComparisonEnabled ? {
      current: totalCurrent,
      previous: totalPrevious,
      changePct: totalComp.changePct,
      changeDiff: totalComp.changeDiff,
      comparisonStatus: totalComp.comparisonStatus,
    } : null,
    rows,
  };
};

/**
 * Dedicated reporter for "Active users by Town/City" Suggested Card with pre-selection filtering of (not set).
 */
const fetchCityCardData = async (userId, cardConfig, queryParams = {}, options = {}) => {
  const property = options.property || (await resolveSelectedProperty(userId, queryParams.propertyId));
  const accessToken = options.accessToken || (await googleService.getValidAccessToken(userId));

  const rawPresetInput =
    queryParams.preset ||
    queryParams.datePreset ||
    queryParams.rangePreset ||
    queryParams.range ||
    (cardConfig ? cardConfig.defaultPreset : '28D');

  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    rawPresetInput,
    property.timeZone
  );

  const comparisonType = (queryParams.comparisonType || 'previous_period').toLowerCase().trim();
  const isComparisonEnabled = comparisonType !== 'none';
  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
    startDateStr,
    endDateStr,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const limit = queryParams.limit ? Math.min(Math.max(parseInt(queryParams.limit, 10), 1), 50) : (cardConfig ? (cardConfig.limit || 8) : 8);

  const currentReportPromise = runGA4Report({
    accessToken,
    propertyId: property.propertyId,
    dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
    dimensions: [{ name: 'city' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [
      {
        metric: { metricName: 'activeUsers' },
        desc: true,
      },
    ],
    limit: 1000,
    keepEmptyRows: false,
  }).catch((err) => {
    if (err.statusCode === 400 || err.code === 'INCOMPATIBLE_METRIC_DIMENSION') {
      return { rows: [] };
    }
    throw err;
  });

  const compReportPromise = isComparisonEnabled
    ? runGA4Report({
        accessToken,
        propertyId: property.propertyId,
        dateRanges: [{ startDate: compStartDateStr, endDate: compEndDateStr, name: 'previous_period' }],
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 1000,
        keepEmptyRows: false,
      }).catch(() => ({ rows: [] }))
    : Promise.resolve({ rows: [] });

  const [reportResult, compResult] = await Promise.all([
    currentReportPromise,
    compReportPromise,
  ]);

  const comparisonMap = new Map();
  if (isComparisonEnabled && compResult && Array.isArray(compResult.rows)) {
    compResult.rows.forEach((row) => {
      const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '';
      const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
      const numVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
      if (dimVal && dimVal.toLowerCase() !== '(not set)') {
        comparisonMap.set(dimVal, numVal);
      }
    });
  }

  const totalCurrent = (reportResult && Array.isArray(reportResult.totals) && reportResult.totals.length > 0)
    ? Number(reportResult.totals[0]) || 0
    : ((reportResult && Array.isArray(reportResult.rows))
        ? reportResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalPrevious = (compResult && Array.isArray(compResult.totals) && compResult.totals.length > 0)
    ? Number(compResult.totals[0]) || 0
    : ((compResult && Array.isArray(compResult.rows))
        ? compResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalComp = isComparisonEnabled
    ? calculateMetricComparison(totalCurrent, totalPrevious, 'INTEGER')
    : null;

  const isInvalidCity = (c) => !c || String(c).trim() === '' || String(c).trim().toLowerCase() === '(not set)';

  const rawRows = (reportResult && Array.isArray(reportResult.rows)) ? reportResult.rows : [];

  // Filter out (not set), null, undefined, empty, and whitespace-only city values BEFORE taking top N
  const validRows = rawRows.filter((row) => {
    const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '';
    return !isInvalidCity(dimVal);
  });

  // Take top N valid city rows AFTER filtering
  const topValidRows = validRows.slice(0, limit);

  const rows = topValidRows.map((row) => {
    const dimVal = String(row.dimensionValues[0]).trim();
    const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
    const currentVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
    const previousVal = comparisonMap.get(dimVal) || 0;

    const comp = calculateMetricComparison(currentVal, previousVal, 'INTEGER');

    return {
      dimensionValue: dimVal,
      dimensionLabel: dimVal,
      dimension: dimVal,
      value: currentVal,
      current: currentVal,
      previous: previousVal,
      changePct: comp.changePct,
      changeDiff: comp.changeDiff,
      comparisonStatus: comp.comparisonStatus,
    };
  });

  console.log(`[GA4 CITY CARD LOG] Property: ${property.propertyId} | Date: ${startDateStr}->${endDateStr} | Total: ${totalCurrent} | Raw rows: ${rawRows.length} | Valid city rows: ${validRows.length} | Final returned rows: ${rows.length}`);
  console.log(`[GA4 CITY CARD DIAGNOSTIC] First 5 returned rows:`, JSON.stringify(rows.slice(0, 5)));

  return {
    card: cardConfig ? cardConfig.key : 'active-users-by-city',
    title: cardConfig ? cardConfig.title : 'Active users by Town/City',
    dimension: 'city',
    dimensionLabel: 'Town/City',
    gaDimension: 'city',
    metric: 'activeUsers',
    metricLabel: 'Active users',
    gaMetric: 'activeUsers',
    dateRange: {
      preset,
      startDate: startDateStr,
      endDate: endDateStr,
    },
    comparison: {
      type: comparisonType,
      enabled: isComparisonEnabled,
      startDate: isComparisonEnabled ? compStartDateStr : null,
      endDate: isComparisonEnabled ? compEndDateStr : null,
    },
    total: totalCurrent,
    totalComparison: isComparisonEnabled ? {
      current: totalCurrent,
      previous: totalPrevious,
      changePct: totalComp.changePct,
      changeDiff: totalComp.changeDiff,
      comparisonStatus: totalComp.comparisonStatus,
    } : null,
    rows,
  };
};

/**
 * Executes GA4 report query for a single card with its own independent date range and property timezone.
 */
const fetchSingleSuggestedCardData = async (userId, cardConfig, queryParams = {}, options = {}) => {
  if (cardConfig && cardConfig.key === 'active-users-by-country') {
    return fetchCountryCardData(userId, cardConfig, queryParams, options);
  }
  if (cardConfig && cardConfig.key === 'active-users-by-city') {
    return fetchCityCardData(userId, cardConfig, queryParams, options);
  }
  if (cardConfig && cardConfig.key === 'key-events-by-platform') {
    return fetchPlatformCardData(userId, cardConfig, queryParams, options);
  }
  if (cardConfig && cardConfig.key === 'new-users-by-channel') {
    return fetchNewUsersCardData(userId, cardConfig, queryParams, options);
  }
  if (cardConfig && cardConfig.key === 'sessions-by-channel') {
    const acqRes = await getTrafficAcquisition(userId, queryParams);
    return {
      card: cardConfig.key,
      title: cardConfig.title,
      ...acqRes.data,
    };
  }

  const property = options.property || (await resolveSelectedProperty(userId, queryParams.propertyId));
  const accessToken = options.accessToken || (await googleService.getValidAccessToken(userId));

  const rawPresetInput =
    queryParams.preset ||
    queryParams.datePreset ||
    queryParams.rangePreset ||
    queryParams.range ||
    (cardConfig ? cardConfig.defaultPreset : '28D');

  const { preset, startDateStr, endDateStr } = validateAndNormalizeDateRange(
    queryParams.startDate,
    queryParams.endDate,
    rawPresetInput,
    property.timeZone
  );

  const comparisonType = (queryParams.comparisonType || 'previous_period').toLowerCase().trim();
  const isComparisonEnabled = comparisonType !== 'none';
  const { compStartDateStr, compEndDateStr } = calculateComparisonDateRange(
    startDateStr,
    endDateStr,
    comparisonType,
    queryParams.comparisonStartDate,
    queryParams.comparisonEndDate
  );

  const limit = queryParams.limit ? Math.min(Math.max(parseInt(queryParams.limit, 10), 1), 100) : (cardConfig ? (cardConfig.limit || 8) : 8);

  const currentReportPromise = runGA4Report({
    accessToken,
    propertyId: property.propertyId,
    dateRanges: [{ startDate: startDateStr, endDate: endDateStr, name: 'current_period' }],
    dimensions: [{ name: cardConfig.gaDimension }],
    metrics: [{ name: cardConfig.gaMetric }],
    orderBys: [
      {
        metric: { metricName: cardConfig.gaMetric },
        desc: true,
      },
    ],
    limit,
    keepEmptyRows: false,
  }).catch((err) => {
    if (err.statusCode === 400 || err.code === 'INCOMPATIBLE_METRIC_DIMENSION') {
      return { rows: [] };
    }
    throw err;
  });

  const compReportPromise = isComparisonEnabled
    ? runGA4Report({
        accessToken,
        propertyId: property.propertyId,
        dateRanges: [{ startDate: compStartDateStr, endDate: compEndDateStr, name: 'previous_period' }],
        dimensions: [{ name: cardConfig.gaDimension }],
        metrics: [{ name: cardConfig.gaMetric }],
        limit: 1000,
        keepEmptyRows: false,
      }).catch(() => ({ rows: [] }))
    : Promise.resolve({ rows: [] });

  const [reportResult, compResult] = await Promise.all([
    currentReportPromise,
    compReportPromise,
  ]);

  const comparisonMap = new Map();
  if (isComparisonEnabled && compResult && Array.isArray(compResult.rows)) {
    compResult.rows.forEach((row) => {
      const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '(not set)';
      const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
      const numVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
      comparisonMap.set(dimVal, numVal);
    });
  }

  const totalCurrent = (reportResult && Array.isArray(reportResult.totals) && reportResult.totals.length > 0)
    ? Number(reportResult.totals[0]) || 0
    : ((reportResult && Array.isArray(reportResult.rows))
        ? reportResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalPrevious = (compResult && Array.isArray(compResult.totals) && compResult.totals.length > 0)
    ? Number(compResult.totals[0]) || 0
    : ((compResult && Array.isArray(compResult.rows))
        ? compResult.rows.reduce((acc, r) => acc + (Number(r.metricValues[0]) || 0), 0)
        : 0);

  const totalComp = isComparisonEnabled
    ? calculateMetricComparison(totalCurrent, totalPrevious, cardConfig.metricType || 'INTEGER')
    : null;

  const rows = [];
  if (reportResult && Array.isArray(reportResult.rows)) {
    reportResult.rows.forEach((row) => {
      const dimVal = row.dimensionValues && row.dimensionValues.length > 0 ? String(row.dimensionValues[0]).trim() : '(not set)';
      const rawVal = row.metricValues && row.metricValues.length > 0 ? row.metricValues[0] : 0;
      const currentVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
      const previousVal = comparisonMap.get(dimVal) || 0;

      const comp = calculateMetricComparison(currentVal, previousVal, cardConfig.metricType || 'INTEGER');

      rows.push({
        dimensionValue: dimVal,
        dimensionLabel: dimVal,
        dimension: dimVal,
        value: currentVal,
        current: currentVal,
        previous: previousVal,
        changePct: comp.changePct,
        changeDiff: comp.changeDiff,
        comparisonStatus: comp.comparisonStatus,
      });
    });
  }

  return {
    card: cardConfig.key,
    title: cardConfig.title,
    dimension: cardConfig.gaDimension,
    dimensionLabel: cardConfig.dimensionLabel,
    gaDimension: cardConfig.gaDimension,
    metric: cardConfig.gaMetric,
    metricLabel: cardConfig.metricLabel,
    gaMetric: cardConfig.gaMetric,
    dateRange: {
      preset,
      startDate: startDateStr,
      endDate: endDateStr,
    },
    comparison: {
      type: comparisonType,
      enabled: isComparisonEnabled,
      startDate: isComparisonEnabled ? compStartDateStr : null,
      endDate: isComparisonEnabled ? compEndDateStr : null,
    },
    total: totalCurrent,
    totalComparison: isComparisonEnabled ? {
      current: totalCurrent,
      previous: totalPrevious,
      changePct: totalComp.changePct,
      changeDiff: totalComp.changeDiff,
      comparisonStatus: totalComp.comparisonStatus,
    } : null,
    rows,
  };
};

/**
 * GET /api/google/analytics/insights/suggested-cards
 * Queries GA4 Suggested-for-You cards with per-card independent date ranges.
 */
const getSuggestedCards = async (userId, queryParams = {}) => {
  const property = await resolveSelectedProperty(userId, queryParams.propertyId);
  const accessToken = await googleService.getValidAccessToken(userId);

  const rawCardKey = queryParams.card || queryParams.cardKey || queryParams.cardId;

  // Single card query
  if (rawCardKey && String(rawCardKey).trim().toLowerCase() !== 'all') {
    const cardConfig = resolveSuggestedCardConfig(rawCardKey);
    if (!cardConfig) {
      const err = new Error(`Unsupported card key: '${rawCardKey}'. Must be one of the supported Suggested-for-you cards.`);
      err.statusCode = 400;
      err.code = 'UNSUPPORTED_CARD_KEY';
      throw err;
    }

    const cardData = await fetchSingleSuggestedCardData(userId, cardConfig, queryParams, { property, accessToken });

    const integration = await GoogleIntegration.findOne({ userId });
    const capabilities = googleAnalyticsAdminService.evaluateCapabilities(integration, [property]);

    return {
      data: cardData,
      meta: {
        source: 'google_analytics_4',
        reportType: 'suggested_card',
        property: {
          propertyId: property.propertyId,
          propertyName: property.propertyName,
          displayName: property.displayName,
          timeZone: property.timeZone,
        },
        capabilities,
      },
    };
  }

  // Multi-card / Carousel query
  const cardKeys = Object.keys(SUGGESTED_CARDS_REGISTRY);
  const cardPromises = cardKeys.map((key) => {
    const config = SUGGESTED_CARDS_REGISTRY[key];
    const cardSpecificParams = {
      ...queryParams,
      rangePreset: queryParams[`${config.key}_rangePreset`] || queryParams[`${config.key}_preset`] || queryParams.rangePreset,
      startDate: queryParams[`${config.key}_startDate`] || queryParams.startDate,
      endDate: queryParams[`${config.key}_endDate`] || queryParams.endDate,
    };
    return fetchSingleSuggestedCardData(userId, config, cardSpecificParams, { property, accessToken });
  });

  const cardsData = await Promise.all(cardPromises);

  const integration = await GoogleIntegration.findOne({ userId });
  const capabilities = googleAnalyticsAdminService.evaluateCapabilities(integration, [property]);

  return {
    data: {
      cards: cardsData,
      count: cardsData.length,
    },
    meta: {
      source: 'google_analytics_4',
      reportType: 'suggested_cards_carousel',
      property: {
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        displayName: property.displayName,
        timeZone: property.timeZone,
      },
      capabilities,
    },
  };
};

const ga4RealtimeReportCache = new Map();
const ga4RealtimeInFlightPromises = new Map();
const GA4_REALTIME_CACHE_TTL_MS = 10000;

/**
 * Generic reusable runRealtimeReport foundation calling GA4 Data API v1beta
 */
const runGA4RealtimeReport = async ({
  accessToken,
  propertyId,
  dimensions = [],
  metrics = [],
  dimensionFilter = null,
  metricFilter = null,
  orderBys = [],
  limit = 1000,
  skipCache = false,
}) => {
  const cleanPropertyId = String(propertyId).replace('properties/', '').trim();
  const cacheKey = `runRealtimeReport:${cleanPropertyId}:${JSON.stringify({
    dimensions,
    metrics,
    dimensionFilter,
    metricFilter,
    orderBys,
    limit,
  })}`;

  const now = Date.now();

  // 1. Return cached response if within 10s TTL
  if (!skipCache && ga4RealtimeReportCache.has(cacheKey)) {
    const cached = ga4RealtimeReportCache.get(cacheKey);
    if (now - cached.timestamp < GA4_REALTIME_CACHE_TTL_MS) {
      return cached.data;
    }
    ga4RealtimeReportCache.delete(cacheKey);
  }

  // 2. Return in-flight promise if duplicate realtime request is executing
  if (!skipCache && ga4RealtimeInFlightPromises.has(cacheKey)) {
    return ga4RealtimeInFlightPromises.get(cacheKey);
  }

  // 3. Create fresh execution promise throttled by concurrency queue
  const executeRealtimePromise = enqueueGA4Request(async () => {
    const url = `${DATA_API_BASE_URL}/properties/${cleanPropertyId}:runRealtimeReport`;

    const requestBody = {
      dimensions: dimensions.map((d) => (typeof d === 'string' ? { name: d } : d)),
      metrics: metrics.map((m) => (typeof m === 'string' ? { name: m } : m)),
      ...(dimensionFilter ? { dimensionFilter } : {}),
      ...(metricFilter ? { metricFilter } : {}),
      ...(Array.isArray(orderBys) && orderBys.length > 0 ? { orderBys } : {}),
      limit: limit ? Math.min(parseInt(limit, 10), 10000) : 1000,
    };

    const responseData = await fetchGA4DataApi(url, accessToken, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    const rawRows = Array.isArray(responseData.rows) ? responseData.rows : [];
    const dimensionHeaders = Array.isArray(responseData.dimensionHeaders)
      ? responseData.dimensionHeaders.map((h) => h.name)
      : [];
    const metricHeaders = Array.isArray(responseData.metricHeaders)
      ? responseData.metricHeaders.map((h) => ({ name: h.name, type: h.type }))
      : [];

    const normalizedRows = rawRows.map((row) => {
      const dimValues = (row.dimensionValues || []).map((v) => v.value);
      const metValues = (row.metricValues || []).map((v) => {
        const valStr = v.value;
        const num = Number(valStr);
        return isNaN(num) ? valStr : num;
      });

      return {
        dimensionValues: dimValues,
        metricValues: metValues,
      };
    });

    const result = {
      rows: normalizedRows,
      dimensionHeaders,
      metricHeaders,
      rowCount: responseData.rowCount || normalizedRows.length,
      totals: responseData.totals || null,
    };

    ga4RealtimeReportCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }).finally(() => {
    ga4RealtimeInFlightPromises.delete(cacheKey);
  });

  ga4RealtimeInFlightPromises.set(cacheKey, executeRealtimePromise);
  return executeRealtimePromise;
};

/**
 * Registry of supported vs unsupported GA4 Realtime metrics
 */
const REALTIME_METRICS_REGISTRY = {
  activeusers: {
    key: 'activeUsers',
    label: 'Active users',
    gaMetric: 'activeUsers',
    supported: true,
  },
  newusers: {
    key: 'newUsers',
    label: 'New users',
    gaMetric: null,
    supported: false,
    reason: "The 'newUsers' metric is not supported in the GA4 Realtime Data API. GA4 Realtime reports support activeUsers, eventCount, keyEvents, and screenPageViews.",
  },
  eventcount: {
    key: 'eventCount',
    label: 'Event count',
    gaMetric: 'eventCount',
    supported: true,
  },
  keyevents: {
    key: 'keyEvents',
    label: 'Key events',
    gaMetric: 'keyEvents',
    supported: true,
  },
  screenpageviews: {
    key: 'screenPageViews',
    label: 'Views',
    gaMetric: 'screenPageViews',
    supported: true,
  },
};

/**
 * Registry of supported vs unsupported GA4 Realtime dimensions
 */
const REALTIME_DIMENSIONS_REGISTRY = {
  country: {
    key: 'country',
    label: 'Country',
    gaDimension: 'country',
    supported: true,
  },
  city: {
    key: 'city',
    label: 'Town/City',
    gaDimension: 'city',
    supported: true,
  },
  town: {
    key: 'city',
    label: 'Town/City',
    gaDimension: 'city',
    supported: true,
  },
  towncity: {
    key: 'city',
    label: 'Town/City',
    gaDimension: 'city',
    supported: true,
  },
  audience: {
    key: 'audience',
    label: 'Audience',
    gaDimension: 'audienceName',
    supported: true,
  },
  audiencename: {
    key: 'audience',
    label: 'Audience',
    gaDimension: 'audienceName',
    supported: true,
  },
  minutesago: {
    key: 'minutesAgo',
    label: 'Minutes ago',
    gaDimension: 'minutesAgo',
    supported: true,
  },
  minutesAgo: {
    key: 'minutesAgo',
    label: 'Minutes ago',
    gaDimension: 'minutesAgo',
    supported: true,
  },
  firstusercampaign: {
    key: 'firstUserCampaign',
    label: 'First user campaign',
    gaDimension: null,
    supported: false,
    reason: "The 'First user campaign' dimension is not supported in the GA4 Realtime Data API. GA4 Realtime reports support dimensions such as country, city, audienceName, deviceCategory, platform, and eventName.",
  },
  firstusermedium: {
    key: 'firstUserMedium',
    label: 'First user medium',
    gaDimension: null,
    supported: false,
    reason: "The 'First user medium' dimension is not supported in the GA4 Realtime Data API. GA4 Realtime reports support dimensions such as country, city, audienceName, deviceCategory, platform, and eventName.",
  },
  firstusersource: {
    key: 'firstUserSource',
    label: 'First user source',
    gaDimension: null,
    supported: false,
    reason: "The 'First user source' dimension is not supported in the GA4 Realtime Data API. GA4 Realtime reports support dimensions such as country, city, audienceName, deviceCategory, platform, and eventName.",
  },
  firstusersourceplatform: {
    key: 'firstUserSourcePlatform',
    label: 'First user source platform',
    gaDimension: null,
    supported: false,
    reason: "The 'First user source platform' dimension is not supported in the GA4 Realtime Data API. GA4 Realtime reports support dimensions such as country, city, audienceName, deviceCategory, platform, and eventName.",
  },
};

const resolveRealtimeMetricConfig = (metricInput) => {
  if (!metricInput || typeof metricInput !== 'string') {
    return REALTIME_METRICS_REGISTRY.activeusers;
  }
  const cleanKey = metricInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanKey === 'chooseforme' || cleanKey === 'default' || cleanKey === 'choose') {
    return REALTIME_METRICS_REGISTRY.activeusers;
  }
  for (const [key, config] of Object.entries(REALTIME_METRICS_REGISTRY)) {
    if (key === cleanKey) return config;
  }
  return {
    key: metricInput,
    label: metricInput,
    gaMetric: null,
    supported: false,
    reason: `The metric '${metricInput}' is not supported in the GA4 Realtime Data API. Supported metrics: activeUsers, eventCount, keyEvents, screenPageViews.`,
  };
};

const resolveRealtimeDimensionConfig = (dimensionInput) => {
  if (!dimensionInput || typeof dimensionInput !== 'string') {
    return REALTIME_DIMENSIONS_REGISTRY.country;
  }
  const cleanKey = dimensionInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanKey === 'chooseforme' || cleanKey === 'default' || cleanKey === 'choose') {
    return REALTIME_DIMENSIONS_REGISTRY.country;
  }
  for (const [key, config] of Object.entries(REALTIME_DIMENSIONS_REGISTRY)) {
    if (key === cleanKey) return config;
  }
  return {
    key: dimensionInput,
    label: dimensionInput,
    gaDimension: null,
    supported: false,
    reason: `The dimension '${dimensionInput}' is not supported in the GA4 Realtime Data API. Supported dimensions: country, city, audienceName, deviceCategory, platform, eventName.`,
  };
};

/**
 * GET /api/google/analytics/insights/realtime
 * Queries GA4 Realtime Data API for "Active users in last 30 minutes" card.
 */
const getRealtimeData = async (userId, queryParams = {}) => {
  const property = await resolveSelectedProperty(userId, queryParams.propertyId);
  const accessToken = await googleService.getValidAccessToken(userId);

  const rawMetric = queryParams.metric || 'activeUsers';
  const rawDimension = queryParams.dimension || queryParams.dimensions || 'country';

  const metricConfig = resolveRealtimeMetricConfig(rawMetric);
  const dimensionConfig = resolveRealtimeDimensionConfig(rawDimension);

  // Structured error for unsupported metric
  if (!metricConfig.supported) {
    const err = new Error(metricConfig.reason || `${rawMetric} is not supported by the GA4 Realtime Data API.`);
    err.statusCode = 400;
    err.code = 'REALTIME_METRIC_UNSUPPORTED';
    throw err;
  }

  // Structured error for unsupported dimension
  if (!dimensionConfig.supported) {
    const err = new Error(dimensionConfig.reason || `${rawDimension} is not supported by the GA4 Realtime Data API.`);
    err.statusCode = 400;
    err.code = 'REALTIME_DIMENSION_UNSUPPORTED';
    throw err;
  }

  const limit = queryParams.limit ? Math.min(Math.max(parseInt(queryParams.limit, 10), 1), 50) : 10;
  const isMinutesAgo = dimensionConfig.key === 'minutesAgo' || rawDimension.toLowerCase() === 'minutesago';

  console.log(`[GA4 REALTIME LOG] User: ${userId} | Property: ${property.propertyId} | Metric: ${metricConfig.gaMetric} | Dimension: ${dimensionConfig.gaDimension || rawDimension} | IsMinutesAgo: ${isMinutesAgo}`);

  if (isMinutesAgo) {
    const minutePromise = runGA4RealtimeReport({
      accessToken,
      propertyId: property.propertyId,
      dimensions: [{ name: 'minutesAgo' }],
      metrics: [{ name: metricConfig.gaMetric }],
      limit: 100,
    });

    const totalPromise = runGA4RealtimeReport({
      accessToken,
      propertyId: property.propertyId,
      metrics: [{ name: metricConfig.gaMetric }],
      limit: 1,
    });

    const [minuteResult, totalResult] = await Promise.all([minutePromise, totalPromise]);

    console.log(`[GA4 REALTIME LOG] Property: ${property.propertyId} | minuteResult rows: ${minuteResult?.rowCount || 0}`);

    const minuteMap = new Map();
    if (minuteResult && Array.isArray(minuteResult.rows)) {
      minuteResult.rows.forEach((r) => {
        const minStr = r.dimensionValues && r.dimensionValues[0] !== undefined ? String(r.dimensionValues[0]).trim() : '';
        const rawVal = r.metricValues && r.metricValues[0] !== undefined ? r.metricValues[0] : 0;
        const numVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
        minuteMap.set(minStr, numVal);
      });
    }

    const rows = [];
    let minuteSum = 0;
    for (let m = 0; m <= 29; m++) {
      const keyStr = String(m);
      const val = minuteMap.has(keyStr) ? minuteMap.get(keyStr) : 0;
      rows.push({
        minute: m,
        value: val,
      });
      minuteSum += val;
    }

    let overallTotal = 0;
    if (totalResult && Array.isArray(totalResult.rows) && totalResult.rows.length > 0) {
      const rawVal = totalResult.rows[0].metricValues && totalResult.rows[0].metricValues[0];
      overallTotal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
    } else {
      overallTotal = minuteSum;
    }

    return {
      data: {
        metric: metricConfig.key,
        dimension: 'minutesAgo',
        window: {
          type: 'realtime',
          minutes: 30,
        },
        total: overallTotal,
        rows,
      },
      meta: {
        source: 'google_analytics_realtime',
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        displayName: property.displayName,
        timeZone: property.timeZone,
      },
    };
  }

  // Dimension breakdown query (country, city, audience, etc.)
  const breakdownPromise = runGA4RealtimeReport({
    accessToken,
    propertyId: property.propertyId,
    dimensions: [{ name: dimensionConfig.gaDimension }],
    metrics: [{ name: metricConfig.gaMetric }],
    orderBys: [{ metric: { metricName: metricConfig.gaMetric }, desc: true }],
    limit,
  });

  const totalPromise = runGA4RealtimeReport({
    accessToken,
    propertyId: property.propertyId,
    metrics: [{ name: metricConfig.gaMetric }],
    limit: 1,
  });

  const [breakdownResult, totalResult] = await Promise.all([breakdownPromise, totalPromise]);

  console.log(`[GA4 REALTIME LOG] Property: ${property.propertyId} | breakdownResult rows: ${breakdownResult?.rowCount || 0}`);

  const rows = [];
  if (breakdownResult && Array.isArray(breakdownResult.rows)) {
    breakdownResult.rows.forEach((r) => {
      const dimVal = r.dimensionValues && r.dimensionValues[0] !== undefined ? String(r.dimensionValues[0]).trim() : '(not set)';
      const rawVal = r.metricValues && r.metricValues[0] !== undefined ? r.metricValues[0] : 0;
      const numVal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;

      rows.push({
        dimension: dimVal,
        value: numVal,
      });
    });
  }

  let overallTotal = 0;
  if (totalResult && Array.isArray(totalResult.rows) && totalResult.rows.length > 0) {
    const rawVal = totalResult.rows[0].metricValues && totalResult.rows[0].metricValues[0];
    overallTotal = typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : Number(rawVal) || 0;
  } else {
    overallTotal = rows.reduce((sum, item) => sum + item.value, 0);
  }

  return {
    data: {
      metric: metricConfig.key,
      dimension: dimensionConfig.key,
      window: {
        type: 'realtime',
        minutes: 30,
      },
      total: overallTotal,
      rows,
    },
    meta: {
      source: 'google_analytics_realtime',
      propertyId: property.propertyId,
      propertyName: property.propertyName,
      displayName: property.displayName,
      timeZone: property.timeZone,
    },
  };
};

module.exports = {
  ALLOWED_KPI_METRICS,
  SUGGESTED_CARDS_REGISTRY,
  REALTIME_METRICS_REGISTRY,
  REALTIME_DIMENSIONS_REGISTRY,
  resolveSelectedProperty,
  fetchGA4DataApi,
  runGA4Report,
  runGA4RealtimeReport,
  getMetricValueFromReport,
  getValueFromBatchResults,
  validateAndNormalizeDateRange,
  calculateComparisonDateRange,
  calculateMetricComparison,
  formatGA4DateString,
  resolveTrendGranularity,
  getGA4YearWeek,
  generateTrendBuckets,
  formatTrendPointsWithBuckets,
  getOverview,
  getTrafficAcquisition,
  getUserAcquisition,
  resolveSuggestedCardConfig,
  fetchSingleSuggestedCardData,
  getSuggestedCards,
  resolveCountryMetricConfig,
  resolveCountryDimensionConfig,
  fetchCountryCardData,
  fetchCityCardData,
  resolveAcquisitionMetricConfig,
  resolveAcquisitionDimensionConfig,
  resolvePlatformMetricConfig,
  resolvePlatformDimensionConfig,
  fetchPlatformCardData,
  resolveNewUsersMetricConfig,
  resolveNewUsersDimensionConfig,
  fetchNewUsersCardData,
  resolveRealtimeMetricConfig,
  resolveRealtimeDimensionConfig,
  getRealtimeData,
};




