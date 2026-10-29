/**
 * Reason: Phase 3 GROmentum Insights & Data Delivery service layer.
 * How: Encapsulates server-side requirement derivation, capability evaluation, 
 * data normalization, currency offset budget formatting, bounded pagination for published media, 
 * and derived analytics calculation on top of Phase 1 and Phase 2 foundations.
 */

const User = require('../models/User');
const Tenant = require('../models/Tenant');
const MetaIntegration = require('../models/MetaIntegration');
const metaService = require('./metaService');

/**
 * Server-side client requirement derivation (Never trusts query parameters)
 */
const deriveClientRequirements = (user, tenant) => {
  const isAllTier = tenant?.planTier === 'tier2' || tenant?.planTier === 'enterprise_pending';
  return {
    requireSocial: true, // Standard requirement for active clients
    requireInstagram: true, // Standard requirement for active clients
    requireAds: Boolean(isAllTier || user?.businessType === 'b2c' || user?.pricingTier),
  };
};

/**
 * Determines currency offset divisor based on Ad Account currency code
 */
const getCurrencyDivisor = (currencyCode = 'USD') => {
  const code = String(currencyCode).toUpperCase();
  // Zero-decimal currencies
  if (['JPY', 'KRW', 'VND', 'CLP', 'IDR', 'PYG', 'UGX', 'VUV'].includes(code)) {
    return 1;
  }
  // Three-decimal currencies
  if (['BHD', 'KWD', 'OMR', 'JOD', 'TND'].includes(code)) {
    return 1000;
  }
  // Standard 2-decimal currencies (USD, EUR, GBP, INR, CAD, AUD, etc.)
  return 100;
};

/**
 * Evaluates capability state (Server Requirement ∩ Granted Scope ∩ Asset Discovered ∩ Token Valid)
 */
const evaluateCapabilities = (integration, user, tenant, assets = {}) => {
  const requirements = deriveClientRequirements(user, tenant);
  const isConnected = Boolean(integration && integration.status === 'connected' && integration.accessToken);
  const grantedScopes = new Set(integration?.grantedScopes || []);

  const pages = assets.pages || [];
  const igAccounts = assets.instagramAccounts || [];
  const adAccounts = assets.adAccounts || [];

  // 1. Social (Facebook Page Discovery & Access) Capability
  let social = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected' };
  if (!requirements.requireSocial) {
    social = { available: false, code: 'REQUIREMENT_DISABLED', reason: 'Social capability is disabled for user plan/tier' };
  } else if (!isConnected) {
    social = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected or authorization has expired' };
  } else if (!grantedScopes.has('pages_show_list')) {
    social = { available: false, code: 'PERMISSION_DENIED', reason: 'Required Meta permission (pages_show_list) not granted' };
  } else if (pages.length === 0) {
    social = { available: false, code: 'ASSET_NOT_FOUND', reason: 'No accessible Facebook Pages discovered' };
  } else {
    social = { available: true, code: 'AVAILABLE', reason: null };
  }

  // 1b. Facebook Page Insights Capability (Strict: Permissions ∩ Asset ∩ Page Access/Task)
  const hasPageWithAnalyzeTaskOrToken = pages.some(
    (p) => Boolean(p.pageToken) || (Array.isArray(p.tasks) && p.tasks.includes('ANALYZE'))
  );

  let pageInsights = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected' };
  if (!requirements.requireSocial) {
    pageInsights = { available: false, code: 'REQUIREMENT_DISABLED', reason: 'Social capability is disabled for user plan/tier' };
  } else if (!isConnected) {
    pageInsights = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected or authorization has expired' };
  } else if (!grantedScopes.has('pages_read_engagement') && !grantedScopes.has('read_insights')) {
    pageInsights = { available: false, code: 'PERMISSION_DENIED', reason: 'Required Meta permission (pages_read_engagement) not granted' };
  } else if (pages.length === 0) {
    pageInsights = { available: false, code: 'ASSET_NOT_FOUND', reason: 'No accessible Facebook Pages discovered' };
  } else if (!hasPageWithAnalyzeTaskOrToken) {
    pageInsights = { available: false, code: 'INSUFFICIENT_PAGE_PERMISSIONS', reason: 'Discovered Facebook Page lacks ANALYZE task or Page Access Token' };
  } else {
    pageInsights = { available: true, code: 'AVAILABLE', reason: null };
  }

  social.pageInsights = pageInsights;

  // 2. Instagram Capability
  let instagram = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected' };
  if (!requirements.requireInstagram) {
    instagram = { available: false, code: 'REQUIREMENT_DISABLED', reason: 'Instagram capability is disabled for user plan/tier' };
  } else if (!isConnected) {
    instagram = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected or authorization has expired' };
  } else if (!grantedScopes.has('instagram_basic') && !grantedScopes.has('instagram_manage_insights')) {
    instagram = { available: false, code: 'PERMISSION_DENIED', reason: 'Required Meta permissions (instagram_basic, instagram_manage_insights) not granted' };
  } else if (igAccounts.length === 0) {
    instagram = { available: false, code: 'ASSET_NOT_FOUND', reason: 'No connected Instagram Professional Accounts discovered' };
  } else {
    instagram = { available: true, code: 'AVAILABLE', reason: null };
  }

  // 3. Ads Capability
  let ads = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected' };
  if (!requirements.requireAds) {
    ads = { available: false, code: 'REQUIREMENT_DISABLED', reason: 'Ads capability is disabled for user plan/tier' };
  } else if (!isConnected) {
    ads = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected or authorization has expired' };
  } else if (!grantedScopes.has('ads_read')) {
    ads = { available: false, code: 'PERMISSION_DENIED', reason: 'Required Meta permission (ads_read) not granted' };
  } else if (adAccounts.length === 0) {
    ads = { available: false, code: 'ASSET_NOT_FOUND', reason: 'No accessible Meta Ad Accounts discovered' };
  } else {
    ads = { available: true, code: 'AVAILABLE', reason: null };
  }

  return {
    social,
    pageInsights,
    instagram,
    ads,
  };
};

/**
 * Filter items published within since/until date window using reverse-chronological order
 */
const filterPublishedItemsInPeriod = (items = [], since = null, until = null) => {
  if (!since && !until) {
    return items;
  }

  let startDate = null;
  if (since) {
    startDate = new Date(since);
    startDate.setUTCHours(0, 0, 0, 0);
  }

  let endDate = null;
  if (until) {
    endDate = new Date(until);
    endDate.setUTCHours(23, 59, 59, 999);
  }

  return items.filter((item) => {
    const itemDate = new Date(item.createdTime || item.timestamp || item.created_time);
    if (isNaN(itemDate.getTime())) return true;
    if (startDate && itemDate < startDate) return false;
    if (endDate && itemDate > endDate) return false;
    return true;
  });
};

const contextCache = new Map();
const inFlightRequests = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

const queryCache = new Map();
const QUERY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes TTL

const getQueryCache = (cacheKey) => {
  if (queryCache.has(cacheKey)) {
    const entry = queryCache.get(cacheKey);
    if (Date.now() < entry.expiresAt) {
      return entry.data;
    }
    queryCache.delete(cacheKey);
  }
  return null;
};

const setQueryCache = (cacheKey, data) => {
  queryCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
  });
};

/**
 * Helper to resolve and validate a Facebook Page from user discovered assets
 */
const resolveFacebookPage = (assets, pageId) => {
  const pages = assets?.pages || [];
  if (pageId) {
    return pages.find((p) => String(p.pageId) === String(pageId)) || null;
  }
  return pages.length > 0 ? pages[0] : null;
};

/**
 * Helper to resolve and validate an Instagram Professional Account from user discovered assets
 */
const resolveInstagramAccount = (assets, instagramAccountId, instagramId) => {
  const igAccounts = assets?.instagramAccounts || [];
  const targetId = instagramAccountId || instagramId;
  if (targetId) {
    return igAccounts.find((ig) => String(ig.instagramAccountId) === String(targetId)) || null;
  }
  return igAccounts.length > 0 ? igAccounts[0] : null;
};

/**
 * Helper to resolve and validate a Meta Ad Account from user discovered assets
 */
const resolveAdAccount = (assets, adAccountId) => {
  const adAccounts = assets?.adAccounts || [];
  if (adAccountId) {
    return adAccounts.find((a) => String(a.adAccountId) === String(adAccountId)) || null;
  }
  return adAccounts.length > 0 ? adAccounts[0] : null;
};

const invalidateUserCache = (userId) => {
  const key = String(userId);
  contextCache.delete(key);
  inFlightRequests.delete(key);
  for (const cacheKey of queryCache.keys()) {
    if (cacheKey.startsWith(`${key}:`)) {
      queryCache.delete(cacheKey);
    }
  }
};

const setContextCache = (userId, data, ttlMs = CACHE_TTL_MS) => {
  const key = String(userId);
  contextCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
};

/**
 * Fetches user context, integration, and assets safely with deduplication and caching
 */
const getUserContextAndAssets = async (userId, forceRefresh = false) => {
  const cacheKey = String(userId);

  if (!forceRefresh && contextCache.has(cacheKey)) {
    const entry = contextCache.get(cacheKey);
    if (Date.now() < entry.expiresAt) {
      return entry.data; // Warm cache hit
    }
    contextCache.delete(cacheKey); // Expired cache
  }

  // Deduplicate concurrent requests
  if (!forceRefresh && inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const fetchPromise = (async () => {
    const user = await User.findById(userId);
    const tenant = user?.tenantId ? await Tenant.findById(user.tenantId) : null;
    const integration = await MetaIntegration.findOne({ userId });

    let assets = { pages: [], instagramAccounts: [], adAccounts: [] };
    if (integration && integration.accessToken && integration.status === 'connected') {
      try {
        assets = await metaService.discoverAssets(integration.accessToken, userId);
      } catch (err) {
        // Critical Meta API errors should fail the discovery, preventing fake empty caching
        if (err.statusCode === 429 || err.statusCode === 401 || err.statusCode === 403) {
          throw err; 
        }
        assets = { pages: [], instagramAccounts: [], adAccounts: [] };
      }
    }

    const capabilities = evaluateCapabilities(integration, user, tenant, assets);
    const ctx = { user, tenant, integration, assets, capabilities };

    // Only cache if the integration is connected and no critical errors occurred
    if (integration && integration.status === 'connected') {
      contextCache.set(cacheKey, {
        data: ctx,
        expiresAt: Date.now() + CACHE_TTL_MS
      });
    }

    return ctx;
  })();

  inFlightRequests.set(cacheKey, fetchPromise);

  try {
    const result = await fetchPromise;
    return result;
  } finally {
    // Always clear the in-flight deduplicator, regardless of success/fail
    inFlightRequests.delete(cacheKey);
  }
};

/**
 * GET /api/meta/insights/overview
 * Executive summary across Social and Ads
 */
const getOverview = async (userId, timeParams = {}) => {
  const cacheKey = `${String(userId)}:overview:${timeParams.adAccountId || ''}:${timeParams.pageId || ''}:${timeParams.instagramAccountId || timeParams.instagramId || ''}:${timeParams.since || ''}:${timeParams.until || ''}:${timeParams.datePreset || ''}`;
  const cached = getQueryCache(cacheKey);
  if (cached) return cached;

  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetAdAcc = resolveAdAccount(assets, timeParams.adAccountId);
  const targetPage = resolveFacebookPage(assets, timeParams.pageId);
  const targetIg = resolveInstagramAccount(assets, timeParams.instagramAccountId, timeParams.instagramId);

  let adsOverview = null;
  if (capabilities.ads.available && targetAdAcc) {
    try {
      const insightsResult = await metaService.getAdsInsights(
        targetAdAcc.adAccountId,
        integration.accessToken,
        timeParams,
        userId
      );
      
      const rows = insightsResult.insights || [];
      if (rows.length === 0) {
        adsOverview = {
          adAccountId: targetAdAcc.adAccountId,
          adAccountName: targetAdAcc.name,
          currency: targetAdAcc.currency,
          timezone: targetAdAcc.timezone,
          spend: null,
          impressions: null,
          clicks: null,
          reach: null,
          ctr: null,
          cpc: null,
          cpm: null,
        };
      } else {
        const hasSpend = rows.some((r) => typeof r.spend === 'number');
        const hasImpressions = rows.some((r) => typeof r.impressions === 'number');
        const hasClicks = rows.some((r) => typeof r.clicks === 'number');
        const hasReach = rows.some((r) => typeof r.reach === 'number');

        const totalSpend = hasSpend
          ? rows.reduce((sum, r) => sum + (typeof r.spend === 'number' ? r.spend : 0), 0)
          : null;
        const totalImpressions = hasImpressions
          ? rows.reduce((sum, r) => sum + (typeof r.impressions === 'number' ? r.impressions : 0), 0)
          : null;
        const totalClicks = hasClicks
          ? rows.reduce((sum, r) => sum + (typeof r.clicks === 'number' ? r.clicks : 0), 0)
          : null;
        const totalReach = hasReach
          ? rows.reduce((sum, r) => sum + (typeof r.reach === 'number' ? r.reach : 0), 0)
          : null;

        const ctr = (totalImpressions !== null && totalImpressions > 0 && totalClicks !== null)
          ? Number(((totalClicks / totalImpressions) * 100).toFixed(4))
          : null;
        const cpc = (totalClicks !== null && totalClicks > 0 && totalSpend !== null)
          ? Number((totalSpend / totalClicks).toFixed(4))
          : null;
        const cpm = (totalImpressions !== null && totalImpressions > 0 && totalSpend !== null)
          ? Number(((totalSpend / totalImpressions) * 1000).toFixed(4))
          : null;

        adsOverview = {
          adAccountId: targetAdAcc.adAccountId,
          adAccountName: targetAdAcc.name,
          currency: targetAdAcc.currency,
          timezone: targetAdAcc.timezone,
          spend: totalSpend !== null ? Number(totalSpend.toFixed(2)) : null,
          impressions: totalImpressions,
          clicks: totalClicks,
          reach: totalReach,
          ctr,
          cpc,
          cpm,
        };
      }
    } catch (err) {
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[OVERVIEW] Ads overview error for adAccountId=${targetAdAcc.adAccountId}: ${safeMsg}`);
      adsOverview = null;
    }
  }

  let socialOverview = null;
  if (capabilities.social.available && targetPage) {
    try {
      const pageDetails = await metaService.getFacebookPageDetails(targetPage.pageId, integration.accessToken, userId);
      
      let pageInsightsMetrics = [];
      if (capabilities.pageInsights?.available) {
        try {
          const pageInsights = await metaService.getFacebookPageInsights(targetPage.pageId, integration.accessToken, timeParams, userId);
          pageInsightsMetrics = pageInsights.metrics || [];
        } catch (err) {
          const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
          console.log(`[OVERVIEW] Page insights error for pageId=${targetPage.pageId}: ${safeMsg}`);
        }
      }

      socialOverview = {
        pageId: targetPage.pageId,
        pageName: pageDetails.name,
        followersCount: pageDetails.followersCount,
        fanCount: pageDetails.fanCount,
        metrics: pageInsightsMetrics,
      };
    } catch (err) {
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[OVERVIEW] Social overview error for pageId=${targetPage.pageId}: ${safeMsg}`);
      socialOverview = null;
    }
  }

  let instagramOverview = null;
  let instagramTruncated = false;
  if (capabilities.instagram.available && targetIg) {
    try {
      const allMediaResult = await fetchWithDateBoundary(
        metaService.getInstagramMedia,
        targetIg.instagramAccountId,
        integration.accessToken,
        timeParams,
        userId,
        'media'
      );
      const inPeriodMedia = filterPublishedItemsInPeriod(allMediaResult.items, timeParams.since, timeParams.until);
      instagramTruncated = allMediaResult.paginationTruncated;

      instagramOverview = {
        instagramAccountId: targetIg.instagramAccountId,
        username: targetIg.username,
        followersCount: targetIg.followersCount,
        lifetimeMediaCatalogCount: targetIg.mediaCount, // Profile lifetime static count
        publishedMediaInPeriod: inPeriodMedia.length, // Time-bounded published count
      };
    } catch (err) {
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[OVERVIEW] Instagram overview error for instagramAccountId=${targetIg.instagramAccountId}: ${safeMsg}`);
      instagramOverview = null;
    }
  }

  const response = {
    data: {
      adsOverview,
      socialOverview,
      instagramOverview,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: timeParams.since || null,
        until: timeParams.until || null,
        preset: timeParams.datePreset || null,
        timezone: targetAdAcc?.timezone || assets.adAccounts[0]?.timezone || 'UTC',
      },
      capabilities,
      complete: !instagramTruncated,
      paginationTruncated: instagramTruncated,
    },
  };

  setQueryCache(cacheKey, response);
  return response;
};

/**
 * GET /api/meta/insights/social
 * Facebook Page & Instagram performance metrics
 */
const getSocialInsights = async (userId, queryParams = {}) => {
  const cacheKey = `${String(userId)}:social:${queryParams.pageId || ''}:${queryParams.instagramAccountId || queryParams.instagramId || ''}:${queryParams.since || ''}:${queryParams.until || ''}:${queryParams.datePreset || ''}`;
  const cached = getQueryCache(cacheKey);
  if (cached) return cached;

  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetPage = resolveFacebookPage(assets, queryParams.pageId);
  const targetIg = resolveInstagramAccount(assets, queryParams.instagramAccountId, queryParams.instagramId);

  let pageData = null;
  let pageInsightsWarning = null;
  if (capabilities.social.available && targetPage) {
    let details = null;
    try {
      details = await metaService.getFacebookPageDetails(targetPage.pageId, integration.accessToken, userId);
    } catch (err) {
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[SOCIAL_INSIGHTS] Page details error for pageId=${targetPage.pageId}: ${safeMsg}`);
    }

    if (details) {
      let insightsMetrics = [];
      if (capabilities.pageInsights?.available) {
        try {
          const insights = await metaService.getFacebookPageInsights(targetPage.pageId, integration.accessToken, queryParams, userId);
          insightsMetrics = insights.metrics || [];
          if (insights.dataEmpty && !pageInsightsWarning) {
            pageInsightsWarning = 'Meta returned no Page Insights metric data for the selected Page and date range';
          }
        } catch (err) {
          const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
          console.log(`[SOCIAL_INSIGHTS] Page insights error for pageId=${targetPage.pageId}: ${safeMsg}`);
          pageInsightsWarning = `Facebook Page Insights: ${safeMsg}`;
        }
      }

      const analyticsReport = buildFacebookAnalyticsReport({
        targetPage,
        pageDetails: details,
        currentInsights: { pageId: targetPage.pageId, metrics: insightsMetrics },
        previousInsights: null,
        demographics: null,
        posts: [],
        timeParams: queryParams,
        warnings: pageInsightsWarning ? [pageInsightsWarning] : [],
      });

      pageData = {
        details,
        insights: insightsMetrics,
        analytics: analyticsReport,
      };
    }
  }

  const isExplicitFacebookOnly = Boolean(
    queryParams.pageId &&
    !queryParams.instagramAccountId &&
    !queryParams.instagramId &&
    queryParams.platform !== 'instagram' &&
    queryParams.platform !== 'all'
  );

  let instagramData = null;
  let instagramWarning = null;
  if (!isExplicitFacebookOnly && capabilities.instagram?.available && targetIg) {
    try {
      const insights = await metaService.getInstagramInsights(targetIg.instagramAccountId, integration.accessToken, queryParams, userId);
      instagramData = {
        instagramAccountId: targetIg.instagramAccountId,
        insights: insights.metrics || [],
      };
      if (insights.warning) {
        instagramWarning = insights.warning;
      }
    } catch (err) {
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[SOCIAL_INSIGHTS] Instagram insights error for instagramAccountId=${targetIg.instagramAccountId}: ${safeMsg}`);
      instagramData = null;
    }
  }

  const warnings = [];
  if (instagramWarning) {
    warnings.push(instagramWarning);
  }
  if (pageInsightsWarning) {
    warnings.push(pageInsightsWarning);
  }

  const response = {
    data: {
      page: pageData,
      instagram: instagramData,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: 'UTC',
      },
      capabilities,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };

  setQueryCache(cacheKey, response);
  return response;
};

/**
 * Helper to paginate through Meta API until an item older than the `since` boundary is found
 */
const fetchWithDateBoundary = async (fetchFn, id, accessToken, queryParams, userId, dataKey, extraToken = null) => {
  let allItems = [];
  let currentAfter = queryParams.after || null;
  let hasNext = true;
  const limit = queryParams.limit || 25;
  
  let startDate = null;
  let startTimestamp = null;
  if (queryParams.since) {
    startDate = new Date(queryParams.since);
    startDate.setUTCHours(0, 0, 0, 0);
    startTimestamp = Math.floor(startDate.getTime() / 1000);
  }

  let endTimestamp = null;
  if (queryParams.until) {
    const endDate = new Date(queryParams.until);
    endDate.setUTCHours(23, 59, 59, 999);
    endTimestamp = Math.floor(endDate.getTime() / 1000);
  }

  let pageCount = 0;
  const MAX_PAGES = 5; // Guard against unbounded loops during interactive requests
  let isTruncated = false;

  while (hasNext && pageCount < MAX_PAGES) {
    pageCount++;
    const params = { ...queryParams, limit, after: currentAfter };
    if (startTimestamp !== null) params.since = startTimestamp;
    if (endTimestamp !== null) params.until = endTimestamp;
    
    const result = await fetchFn(id, accessToken, params, userId, extraToken);
    
    const items = result[dataKey] || [];
    allItems = allItems.concat(items);

    if (items.length > 0) {
      const oldestItem = items[items.length - 1];
      const oldestDate = new Date(oldestItem.createdTime || oldestItem.timestamp);
      
      // Stop paginating if oldest item is strictly older than startDate
      if (startDate && !isNaN(oldestDate.getTime()) && oldestDate < startDate) {
        break;
      }
    }
    
    if (result.pagination && result.pagination.hasNextPage) {
      if (result.pagination.cursors.after === currentAfter) {
        hasNext = false;
      } else {
        currentAfter = result.pagination.cursors.after;
      }
    } else {
      hasNext = false;
    }
  }

  if (hasNext && pageCount >= MAX_PAGES) {
    isTruncated = true;
  }

  return {
    items: allItems,
    paginationTruncated: isTruncated
  };
};

/**
 * Local fallback extractors in case metaService extractors are undefined or mocked
 */
const localExtractShareCount = (post) => {
  if (!post) return null;
  if (post.shares && typeof post.shares.count === 'number') {
    return post.shares.count;
  }
  if (typeof post.share_count === 'number') {
    return post.share_count;
  }
  return null;
};

const localExtractCommentCount = (post) => {
  if (!post) return null;
  if (post.comments && post.comments.summary && typeof post.comments.summary.total_count === 'number') {
    return post.comments.summary.total_count;
  }
  if (typeof post.comment_count === 'number') {
    return post.comment_count;
  }
  return null;
};

const localExtractReactionCount = (post, insightsData) => {
  if (post && post.reactions && post.reactions.summary && typeof post.reactions.summary.total_count === 'number') {
    return post.reactions.summary.total_count;
  }
  if (post && typeof post.reaction_count === 'number') {
    return post.reaction_count;
  }
  if (typeof metaService.deriveReactionsFromInsights === 'function') {
    return metaService.deriveReactionsFromInsights(insightsData);
  }
  return null;
};

const extractShareCount = (post) => {
  if (typeof metaService.extractShareCount === 'function') {
    return metaService.extractShareCount(post);
  }
  return localExtractShareCount(post);
};

const extractCommentCount = (post) => {
  if (typeof metaService.extractCommentCount === 'function') {
    return metaService.extractCommentCount(post);
  }
  return localExtractCommentCount(post);
};

const extractReactionCount = (post, insightsData) => {
  if (typeof metaService.extractReactionCount === 'function') {
    return metaService.extractReactionCount(post, insightsData);
  }
  return localExtractReactionCount(post, insightsData);
};

const extractReactionBreakdown = (insightsData) => {
  if (typeof metaService.extractReactionBreakdown === 'function') {
    return metaService.extractReactionBreakdown(insightsData);
  }
  if (!Array.isArray(insightsData) || insightsData.length === 0) return null;
  const metric = insightsData.find((i) => i && i.name === 'post_reactions_by_type_total');
  if (!metric || !Array.isArray(metric.values) || metric.values.length === 0) return null;
  const val = metric.values[0]?.value;
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    return val;
  }
  return null;
};

/**
 * Helper to safely extract Facebook post insight metrics without node summary edge fields
 */
const parseFacebookPostMetrics = (p) => {
  const getInsight = (name) => {
    const metric = p.insightsData?.find((i) => i.name === name);
    if (!metric || !Array.isArray(metric.values) || metric.values.length === 0) return null;
    const val = metric.values[0].value;
    return typeof val === 'number' ? val : null;
  };

  const getInsightObject = (name) => {
    const metric = p.insightsData?.find((i) => i.name === name);
    if (!metric || !Array.isArray(metric.values) || metric.values.length === 0) return null;
    const val = metric.values[0].value;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      return val;
    }
    return null;
  };

  const shareCount = extractShareCount(p);
  const reactionCount = extractReactionCount(p, p.insightsData);
  const commentCount = extractCommentCount(p);
  const uniqueMediaViewers = getInsight('post_total_media_view_unique');
  const postMediaViews = getInsight('post_media_view');
  const reactionBreakdown = getInsightObject('post_reactions_by_type_total') || extractReactionBreakdown(p.insightsData);

  let fbPostInteractions = null;
  if (typeof reactionCount === 'number' && typeof commentCount === 'number' && typeof shareCount === 'number') {
    fbPostInteractions = reactionCount + commentCount + shareCount;
  }

  const legacyImpressions = getInsight('post_impressions');
  const legacyReach = getInsight('post_impressions_unique');
  const legacyEngagement = getInsight('post_engaged_users');

  // Documented mappings:
  // - reach: legacy post_impressions_unique if present, else post_total_media_view_unique, else null
  // - views: post_media_view if present, else post_total_media_view_unique, else legacy post_impressions, else null
  // - engagement: legacy post_engaged_users if verified/returned, else null (unsupported on v26.0)
  const reach = legacyReach !== null ? legacyReach : (uniqueMediaViewers !== null ? uniqueMediaViewers : null);
  const views = postMediaViews !== null ? postMediaViews : (uniqueMediaViewers !== null ? uniqueMediaViewers : (legacyImpressions !== null ? legacyImpressions : null));

  return {
    shareCount,
    reactionCount,
    commentCount,
    fbPostInteractions,
    uniqueMediaViewers,
    postMediaViews,
    reactionBreakdown,
    views,
    viewsPeriod: 'lifetime',
    reach,
    reachPeriod: 'lifetime',
    impressions: legacyImpressions,
    engagement: legacyEngagement,
    reactions: {
      total: reactionCount,
      status: reactionCount !== null ? 'AVAILABLE' : (p.insightsError ? 'ERROR' : 'UNAVAILABLE'),
    },
    comments: {
      total: commentCount,
      status: commentCount !== null ? 'AVAILABLE' : 'UNAVAILABLE',
    },
    shares: {
      total: shareCount,
      status: shareCount !== null ? 'AVAILABLE' : 'UNAVAILABLE',
    },
    viewsDetails: {
      total: views,
      period: 'lifetime',
      status: views !== null ? 'AVAILABLE' : (p.insightsError ? 'ERROR' : 'UNAVAILABLE'),
      metricName: postMediaViews !== null ? 'post_media_view' : (uniqueMediaViewers !== null ? 'post_total_media_view_unique' : null),
    },
  };
};

/**
 * Helper to resolve date range and previous period for Facebook Analytics
 */
function resolveDateRange(timeParams = {}) {
  let since = timeParams.since || null;
  let until = timeParams.until || null;
  const datePreset = timeParams.datePreset || (!since && !until ? 'last_28_days' : null);

  let presetDays = 28;
  if (datePreset === 'last_7_days') presetDays = 7;
  else if (datePreset === 'last_30_days') presetDays = 30;
  else if (datePreset === 'last_90_days') presetDays = 90;

  const now = new Date();
  const defaultUntil = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));

  if (since) {
    const s = new Date(since);
    if (isNaN(s.getTime())) {
      const err = new Error('Invalid date parameter: since must be a valid date string (YYYY-MM-DD)');
      err.statusCode = 400;
      throw err;
    }
    since = s.toISOString().split('T')[0];
  }

  if (until) {
    const u = new Date(until);
    if (isNaN(u.getTime())) {
      const err = new Error('Invalid date parameter: until must be a valid date string (YYYY-MM-DD)');
      err.statusCode = 400;
      throw err;
    }
    until = u.toISOString().split('T')[0];
  }

  if (!since && !until) {
    const endDate = defaultUntil;
    const startDate = new Date(endDate.getTime() - (presetDays - 1) * 24 * 60 * 60 * 1000);
    startDate.setUTCHours(0, 0, 0, 0);

    since = startDate.toISOString().split('T')[0];
    until = endDate.toISOString().split('T')[0];
  } else if (since && !until) {
    const sDate = new Date(since + 'T00:00:00.000Z');
    let uDate = defaultUntil;
    if (sDate.getTime() > uDate.getTime()) {
      uDate = new Date(sDate.getTime());
      uDate.setUTCHours(23, 59, 59, 999);
    }
    until = uDate.toISOString().split('T')[0];
  } else if (!since && until) {
    const uDate = new Date(until + 'T23:59:59.999Z');
    const sDate = new Date(uDate.getTime() - (presetDays - 1) * 24 * 60 * 60 * 1000);
    sDate.setUTCHours(0, 0, 0, 0);
    since = sDate.toISOString().split('T')[0];
  }

  const sDate = new Date(since + 'T00:00:00.000Z');
  const uDate = new Date(until + 'T23:59:59.999Z');

  if (sDate.getTime() > uDate.getTime()) {
    const err = new Error('Invalid date range: since parameter must be earlier than or equal to until parameter');
    err.statusCode = 400;
    throw err;
  }

  const diffTime = uDate.getTime() - sDate.getTime();
  const diffDays = Math.max(1, Math.round(diffTime / (24 * 60 * 60 * 1000)));

  // Previous period of identical duration immediately preceding 'since'
  const prevUntilDate = new Date(sDate.getTime() - 1);
  prevUntilDate.setUTCHours(23, 59, 59, 999);
  const prevStartDate = new Date(prevUntilDate.getTime() - (diffDays - 1) * 24 * 60 * 60 * 1000);
  prevStartDate.setUTCHours(0, 0, 0, 0);

  const prevSince = prevStartDate.toISOString().split('T')[0];
  const prevUntil = prevUntilDate.toISOString().split('T')[0];

  return {
    since,
    until,
    preset: datePreset,
    days: diffDays,
    previous: {
      since: prevSince,
      until: prevUntil,
      days: diffDays,
    },
  };
}

/**
 * Normalizes Facebook Page analytics into Business Suite-inspired sections
 */
function buildFacebookAnalyticsReport({
  targetPage,
  pageDetails,
  currentInsights,
  previousInsights = null,
  demographics = null,
  posts = [],
  timeParams = {},
  warnings = [],
}) {
  const extractMetricData = (insightsObj, metricNames, options = {}) => {
    const names = Array.isArray(metricNames) ? metricNames : [metricNames];
    const preferredPeriod = typeof options === 'string' ? options : options.period;
    const exactPeriod = typeof options === 'object' && options.exactPeriod === true;

    if (!insightsObj || !Array.isArray(insightsObj.metrics)) {
      return { status: 'UNAVAILABLE', total: null, timeSeries: [], metricName: names[0], period: preferredPeriod || null };
    }

    let metricItem = null;

    if (preferredPeriod) {
      metricItem = insightsObj.metrics.find((m) => names.includes(m.name) && m.period === preferredPeriod && Array.isArray(m.values) && m.values.length > 0);
      if (!metricItem) {
        metricItem = insightsObj.metrics.find((m) => names.includes(m.name) && m.period === preferredPeriod);
      }
    }

    if (!metricItem && !exactPeriod) {
      for (const name of names) {
        const found = insightsObj.metrics.find((m) => m.name === name && Array.isArray(m.values) && m.values.length > 0);
        if (found) {
          metricItem = found;
          break;
        }
      }
      if (!metricItem) {
        for (const name of names) {
          const found = insightsObj.metrics.find((m) => m.name === name);
          if (found) {
            metricItem = found;
            break;
          }
        }
      }
    }

    if (!metricItem) {
      return { status: 'UNAVAILABLE', total: null, timeSeries: [], metricName: names[0], period: preferredPeriod || null };
    }
    if (!Array.isArray(metricItem.values) || metricItem.values.length === 0) {
      return { status: 'EMPTY', total: null, timeSeries: [], metricName: metricItem.name, period: metricItem.period || preferredPeriod || null };
    }

    const validTimeSeries = [];
    let sum = 0;
    let hasNumericValue = false;

    metricItem.values.forEach((v) => {
      const rawDate = v.endTime || v.end_time || v.date;
      let formattedDate = null;
      if (rawDate) {
        try {
          formattedDate = new Date(rawDate).toISOString().split('T')[0];
        } catch (e) {
          formattedDate = String(rawDate);
        }
      }

      if (typeof v.value === 'number') {
        hasNumericValue = true;
        sum += v.value;
        validTimeSeries.push({
          date: formattedDate,
          value: v.value,
        });
      } else if (typeof v.value === 'object' && v.value !== null && !Array.isArray(v.value)) {
        const objSum = Object.values(v.value).reduce((acc, val) => acc + (typeof val === 'number' ? val : 0), 0);
        hasNumericValue = true;
        sum += objSum;
        validTimeSeries.push({
          date: formattedDate,
          value: objSum,
          breakdown: v.value,
        });
      } else if (v.value === null) {
        validTimeSeries.push({
          date: formattedDate,
          value: null,
        });
      }
    });

    if (!hasNumericValue && validTimeSeries.length === 0) {
      return { status: 'EMPTY', total: null, timeSeries: [], metricName: metricItem.name };
    }

    const isSnapshot = metricItem.name === 'page_follows' || metricItem.name === 'page_fans';
    let total = null;
    let periodChange = null;
    let snapshotLatest = null;
    let snapshotEarliest = null;

    if (hasNumericValue) {
      if (isSnapshot) {
        const sortedNumeric = [...validTimeSeries.filter((e) => typeof e.value === 'number')].sort((a, b) => {
          if (a.date && b.date) return a.date.localeCompare(b.date);
          return 0;
        });
        if (sortedNumeric.length > 0) {
          snapshotEarliest = sortedNumeric[0].value;
          snapshotLatest = sortedNumeric[sortedNumeric.length - 1].value;
          periodChange = snapshotLatest - snapshotEarliest;
          total = periodChange;
        } else {
          total = null;
        }
      } else {
        total = sum;
      }
    }

    return {
      status: hasNumericValue ? 'AVAILABLE' : 'EMPTY',
      total,
      timeSeries: validTimeSeries,
      metricName: metricItem.name,
      period: metricItem.period || preferredPeriod || null,
      isSnapshot,
      ...(isSnapshot ? { periodChange, snapshotLatest, snapshotEarliest } : {}),
    };
  };
  const computeComparison = (currentTotal, prevTotal) => {
    if (typeof currentTotal !== 'number' || typeof prevTotal !== 'number') {
      return null;
    }
    const delta = currentTotal - prevTotal;
    const percentageChange = prevTotal > 0
      ? Number((((currentTotal - prevTotal) / prevTotal) * 100).toFixed(2))
      : null;

    return {
      previousTotal: prevTotal,
      delta,
      percentageChange,
    };
  };

  // Section 1: Performance
  const contentViewsDailyData = extractMetricData(currentInsights, 'page_media_view', { period: 'day' });
  const contentViewsRangeData = extractMetricData(currentInsights, 'page_media_view', { period: 'total_over_range', exactPeriod: true });
  const pageViewsTotalData = extractMetricData(currentInsights, 'page_views_total');

  const prevContentViewsDailyData = extractMetricData(previousInsights, 'page_media_view', { period: 'day' });
  const prevContentViewsRangeData = extractMetricData(previousInsights, 'page_media_view', { period: 'total_over_range', exactPeriod: true });
  const prevPageViewsTotalData = extractMetricData(previousInsights, 'page_views_total');

  // Determine Views:
  // If page_media_view is available, use it (representing total content views across all posts/videos, matching Meta Business Suite Views).
  // Otherwise fall back to page_views_total for backward compatibility with mock tests.
  const hasContentViews = contentViewsRangeData.status === 'AVAILABLE' || contentViewsDailyData.status === 'AVAILABLE';
  const viewsData = hasContentViews
    ? (contentViewsRangeData.status === 'AVAILABLE' ? contentViewsRangeData : contentViewsDailyData)
    : pageViewsTotalData;
  const prevViewsData = hasContentViews
    ? (prevContentViewsRangeData.status === 'AVAILABLE' ? prevContentViewsRangeData : prevContentViewsDailyData)
    : prevPageViewsTotalData;

  const viewersDailyData = extractMetricData(
    currentInsights,
    ['page_total_media_view_unique', 'page_impressions_unique', 'page_views_logout'],
    { period: 'day' }
  );
  const viewersReachData = extractMetricData(
    currentInsights,
    ['page_total_media_view_unique', 'page_impressions_unique'],
    { period: 'total_over_range', exactPeriod: true }
  );

  const prevViewersDailyData = extractMetricData(
    previousInsights,
    ['page_total_media_view_unique', 'page_impressions_unique', 'page_views_logout'],
    { period: 'day' }
  );
  const prevViewersReachData = extractMetricData(
    previousInsights,
    ['page_total_media_view_unique', 'page_impressions_unique'],
    { period: 'total_over_range', exactPeriod: true }
  );

  let viewersTotal = null;
  let viewersStatus = 'UNAVAILABLE';
  let isDeduplicatedReach = false;
  let dailyUniqueViewersSum = null;
  let viewersReason = null;
  let viewersTimeSeries = [];
  const viewersMetricName = viewersReachData.status === 'AVAILABLE'
    ? viewersReachData.metricName
    : (viewersDailyData.metricName || 'page_total_media_view_unique');

  if (viewersReachData.status === 'AVAILABLE' && typeof viewersReachData.total === 'number') {
    // 1. Preferred: True deduplicated reach returned by Meta Graph API (period=total_over_range)
    viewersTotal = viewersReachData.total;
    viewersStatus = 'AVAILABLE';
    isDeduplicatedReach = true;
    viewersTimeSeries = viewersDailyData.status === 'AVAILABLE' ? viewersDailyData.timeSeries : viewersReachData.timeSeries;
    dailyUniqueViewersSum = viewersDailyData.status === 'AVAILABLE' ? viewersDailyData.total : null;
  } else if (viewersDailyData.timeSeries && viewersDailyData.timeSeries.length === 1 && typeof viewersDailyData.total === 'number') {
    // 2. Single-day period: Daily unique viewers is exact deduplicated reach for that single day
    viewersTotal = viewersDailyData.total;
    viewersStatus = 'AVAILABLE';
    isDeduplicatedReach = true;
    viewersTimeSeries = viewersDailyData.timeSeries;
    dailyUniqueViewersSum = viewersDailyData.total;
  } else if (viewersDailyData.status === 'AVAILABLE' && viewersDailyData.timeSeries && viewersDailyData.timeSeries.length > 1) {
    // 3. Multi-day period without total_over_range:
    // Do NOT sum daily unique viewers into period reach to prevent double-counting repeat visitors.
    viewersTotal = null;
    viewersStatus = 'AVAILABLE';
    isDeduplicatedReach = false;
    viewersTimeSeries = viewersDailyData.timeSeries;
    dailyUniqueViewersSum = viewersDailyData.total;
    viewersReason = 'Deduplicated period reach is unavailable from Meta Graph API for this multi-day range. Daily unique viewers cannot be summed across days without double-counting repeat viewers.';
  } else if (viewersDailyData.status === 'EMPTY' || viewersReachData.status === 'EMPTY') {
    viewersStatus = 'EMPTY';
    viewersTotal = null;
    viewersTimeSeries = [];
  } else {
    viewersStatus = 'UNAVAILABLE';
    viewersTotal = null;
    viewersTimeSeries = [];
    viewersReason = 'Page viewers / reach metric (page_total_media_view_unique) is not returned by Meta for this Page.';
  }

  let prevViewersTotal = null;
  if (prevViewersReachData.status === 'AVAILABLE' && typeof prevViewersReachData.total === 'number') {
    prevViewersTotal = prevViewersReachData.total;
  } else if (prevViewersDailyData.timeSeries && prevViewersDailyData.timeSeries.length === 1 && typeof prevViewersDailyData.total === 'number') {
    prevViewersTotal = prevViewersDailyData.total;
  }

  const followsData = extractMetricData(currentInsights, ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_follows']);
  const prevFollowsData = extractMetricData(previousInsights, ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_follows']);

  const unfollowsData = extractMetricData(currentInsights, ['page_daily_unfollows_unique', 'page_fan_removes_unique']);
  const prevUnfollowsData = extractMetricData(previousInsights, ['page_daily_unfollows_unique', 'page_fan_removes_unique']);

  // Net follows calculation
  let netFollowsTotal = null;
  let netFollowsStatus = 'UNAVAILABLE';
  let netFollowsTimeSeries = [];
  let netFollowsReason = null;

  // Only compute net follows when compatible daily flow metrics are available
  // If followsData is a cumulative snapshot (page_follows), we cannot combine it with daily unfollows
  const followsIsFlow = followsData.status === 'AVAILABLE' && !followsData.isSnapshot;
  const unfollowsIsAvailable = unfollowsData.status === 'AVAILABLE';

  if (followsIsFlow && unfollowsIsAvailable) {
    if (typeof followsData.total === 'number' && typeof unfollowsData.total === 'number') {
      netFollowsTotal = followsData.total - unfollowsData.total;
      netFollowsStatus = 'AVAILABLE';

      const unfollowMap = new Map();
      unfollowsData.timeSeries.forEach((u) => {
        if (u.date && typeof u.value === 'number') unfollowMap.set(u.date, u.value);
      });

      followsData.timeSeries.forEach((f) => {
        if (f.date && typeof f.value === 'number' && unfollowMap.has(f.date)) {
          netFollowsTimeSeries.push({
            date: f.date,
            value: f.value - unfollowMap.get(f.date),
          });
        }
      });
    }
  } else if (followsData.isSnapshot) {
    netFollowsStatus = 'UNAVAILABLE';
    netFollowsReason = 'Net follows requires compatible daily flow metrics (e.g. page_daily_follows_unique). Cumulative follower snapshots (page_follows) already reflect net count and cannot be combined with daily unfollows.';
  } else if (followsData.status === 'EMPTY' || unfollowsData.status === 'EMPTY') {
    netFollowsStatus = 'EMPTY';
  }

  let prevNetFollowsTotal = null;
  if (followsIsFlow && unfollowsIsAvailable && typeof prevFollowsData.total === 'number' && typeof prevUnfollowsData.total === 'number' && !prevFollowsData.isSnapshot) {
    prevNetFollowsTotal = prevFollowsData.total - prevUnfollowsData.total;
  }
  // Page visits: query explicit page visits metric candidates, do not duplicate page_views_total
  const pageVisitsData = extractMetricData(currentInsights, ['page_visits', 'page_daily_visits_unique']);
  const prevPageVisitsData = extractMetricData(previousInsights, ['page_visits', 'page_daily_visits_unique']);

  // Content interactions & Post Engagements
  let totalReactions = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalInteractions = 0;
  let hasNumericReaction = false;
  let hasNumericComment = false;
  let hasNumericShare = false;
  let hasNumericPostInteractions = false;

  posts.forEach((p) => {
    const m = p.metrics || {};
    if (typeof m.reactionCount === 'number') {
      totalReactions += m.reactionCount;
      hasNumericReaction = true;
    }
    if (typeof m.commentCount === 'number') {
      totalComments += m.commentCount;
      hasNumericComment = true;
    }
    if (typeof m.shareCount === 'number') {
      totalShares += m.shareCount;
      hasNumericShare = true;
    }
    if (typeof m.fbPostInteractions === 'number') {
      totalInteractions += m.fbPostInteractions;
      hasNumericPostInteractions = true;
    }
  });

  const hasPostWithInteractions = hasNumericReaction || hasNumericComment || hasNumericShare || hasNumericPostInteractions;

  const pageEngagementsData = extractMetricData(currentInsights, 'page_post_engagements');
  const prevPageEngagementsData = extractMetricData(previousInsights, 'page_post_engagements');

  const pageReactionsRangeData = extractMetricData(currentInsights, 'page_actions_post_reactions_total', { period: 'total_over_range', exactPeriod: true });
  const pageReactionsDailyData = extractMetricData(currentInsights, 'page_actions_post_reactions_total', { period: 'day' });
  const pageReactionsData = pageReactionsRangeData.status === 'AVAILABLE' ? pageReactionsRangeData : pageReactionsDailyData;

  let contentInteractionsStatus = 'UNAVAILABLE';
  let contentInteractionsTotal = null;
  let contentInteractionsSource = null;
  let contentInteractionsReason = null;

  if (hasNumericPostInteractions) {
    contentInteractionsStatus = 'AVAILABLE';
    contentInteractionsTotal = totalInteractions;
    contentInteractionsSource = 'content_aggregate';
  } else {
    // Never silently substitute page_post_engagements for contentInteractions.
    // Report honestly as UNAVAILABLE; raw page-level engagements remain explicitly labeled under postEngagements.
    contentInteractionsStatus = 'UNAVAILABLE';
    contentInteractionsTotal = null;
    contentInteractionsSource = null;
    contentInteractionsReason =
      'Content interactions are calculated strictly from post-level reactions, comments, and shares. Post-level interaction metrics are unavailable for the selected period. Raw page-level engagement is preserved separately under postEngagements.';
  }

  // Section 2: Video
  const threeSecondViewsData = extractMetricData(currentInsights, 'page_video_views');
  const prevThreeSecondViewsData = extractMetricData(previousInsights, 'page_video_views');
  const organicVideoViewsData = extractMetricData(currentInsights, 'page_video_views_organic');
  const paidVideoViewsData = extractMetricData(currentInsights, 'page_video_views_paid');

  const watchTimeData = extractMetricData(currentInsights, 'page_video_view_time');
  const prevWatchTimeData = extractMetricData(previousInsights, 'page_video_view_time');

  // Section 3: Audience
  const followerTrendsData = extractMetricData(currentInsights, 'page_fans');

  const performance = {
    views: {
      status: viewsData.status,
      total: viewsData.total,
      timeSeries: contentViewsDailyData.status === 'AVAILABLE' ? contentViewsDailyData.timeSeries : viewsData.timeSeries,
      metricName: viewsData.metricName || 'page_views_total',
      description: viewsData.metricName === 'page_media_view'
        ? 'Content media views across all posts and videos (matching Meta Business Suite Content Overview Views).'
        : 'Profile views / visits to the Facebook Page (labeled "Facebook visits" in Meta Business Suite).',
      comparison: computeComparison(viewsData.total, prevViewsData.total),
    },
    profileViews: {
      status: pageViewsTotalData.status,
      total: pageViewsTotalData.total,
      timeSeries: pageViewsTotalData.timeSeries,
      metricName: 'page_views_total',
      description: 'Profile views / visits to the Facebook Page (labeled "Facebook visits" in Meta Business Suite).',
      comparison: computeComparison(pageViewsTotalData.total, prevPageViewsTotalData.total),
    },
    viewers: {
      status: viewersStatus,
      total: viewersTotal,
      timeSeries: viewersTimeSeries,
      metricName: viewersMetricName,
      isDeduplicatedReach,
      ...(dailyUniqueViewersSum !== null ? { dailyUniqueViewersSum } : {}),
      ...(viewersReachData.status === 'AVAILABLE' ? { reachPeriod: 'total_over_range' } : {}),
      ...(viewersReason ? { reason: viewersReason } : {}),
      comparison: computeComparison(viewersTotal, prevViewersTotal),
    },
    follows: {
      status: followsData.status,
      total: followsData.total,
      timeSeries: followsData.timeSeries,
      metricName: followsData.metricName || 'page_daily_follows_unique',
      isSnapshot: Boolean(followsData.isSnapshot),
      ...(followsData.isSnapshot
        ? {
            periodChange: followsData.periodChange,
            snapshotLatest: followsData.snapshotLatest,
            snapshotEarliest: followsData.snapshotEarliest,
            note: 'Values represent cumulative follower snapshots, not daily new follows. Total reflects period change (latest - earliest).',
          }
        : {}),
      comparison: computeComparison(followsData.total, prevFollowsData.total),
    },
    unfollows: {
      status: unfollowsData.status,
      total: unfollowsData.total,
      timeSeries: unfollowsData.timeSeries,
      metricName: unfollowsData.metricName || 'page_daily_unfollows_unique',
      comparison: computeComparison(unfollowsData.total, prevUnfollowsData.total),
    },
    netFollows: {
      status: netFollowsStatus,
      total: netFollowsTotal,
      timeSeries: netFollowsTimeSeries,
      calculation: followsIsFlow ? 'follows - unfollows' : null,
      comparison: computeComparison(netFollowsTotal, prevNetFollowsTotal),
      ...(netFollowsReason ? { reason: netFollowsReason } : {}),
    },
    pageVisits: {
      status: pageVisitsData.status,
      total: pageVisitsData.total,
      timeSeries: pageVisitsData.timeSeries,
      metricName: pageVisitsData.metricName || 'page_visits',
      pageViewsInsight: pageViewsTotalData.total,
      ...(pageVisitsData.status === 'UNAVAILABLE'
        ? {
            reason:
              'Page visits metric (page_visits) is not supported or returned by Meta Graph API for this Page. Page profile visits are measured by page_views_total (available under profileViews or views).',
          }
        : {}),
      comparison: computeComparison(pageVisitsData.total, prevPageVisitsData.total),
    },
    postEngagements: {
      status: pageEngagementsData.status,
      total: pageEngagementsData.total,
      timeSeries: pageEngagementsData.timeSeries,
      metricName: 'page_post_engagements',
      description: 'Raw page-level post engagements returned by Meta Graph API (clicks, views, reactions, comments).',
      comparison: computeComparison(pageEngagementsData.total, prevPageEngagementsData.total),
    },
    contentInteractions: {
      status: contentInteractionsStatus,
      total: contentInteractionsTotal,
      timeSeries: hasNumericPostInteractions ? pageEngagementsData.timeSeries : [],
      source: contentInteractionsSource,
      breakdown: {
        reactions: hasNumericReaction ? totalReactions : null,
        comments: hasNumericComment ? totalComments : null,
        shares: hasNumericShare ? totalShares : null,
      },
      pageReactionsInsight: pageReactionsData.status === 'AVAILABLE' ? pageReactionsData.total : null,
      pageEngagementsInsight: pageEngagementsData.total,
      ...(contentInteractionsReason ? { reason: contentInteractionsReason } : {}),
      comparison: null,
    },
  };

  const video = {
    threeSecondViews: {
      status: threeSecondViewsData.status,
      total: threeSecondViewsData.total,
      timeSeries: threeSecondViewsData.timeSeries,
      metricName: 'page_video_views',
      organic: organicVideoViewsData.total,
      paid: paidVideoViewsData.total,
      breakdown: (organicVideoViewsData.total !== null || paidVideoViewsData.total !== null)
        ? { organic: organicVideoViewsData.total, paid: paidVideoViewsData.total }
        : null,
      description: 'Total content video views of 3 seconds or more (organic + paid).' + (organicVideoViewsData.total !== null ? ` Organic views: ${organicVideoViewsData.total}.` : ''),
      comparison: computeComparison(threeSecondViewsData.total, prevThreeSecondViewsData.total),
    },
    watchTime: {
      status: watchTimeData.status,
      totalMs: watchTimeData.total,
      totalMinutes: typeof watchTimeData.total === 'number' ? Number((watchTimeData.total / 60000).toFixed(2)) : null,
      timeSeries: watchTimeData.timeSeries,
      metricName: 'page_video_view_time',
      description: 'Total watch time across all video views (organic + paid). Meta Business Suite Content Overview displays organic watch time.',
      comparison: computeComparison(watchTimeData.total, prevWatchTimeData.total),
    },
  };

  const audience = {
    lifetimeFollowers: {
      status: typeof pageDetails?.followersCount === 'number' ? 'AVAILABLE' : 'UNAVAILABLE',
      current: pageDetails?.followersCount ?? null,
      source: 'followers_count',
    },
    lifetimeFans: {
      status: typeof pageDetails?.fanCount === 'number' ? 'AVAILABLE' : 'UNAVAILABLE',
      current: pageDetails?.fanCount ?? null,
      source: 'fan_count',
    },
    follows: {
      status: followsData.status,
      total: followsData.total,
      timeSeries: followsData.timeSeries,
      metricName: followsData.metricName || 'page_daily_follows_unique',
      isSnapshot: Boolean(followsData.isSnapshot),
      ...(followsData.isSnapshot
        ? {
            periodChange: followsData.periodChange,
            snapshotLatest: followsData.snapshotLatest,
            snapshotEarliest: followsData.snapshotEarliest,
            note: 'Values represent cumulative follower snapshots, not daily new follows. Total reflects period change (latest - earliest).',
          }
        : {}),
      comparison: computeComparison(followsData.total, prevFollowsData.total),
    },
    unfollows: {
      status: unfollowsData.status,
      total: unfollowsData.total,
      timeSeries: unfollowsData.timeSeries,
      metricName: unfollowsData.metricName || 'page_daily_unfollows_unique',
      comparison: computeComparison(unfollowsData.total, prevUnfollowsData.total),
    },
    netFollows: {
      status: netFollowsStatus,
      total: netFollowsTotal,
      timeSeries: netFollowsTimeSeries,
      calculation: followsIsFlow ? 'follows - unfollows' : null,
      comparison: computeComparison(netFollowsTotal, prevNetFollowsTotal),
      ...(netFollowsReason ? { reason: netFollowsReason } : {}),
    },
        returningViewers: {
      status: 'UNSUPPORTED_BY_META',
      total: null,
      timeSeries: [],
      reason: 'Returning viewers metric is not exposed via the public Meta Graph API (internal to Meta Business Suite UI only)',
    },
    followerTrends: {
      status: followerTrendsData.status,
      timeSeries: followerTrendsData.timeSeries,
      metricName: 'page_fans',
    },
    demographics: {
      genderAge: {
        status: demographics?.genderAge ? 'AVAILABLE' : 'EMPTY',
        data: demographics?.genderAge || null,
      },
      countries: {
        status: demographics?.countries ? 'AVAILABLE' : 'EMPTY',
        data: demographics?.countries || null,
      },
      cities: {
        status: demographics?.cities ? 'AVAILABLE' : 'EMPTY',
        data: demographics?.cities || null,
      },
      locales: {
        status: demographics?.locales ? 'AVAILABLE' : 'EMPTY',
        data: demographics?.locales || null,
      },
    },
  };

  const content = {
    summary: {
      totalPosts: posts.length,
      totalReactions: hasPostWithInteractions ? totalReactions : null,
      totalComments: hasPostWithInteractions ? totalComments : null,
      totalShares: hasPostWithInteractions ? totalShares : null,
      totalInteractions: hasPostWithInteractions ? totalInteractions : null,
    },
    posts,
  };

  return {
    performance,
    video,
    audience,
    content,
    warnings,
  };
}

/**
 * GET /api/meta/insights/facebook
 * Comprehensive Facebook Business Suite-inspired analytics dashboard
 */
const getFacebookAnalytics = async (userId, queryParams = {}) => {
  const cacheKey = `${String(userId)}:facebook:${queryParams.pageId || ''}:${queryParams.since || ''}:${queryParams.until || ''}:${queryParams.datePreset || ''}`;
  const cached = getQueryCache(cacheKey);
  if (cached) return cached;

  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetPage = resolveFacebookPage(assets, queryParams.pageId);
  if (!capabilities.social?.available || !targetPage) {
    const err = new Error('Facebook Page is not connected or accessible');
    err.statusCode = 404;
    throw err;
  }

  const dateRange = resolveDateRange(queryParams);

  let pageDetails = null;
  try {
    pageDetails = await metaService.getFacebookPageDetails(targetPage.pageId, integration.accessToken, userId);
  } catch (err) {
    const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
    console.log(`[FB_ANALYTICS] Page details error for pageId=${targetPage.pageId}: ${safeMsg}`);
  }

  const insightMetricGroups = [
    { metric: 'page_media_view', period: 'day', group: 'content_views_day' },
    { metric: 'page_media_view', period: 'total_over_range', group: 'content_views_range' },
    { metric: 'page_views_total,page_post_engagements', period: 'day', group: 'activity' },
    { metric: 'page_total_actions', period: 'day', group: 'actions' },
    { metric: 'page_daily_follows_unique,page_daily_unfollows_unique,page_follows', period: 'day', group: 'followers' },
    { metric: 'page_total_media_view_unique', period: 'day', group: 'viewers' },
    { metric: 'page_total_media_view_unique', period: 'total_over_range', group: 'viewers_reach' },
    { metric: 'page_actions_post_reactions_total', period: 'day', group: 'reactions_day' },
    { metric: 'page_actions_post_reactions_total', period: 'total_over_range', group: 'reactions_range' },
    { metric: 'page_video_views,page_video_views_organic,page_video_views_paid', period: 'day', group: 'video_views' },
    { metric: 'page_video_view_time', period: 'total_over_range', group: 'video_watch_time' },
  ];
  const combinedMetricsStr = 'page_media_view,page_views_total,page_post_engagements,page_total_actions,page_daily_follows_unique,page_daily_unfollows_unique,page_follows,page_total_media_view_unique,page_actions_post_reactions_total,page_video_views,page_video_views_organic,page_video_views_paid,page_video_view_time';

  let currentInsights = null;
  let pageInsightsWarning = null;
  if (capabilities.pageInsights?.available) {
    try {
      currentInsights = await metaService.getFacebookPageInsights(
        targetPage.pageId,
        integration.accessToken,
        {
          since: dateRange.since,
          until: dateRange.until,
          metricGroups: insightMetricGroups,
          metric: combinedMetricsStr,
        },
        userId
      );
      if (currentInsights.dataEmpty) {
        pageInsightsWarning = 'Meta returned no Page Insights metric data for the selected Page and date range. In Meta Graph API v20+, Page Insights requires app review permissions (read_insights) and an active page engagement threshold.';
      }
    } catch (err) {
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[FB_ANALYTICS] Current insights error for pageId=${targetPage.pageId}: ${safeMsg}`);
      pageInsightsWarning = `Facebook Page Insights: ${safeMsg}`;
    }
  }

  let previousInsights = null;
  if (capabilities.pageInsights?.available && dateRange.previous) {
    try {
      previousInsights = await metaService.getFacebookPageInsights(
        targetPage.pageId,
        integration.accessToken,
        {
          since: dateRange.previous.since,
          until: dateRange.previous.until,
          metricGroups: insightMetricGroups,
          metric: combinedMetricsStr,
        },
        userId
      );
    } catch (err) {
      previousInsights = null;
    }
  }
  let demographics = null;
  if (capabilities.pageInsights?.available) {
    try {
      const demoResult = await metaService.getFacebookPageDemographics(targetPage.pageId, integration.accessToken, userId);
      demographics = demoResult.demographics;
    } catch (err) {
      demographics = null;
    }
  }

  let normalizedPosts = [];
  try {
    const postsResult = await fetchWithDateBoundary(
      metaService.getFacebookPagePosts,
      targetPage.pageId,
      integration.accessToken,
      { since: dateRange.since, until: dateRange.until, limit: 100 },
      userId,
      'posts',
      targetPage.pageToken
    );
    normalizedPosts = filterPublishedItemsInPeriod(postsResult.items, dateRange.since, dateRange.until).map((p) => {
      const metrics = parseFacebookPostMetrics(p);
      return {
        platform: 'facebook',
        contentId: p.postId,
        id: p.postId,
        message: p.message,
        createdTime: p.createdTime,
        permalinkUrl: p.permalinkUrl,
        permalink: p.permalinkUrl,
        fullPicture: p.fullPicture,
        reactionCount: metrics.reactionCount,
        commentCount: metrics.commentCount,
        shareCount: metrics.shareCount,
        uniqueMediaViewers: metrics.uniqueMediaViewers,
        postMediaViews: metrics.postMediaViews,
        reactionBreakdown: metrics.reactionBreakdown,
        views: metrics.views,
        viewsPeriod: 'lifetime',
        reach: metrics.reach,
        reachPeriod: 'lifetime',
        engagement: metrics.engagement,
        insightsError: p.insightsError || null,
        reactions: {
          total: metrics.reactionCount,
          status: metrics.reactionCount !== null ? 'AVAILABLE' : (p.insightsError ? 'ERROR' : 'UNAVAILABLE'),
        },
        comments: {
          total: metrics.commentCount,
          status: metrics.commentCount !== null ? 'AVAILABLE' : 'UNAVAILABLE',
        },
        shares: {
          total: metrics.shareCount,
          status: metrics.shareCount !== null ? 'AVAILABLE' : 'UNAVAILABLE',
        },
        viewsDetails: {
          total: metrics.views,
          period: 'lifetime',
          status: metrics.views !== null ? 'AVAILABLE' : (p.insightsError ? 'ERROR' : 'UNAVAILABLE'),
          metricName: metrics.postMediaViews !== null ? 'post_media_view' : (metrics.uniqueMediaViewers !== null ? 'post_total_media_view_unique' : null),
        },
        metrics,
      };
    });
    if (postsResult.warning) {
      pageInsightsWarning = pageInsightsWarning ? `${pageInsightsWarning}; ${postsResult.warning}` : postsResult.warning;
    }
  } catch (err) {
    normalizedPosts = [];
  }

  const warnings = [];
  if (pageInsightsWarning) {
    warnings.push(pageInsightsWarning);
  }
  if (Array.isArray(currentInsights?.groupErrors) && currentInsights.groupErrors.length > 0) {
    currentInsights.groupErrors.forEach((ge) => {
      const metricList = ge.metrics ? ge.metrics.join(', ') : 'metric';
      warnings.push(`Meta Page Insights notice: [${metricList}] (${ge.period}) was unavailable: ${ge.error}`);
    });
  }

  const report = buildFacebookAnalyticsReport({
    targetPage,
    pageDetails: pageDetails || { name: targetPage.name, followersCount: null, fanCount: null },
    currentInsights,
    previousInsights,
    demographics,
    posts: normalizedPosts,
    timeParams: queryParams,
    warnings,
  });

  const response = {
    data: {
      pageId: targetPage.pageId,
      pageName: pageDetails?.name || targetPage.name,
      ...report,
    },
    meta: {
      source: 'meta',
      pageId: targetPage.pageId,
      dateRange: {
        since: dateRange.since,
        until: dateRange.until,
        preset: dateRange.preset,
        days: dateRange.days,
        previousPeriod: dateRange.previous,
        timezone: 'UTC',
      },
      capabilities,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };

  setQueryCache(cacheKey, response);
  return response;
};

/**
 * GET /api/meta/insights/content
 * Normalized post and media performance list
 */
const getContentInsights = async (userId, queryParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetPage = resolveFacebookPage(assets, queryParams.pageId);
  const targetIg = resolveInstagramAccount(assets, queryParams.instagramAccountId, queryParams.instagramId);

  const platform = queryParams.platform || 'all';
  let facebookPosts = [];
  let instagramMedia = [];
  let facebookTruncated = false;
  let instagramTruncated = false;

  if ((platform === 'all' || platform === 'facebook') && capabilities.social.available && targetPage) {
    const fbResult = await fetchWithDateBoundary(
      metaService.getFacebookPagePosts,
      targetPage.pageId,
      integration.accessToken,
      queryParams,
      userId,
      'posts',
      targetPage.pageToken
    );
    facebookTruncated = fbResult.paginationTruncated;
    
    facebookPosts = filterPublishedItemsInPeriod(fbResult.items, queryParams.since, queryParams.until).map((p) => {
      const metrics = parseFacebookPostMetrics(p);

      return {
        platform: 'facebook',
        contentId: p.postId,
        id: p.postId,
        message: p.message,
        createdTime: p.createdTime,
        permalinkUrl: p.permalinkUrl,
        permalink: p.permalinkUrl,
        fullPicture: p.fullPicture,
        reactionCount: metrics.reactionCount,
        commentCount: metrics.commentCount,
        shareCount: metrics.shareCount,
        uniqueMediaViewers: metrics.uniqueMediaViewers,
        postMediaViews: metrics.postMediaViews,
        reactionBreakdown: metrics.reactionBreakdown,
        views: metrics.views,
        viewsPeriod: 'lifetime',
        reach: metrics.reach,
        reachPeriod: 'lifetime',
        engagement: metrics.engagement,
        insightsError: p.insightsError || null,
        reactions: {
          total: metrics.reactionCount,
          status: metrics.reactionCount !== null ? 'AVAILABLE' : (p.insightsError ? 'ERROR' : 'UNAVAILABLE'),
        },
        comments: {
          total: metrics.commentCount,
          status: metrics.commentCount !== null ? 'AVAILABLE' : 'UNAVAILABLE',
        },
        shares: {
          total: metrics.shareCount,
          status: metrics.shareCount !== null ? 'AVAILABLE' : 'UNAVAILABLE',
        },
        viewsDetails: {
          total: metrics.views,
          period: 'lifetime',
          status: metrics.views !== null ? 'AVAILABLE' : (p.insightsError ? 'ERROR' : 'UNAVAILABLE'),
          metricName: metrics.postMediaViews !== null ? 'post_media_view' : (metrics.uniqueMediaViewers !== null ? 'post_total_media_view_unique' : null),
        },
        metrics,
      };
    });
  }

  if ((platform === 'all' || platform === 'instagram') && capabilities.instagram.available && targetIg) {
    const igResult = await fetchWithDateBoundary(
      metaService.getInstagramMedia,
      targetIg.instagramAccountId,
      integration.accessToken,
      queryParams,
      userId,
      'media'
    );
    instagramTruncated = igResult.paginationTruncated;

    instagramMedia = filterPublishedItemsInPeriod(igResult.items, queryParams.since, queryParams.until).map((m) => {
      const getInsight = (name) => {
        const metric = m.insightsData?.find((i) => i.name === name || i.name === `carousel_album_${name}`);
        if (!metric || !Array.isArray(metric.values) || metric.values.length === 0) return null;
        const val = metric.values[0].value;
        return typeof val === 'number' ? val : null;
      };

      const likeCount = typeof m.likeCount === 'number' ? m.likeCount : null;
      const commentCount = typeof m.commentCount === 'number' ? m.commentCount : null;
      let igMediaInteractions = null;
      if (typeof likeCount === 'number' && typeof commentCount === 'number') {
        igMediaInteractions = likeCount + commentCount;
      }

      return {
        platform: 'instagram',
        contentId: m.mediaId,
        caption: m.caption,
        createdTime: m.timestamp,
        permalinkUrl: m.permalink,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType,
        metrics: {
          likeCount,
          commentCount,
          igMediaInteractions,
          impressions: getInsight('impressions'),
          reach: getInsight('reach'),
          engagement: getInsight('engagement'),
          saved: getInsight('saved'),
          plays: getInsight('plays'),
        },
      };
    });
  }

  const combinedContent = [...facebookPosts, ...instagramMedia].sort(
    (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
  );

  return {
    data: combinedContent,
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: 'UTC',
      },
      capabilities,
      complete: !(facebookTruncated || instagramTruncated),
      paginationTruncated: facebookTruncated || instagramTruncated,
    },
  };
};

/**
 * GET /api/meta/insights/content/:contentId
 * Secure single post/media drill-down insights endpoint with asset ownership validation
 */
const getSingleContentInsights = async (userId, contentId, queryParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  if (!integration || integration.status !== 'connected' || !integration.accessToken) {
    const err = new Error('Meta integration is not connected');
    err.statusCode = 401;
    throw err;
  }

  const discoveredPageMap = new Map();
  (assets.pages || []).forEach((p) => {
    discoveredPageMap.set(String(p.pageId), p);
  });

  const discoveredIgSet = new Set(
    (assets.instagramAccounts || []).map((ig) => String(ig.instagramAccountId))
  );

  const { platform, assetId } = queryParams;

  // 1. Validate supplied assetId against discovered user assets
  if (assetId) {
    const strAssetId = String(assetId);
    const isOwnedPage = discoveredPageMap.has(strAssetId);
    const isOwnedIg = discoveredIgSet.has(strAssetId);

    if (!isOwnedPage && !isOwnedIg) {
      const err = new Error('Access denied: Specified assetId does not belong to any discovered Page or Instagram Account for this user');
      err.statusCode = 403;
      throw err;
    }
  }

  // 2. Identify target platform & token
  let isInstagram = platform === 'instagram';
  let pageToken = null;

  if (!isInstagram && contentId.includes('_')) {
    const pageIdPrefix = contentId.split('_')[0];
    if (discoveredPageMap.has(pageIdPrefix)) {
      const pageInfo = discoveredPageMap.get(pageIdPrefix);
      pageToken = pageInfo.pageToken;
    } else {
      const err = new Error('Access denied: Content does not belong to any discovered Facebook Page for this user');
      err.statusCode = 403;
      throw err;
    }
  }

  if (!isInstagram && !pageToken) {
    if (assetId && discoveredPageMap.has(String(assetId))) {
      pageToken = discoveredPageMap.get(String(assetId)).pageToken;
    } else if (assets.pages && assets.pages[0]) {
      pageToken = assets.pages[0].pageToken;
    } else {
      const err = new Error('Access denied: No accessible Facebook Pages discovered for this user');
      err.statusCode = 403;
      throw err;
    }
  }

  const accessTokenToUse = isInstagram ? integration.accessToken : pageToken;
  if (!accessTokenToUse) {
    const err = new Error('Access token unavailable for the requested asset');
    err.statusCode = 403;
    throw err;
  }

  // Fetch the selected content directly via Graph API
  const rawItem = await metaService.getSingleContent(contentId, accessTokenToUse, isInstagram, userId);

  // 3. Server-side ownership verification against returned node owner / from field
  if (isInstagram) {
    const ownerId = String(rawItem.owner?.id || '');
    if (!ownerId || !discoveredIgSet.has(ownerId)) {
      const err = new Error('Access denied: Content does not belong to any discovered Instagram Account for this user');
      err.statusCode = 403;
      throw err;
    }

    const getInsight = (name) => {
      const metric = rawItem.insightsData?.find((i) => i.name === name || i.name === `carousel_album_${name}`);
      if (!metric || !Array.isArray(metric.values) || metric.values.length === 0) return null;
      const val = metric.values[0].value;
      return typeof val === 'number' ? val : null;
    };

    const likeCount = typeof rawItem.likeCount === 'number' ? rawItem.likeCount : null;
    const commentCount = typeof rawItem.commentCount === 'number' ? rawItem.commentCount : null;
    let igMediaInteractions = null;
    if (typeof likeCount === 'number' && typeof commentCount === 'number') {
      igMediaInteractions = likeCount + commentCount;
    }

    const formattedContent = {
      platform: 'instagram',
      contentId: rawItem.mediaId,
      caption: rawItem.caption,
      createdTime: rawItem.timestamp,
      permalinkUrl: rawItem.permalink,
      mediaUrl: rawItem.mediaUrl,
      mediaType: rawItem.mediaType,
      metrics: {
        likeCount,
        commentCount,
        igMediaInteractions,
        impressions: getInsight('impressions'),
        reach: getInsight('reach'),
        engagement: getInsight('engagement'),
        saved: getInsight('saved'),
        plays: getInsight('plays'),
      },
    };

    return {
      data: formattedContent,
      meta: {
        source: 'meta',
        capabilities,
      },
    };
  } else {
    // Facebook Post
    const fromId = String(rawItem.from?.id || '');
    if (fromId && !discoveredPageMap.has(fromId)) {
      const err = new Error('Access denied: Content does not belong to any discovered Facebook Page for this user');
      err.statusCode = 403;
      throw err;
    }

    const metrics = parseFacebookPostMetrics(rawItem);
    const formattedContent = {
      platform: 'facebook',
      contentId: rawItem.postId,
      message: rawItem.message,
      createdTime: rawItem.createdTime,
      permalinkUrl: rawItem.permalinkUrl,
      fullPicture: rawItem.fullPicture,
      reactionCount: metrics.reactionCount,
      commentCount: metrics.commentCount,
      shareCount: metrics.shareCount,
      uniqueMediaViewers: metrics.uniqueMediaViewers,
      reactionBreakdown: metrics.reactionBreakdown,
      views: metrics.views,
      reach: metrics.reach,
      engagement: metrics.engagement,
      insightsError: rawItem.insightsError || null,
      metrics,
    };

    return {
      data: formattedContent,
      meta: {
        source: 'meta',
        capabilities,
      },
    };
  }
};

/**
 * GET /api/meta/insights/ads
 * Advertising Insights for an Ad Account
 */
const getAdsInsights = async (userId, queryParams = {}) => {
  const cacheKey = `${String(userId)}:ads:${queryParams.adAccountId || ''}:${queryParams.level || 'account'}:${queryParams.since || ''}:${queryParams.until || ''}:${queryParams.datePreset || ''}:${queryParams.limit || ''}:${queryParams.after || ''}`;
  const cached = getQueryCache(cacheKey);
  if (cached) return cached;

  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetAdAcc = resolveAdAccount(assets, queryParams.adAccountId);

  if (!capabilities.ads.available || !targetAdAcc) {
    return {
      data: null,
      meta: {
        source: 'meta',
        dateRange: {
          since: queryParams.since || null,
          until: queryParams.until || null,
          preset: queryParams.datePreset || null,
          timezone: 'UTC',
        },
        capabilities,
      },
    };
  }

  const targetAdAccId = targetAdAcc.adAccountId;
  const result = await metaService.getAdsInsights(targetAdAccId, integration.accessToken, queryParams, userId);

  const response = {
    data: {
      adAccountId: targetAdAccId,
      currency: targetAdAcc.currency,
      timezone: targetAdAcc.timezone,
      insights: result.insights,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: targetAdAcc.timezone || 'UTC',
      },
      capabilities,
    },
  };

  setQueryCache(cacheKey, response);
  return response;
};

/**
 * GET /api/meta/insights/campaigns
 * Campaign-level breakdown with currency-aware budget formatting
 */
const getCampaignInsights = async (userId, queryParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetAdAcc = resolveAdAccount(assets, queryParams.adAccountId);

  if (!capabilities.ads.available || !targetAdAcc) {
    return {
      data: null,
      meta: {
        source: 'meta',
        dateRange: {
          since: queryParams.since || null,
          until: queryParams.until || null,
          preset: queryParams.datePreset || null,
          timezone: 'UTC',
        },
        capabilities,
      },
    };
  }

  const targetAdAccId = targetAdAcc.adAccountId;
  const divisor = getCurrencyDivisor(targetAdAcc.currency);

  const campaignResult = await metaService.getCampaigns(targetAdAccId, integration.accessToken, queryParams, userId);
  
  let campaignInsights = [];
  try {
    let currentAfter = null;
    let hasNext = true;
    let pagesFetched = 0;
    while (hasNext && pagesFetched < 5) {
      const insParams = { ...queryParams, level: 'campaign', limit: 100 };
      if (currentAfter) insParams.after = currentAfter;
      const insightsResult = await metaService.getAdsInsights(targetAdAccId, integration.accessToken, insParams, userId);
      const rows = insightsResult.insights || [];
      campaignInsights = campaignInsights.concat(rows);
      pagesFetched++;
      if (insightsResult.pagination?.hasNextPage && insightsResult.pagination?.cursors?.after) {
        currentAfter = insightsResult.pagination.cursors.after;
      } else {
        hasNext = false;
      }
    }
  } catch (err) {
    // Graceful degradation: metadata still available
  }

  const campaignInsightMap = new Map();
  campaignInsights.forEach((i) => {
    if (i.campaignId) campaignInsightMap.set(String(i.campaignId), i);
  });

  const normalizedCampaigns = campaignResult.campaigns.map((c) => {
    const insights = campaignInsightMap.get(String(c.campaignId)) || {};
    return {
      campaignId: c.campaignId,
      name: c.name,
      status: c.status,
      effectiveStatus: c.effectiveStatus,
      objective: c.objective,
      buyingType: c.buyingType,
      startTime: c.startTime,
      stopTime: c.stopTime,
      budget: {
        currency: targetAdAcc.currency,
        dailyBudgetSubunits: typeof c.dailyBudget === 'number' ? c.dailyBudget : null,
        dailyBudgetFormatted: typeof c.dailyBudget === 'number' ? Number((c.dailyBudget / divisor).toFixed(2)) : null,
        lifetimeBudgetSubunits: typeof c.lifetimeBudget === 'number' ? c.lifetimeBudget : null,
        lifetimeBudgetFormatted: typeof c.lifetimeBudget === 'number' ? Number((c.lifetimeBudget / divisor).toFixed(2)) : null,
      },
      spend: insights.spend !== undefined ? insights.spend : null,
      impressions: insights.impressions !== undefined ? insights.impressions : null,
      reach: insights.reach !== undefined ? insights.reach : null,
      clicks: insights.clicks !== undefined ? insights.clicks : null,
      ctr: insights.ctr !== undefined ? insights.ctr : null,
      cpc: insights.cpc !== undefined ? insights.cpc : null,
      cpm: insights.cpm !== undefined ? insights.cpm : null,
      actions: insights.actions || [],
      costPerActionType: insights.costPerActionType || [],
    };
  });

  return {
    data: {
      adAccountId: targetAdAccId,
      currency: targetAdAcc.currency,
      campaigns: normalizedCampaigns,
      pagination: campaignResult.pagination,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: targetAdAcc.timezone || 'UTC',
      },
      capabilities,
    },
  };
};

/**
 * GET /api/meta/insights/adsets
 * AdSet-level breakdown with currency-aware budget formatting
 */
const getAdSetInsights = async (userId, queryParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetAdAcc = resolveAdAccount(assets, queryParams.adAccountId);

  if (!capabilities.ads.available || !targetAdAcc) {
    return {
      data: null,
      meta: {
        source: 'meta',
        dateRange: {
          since: queryParams.since || null,
          until: queryParams.until || null,
          preset: queryParams.datePreset || null,
          timezone: 'UTC',
        },
        capabilities,
      },
    };
  }

  const targetAdAccId = targetAdAcc.adAccountId;
  const divisor = getCurrencyDivisor(targetAdAcc.currency);

  const adSetResult = await metaService.getAdSets(targetAdAccId, integration.accessToken, queryParams, userId);
  
  let adSetInsights = [];
  try {
    let currentAfter = null;
    let hasNext = true;
    let pagesFetched = 0;
    while (hasNext && pagesFetched < 5) {
      const insParams = { ...queryParams, level: 'adset', limit: 100 };
      if (currentAfter) insParams.after = currentAfter;
      const insightsResult = await metaService.getAdsInsights(targetAdAccId, integration.accessToken, insParams, userId);
      const rows = insightsResult.insights || [];
      adSetInsights = adSetInsights.concat(rows);
      pagesFetched++;
      if (insightsResult.pagination?.hasNextPage && insightsResult.pagination?.cursors?.after) {
        currentAfter = insightsResult.pagination.cursors.after;
      } else {
        hasNext = false;
      }
    }
  } catch (err) {
    // Graceful degradation: metadata still available
  }

  const adSetInsightMap = new Map();
  adSetInsights.forEach((i) => {
    if (i.adSetId) adSetInsightMap.set(String(i.adSetId), i);
  });

  const normalizedAdSets = adSetResult.adSets.map((adSet) => {
    const insights = adSetInsightMap.get(String(adSet.adSetId)) || {};
    return {
      adSetId: adSet.adSetId,
      campaignId: adSet.campaignId,
      name: adSet.name,
      status: adSet.status,
      effectiveStatus: adSet.effectiveStatus,
      optimizationGoal: adSet.optimizationGoal,
      billingEvent: adSet.billingEvent,
      startTime: adSet.startTime,
      endTime: adSet.endTime,
      budget: {
        currency: targetAdAcc.currency,
        dailyBudgetSubunits: typeof adSet.dailyBudget === 'number' ? adSet.dailyBudget : null,
        dailyBudgetFormatted: typeof adSet.dailyBudget === 'number' ? Number((adSet.dailyBudget / divisor).toFixed(2)) : null,
        lifetimeBudgetSubunits: typeof adSet.lifetimeBudget === 'number' ? adSet.lifetimeBudget : null,
        lifetimeBudgetFormatted: typeof adSet.lifetimeBudget === 'number' ? Number((adSet.lifetimeBudget / divisor).toFixed(2)) : null,
      },
      spend: insights.spend !== undefined ? insights.spend : null,
      impressions: insights.impressions !== undefined ? insights.impressions : null,
      reach: insights.reach !== undefined ? insights.reach : null,
      clicks: insights.clicks !== undefined ? insights.clicks : null,
      ctr: insights.ctr !== undefined ? insights.ctr : null,
      cpc: insights.cpc !== undefined ? insights.cpc : null,
      cpm: insights.cpm !== undefined ? insights.cpm : null,
      actions: insights.actions || [],
      costPerActionType: insights.costPerActionType || [],
    };
  });

  return {
    data: {
      adAccountId: targetAdAccId,
      currency: targetAdAcc.currency,
      adSets: normalizedAdSets,
      pagination: adSetResult.pagination,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: targetAdAcc.timezone || 'UTC',
      },
      capabilities,
    },
  };
};

/**
 * GET /api/meta/insights/ads-level
 * Ad-level breakdown
 */
const getAdInsights = async (userId, queryParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetAdAcc = resolveAdAccount(assets, queryParams.adAccountId);

  if (!capabilities.ads.available || !targetAdAcc) {
    return {
      data: null,
      meta: {
        source: 'meta',
        dateRange: {
          since: queryParams.since || null,
          until: queryParams.until || null,
          preset: queryParams.datePreset || null,
          timezone: 'UTC',
        },
        capabilities,
      },
    };
  }

  const targetAdAccId = targetAdAcc.adAccountId;

  const adResult = await metaService.getAds(targetAdAccId, integration.accessToken, queryParams, userId);
  
  let adInsightsData = [];
  try {
    let currentAfter = null;
    let hasNext = true;
    let pagesFetched = 0;
    while (hasNext && pagesFetched < 5) {
      const insParams = { ...queryParams, level: 'ad', limit: 100 };
      if (currentAfter) insParams.after = currentAfter;
      const insightsResult = await metaService.getAdsInsights(targetAdAccId, integration.accessToken, insParams, userId);
      const rows = insightsResult.insights || [];
      adInsightsData = adInsightsData.concat(rows);
      pagesFetched++;
      if (insightsResult.pagination?.hasNextPage && insightsResult.pagination?.cursors?.after) {
        currentAfter = insightsResult.pagination.cursors.after;
      } else {
        hasNext = false;
      }
    }
  } catch (err) {
    // Graceful degradation: metadata still available
  }

  const adInsightMap = new Map();
  adInsightsData.forEach((i) => {
    if (i.adId) adInsightMap.set(String(i.adId), i);
  });

  const normalizedAds = adResult.ads.map((ad) => {
    const insights = adInsightMap.get(String(ad.adId)) || {};
    return {
      adId: ad.adId,
      campaignId: ad.campaignId,
      adSetId: ad.adSetId,
      name: ad.name,
      status: ad.status,
      effectiveStatus: ad.effectiveStatus,
      createdTime: ad.createdTime,
      updatedTime: ad.updatedTime,
      spend: insights.spend !== undefined ? insights.spend : null,
      impressions: insights.impressions !== undefined ? insights.impressions : null,
      reach: insights.reach !== undefined ? insights.reach : null,
      clicks: insights.clicks !== undefined ? insights.clicks : null,
      ctr: insights.ctr !== undefined ? insights.ctr : null,
      cpc: insights.cpc !== undefined ? insights.cpc : null,
      cpm: insights.cpm !== undefined ? insights.cpm : null,
      actions: insights.actions || [],
      costPerActionType: insights.costPerActionType || [],
    };
  });

  return {
    data: {
      adAccountId: targetAdAccId,
      currency: targetAdAcc.currency,
      ads: normalizedAds,
      pagination: adResult.pagination,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: targetAdAcc.timezone || 'UTC',
      },
      capabilities,
    },
  };
};

module.exports = {
  deriveClientRequirements,
  getCurrencyDivisor,
  evaluateCapabilities,
  parseFacebookPostMetrics,
  getOverview,
  getSocialInsights,
  getContentInsights,
  getSingleContentInsights,
  getAdsInsights,
  getCampaignInsights,
  getAdSetInsights,
  getAdInsights,
  invalidateUserCache,
  setContextCache,
  getUserContextAndAssets,
  resolveDateRange,
  buildFacebookAnalyticsReport,
  getFacebookAnalytics,
  deriveReactionsFromInsights: metaService.deriveReactionsFromInsights,
  extractShareCount,
  extractCommentCount,
  extractReactionCount,
  extractReactionBreakdown,
};
