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

  // 1. Social (Facebook Pages) Capability
  let social = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected' };
  if (!requirements.requireSocial) {
    social = { available: false, code: 'REQUIREMENT_DISABLED', reason: 'Social capability is disabled for user plan/tier' };
  } else if (!isConnected) {
    social = { available: false, code: 'NOT_CONNECTED', reason: 'Meta account is not connected or authorization has expired' };
  } else if (!grantedScopes.has('pages_show_list') && !grantedScopes.has('pages_read_engagement')) {
    social = { available: false, code: 'PERMISSION_DENIED', reason: 'Required Meta permissions (pages_show_list, pages_read_engagement) not granted' };
  } else if (pages.length === 0) {
    social = { available: false, code: 'ASSET_NOT_FOUND', reason: 'No accessible Facebook Pages discovered' };
  } else {
    social = { available: true, code: 'AVAILABLE', reason: null };
  }

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
      const totalSpend = rows.reduce((sum, r) => sum + r.spend, 0);
      const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);
      const totalClicks = rows.reduce((sum, r) => sum + r.clicks, 0);
      const totalReach = rows.reduce((sum, r) => sum + r.reach, 0);

      const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
      const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;

      adsOverview = {
        adAccountId: targetAdAcc.adAccountId,
        adAccountName: targetAdAcc.name,
        currency: targetAdAcc.currency,
        timezone: targetAdAcc.timezone,
        spend: Number(totalSpend.toFixed(2)),
        impressions: totalImpressions,
        clicks: totalClicks,
        reach: totalReach,
        ctr: Number(ctr.toFixed(4)),
        cpc: Number(cpc.toFixed(4)),
        cpm: Number(cpm.toFixed(4)),
      };
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
      const pageInsights = await metaService.getFacebookPageInsights(targetPage.pageId, integration.accessToken, timeParams, userId);

      socialOverview = {
        pageId: targetPage.pageId,
        pageName: pageDetails.name,
        followersCount: pageDetails.followersCount,
        fanCount: pageDetails.fanCount,
        metrics: pageInsights.metrics || [],
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

  return {
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
};

/**
 * GET /api/meta/insights/social
 * Facebook Page & Instagram performance metrics
 */
const getSocialInsights = async (userId, queryParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const targetPage = resolveFacebookPage(assets, queryParams.pageId);
  const targetIg = resolveInstagramAccount(assets, queryParams.instagramAccountId, queryParams.instagramId);

  let pageData = null;
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
      try {
        const insights = await metaService.getFacebookPageInsights(targetPage.pageId, integration.accessToken, queryParams, userId);
        insightsMetrics = insights.metrics || [];
      } catch (err) {
        const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
        console.log(`[SOCIAL_INSIGHTS] Page insights error for pageId=${targetPage.pageId}: ${safeMsg}`);
      }

      pageData = {
        details,
        insights: insightsMetrics,
      };
    }
  }

  let instagramData = null;
  if (capabilities.instagram.available && targetIg) {
    try {
      const insights = await metaService.getInstagramInsights(targetIg.instagramAccountId, integration.accessToken, queryParams, userId);
      instagramData = {
        instagramAccountId: targetIg.instagramAccountId,
        insights: insights.metrics || [],
      };
    } catch (err) {
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[SOCIAL_INSIGHTS] Instagram insights error for instagramAccountId=${targetIg.instagramAccountId}: ${safeMsg}`);
      instagramData = null;
    }
  }

  return {
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
    },
  };
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
  const MAX_PAGES = 50; // Guard against unbounded loops
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
 * Helper to safely extract Facebook post insight metrics without node summary edge fields
 */
const parseFacebookPostMetrics = (p) => {
  const getInsight = (name) => {
    const metric = p.insightsData?.find((i) => i.name === name);
    return metric && metric.values && metric.values.length > 0 ? metric.values[0].value : null;
  };

  const activityMetric = p.insightsData?.find((i) => i.name === 'post_activity_by_action_type');
  let reactionCount = null;
  let commentCount = null;
  let shareCount = p.shareCount !== undefined ? p.shareCount : 0;

  if (activityMetric && activityMetric.values && activityMetric.values.length > 0) {
    const activityObj = activityMetric.values[0].value;
    if (activityObj && typeof activityObj === 'object') {
      if (typeof activityObj.comment === 'number') {
        commentCount = activityObj.comment;
      }

      let sumReactions = 0;
      let hasReactionKey = false;
      const reactionKeys = ['like', 'love', 'wow', 'haha', 'sorry', 'anger', 'reaction'];
      Object.keys(activityObj).forEach((key) => {
        if (reactionKeys.includes(key.toLowerCase()) && typeof activityObj[key] === 'number') {
          sumReactions += activityObj[key];
          hasReactionKey = true;
        }
      });
      if (hasReactionKey) {
        reactionCount = sumReactions;
      }

      if (typeof activityObj.share === 'number' && !shareCount) {
        shareCount = activityObj.share;
      }
    }
  }

  let fbPostInteractions = null;
  if (reactionCount !== null || commentCount !== null || shareCount !== null) {
    fbPostInteractions = (reactionCount || 0) + (commentCount || 0) + (shareCount || 0);
  }

  return {
    shareCount,
    reactionCount,
    commentCount,
    fbPostInteractions,
    impressions: getInsight('post_impressions'),
    reach: getInsight('post_impressions_unique'),
    engagement: getInsight('post_engaged_users'),
  };
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
        message: p.message,
        createdTime: p.createdTime,
        permalinkUrl: p.permalinkUrl,
        fullPicture: p.fullPicture,
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
        const metric = m.insightsData?.find((i) => i.name === name);
        return metric && metric.values && metric.values.length > 0 ? metric.values[0].value : null;
      };

      return {
        platform: 'instagram',
        contentId: m.mediaId,
        caption: m.caption,
        createdTime: m.timestamp,
        permalinkUrl: m.permalink,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType,
        metrics: {
          likeCount: m.likeCount,
          commentCount: m.commentCount,
          igMediaInteractions: m.likeCount + m.commentCount,
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
      const metric = rawItem.insightsData?.find((i) => i.name === name);
      return metric && metric.values && metric.values.length > 0 ? metric.values[0].value : null;
    };

    const formattedContent = {
      platform: 'instagram',
      contentId: rawItem.mediaId,
      caption: rawItem.caption,
      createdTime: rawItem.timestamp,
      permalinkUrl: rawItem.permalink,
      mediaUrl: rawItem.mediaUrl,
      mediaType: rawItem.mediaType,
      metrics: {
        likeCount: rawItem.likeCount,
        commentCount: rawItem.commentCount,
        igMediaInteractions: rawItem.likeCount + rawItem.commentCount,
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

  return {
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
    const insightsResult = await metaService.getAdsInsights(targetAdAccId, integration.accessToken, { ...queryParams, level: 'campaign', limit: 100 }, userId);
    campaignInsights = insightsResult.insights || [];
  } catch (err) {
    // Graceful degradation: metadata still available
  }

  const normalizedCampaigns = campaignResult.campaigns.map((c) => {
    const insights = campaignInsights.find((i) => i.campaignId === c.campaignId) || {};
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
        dailyBudgetSubunits: c.dailyBudget, // Raw integer subunits
        dailyBudgetFormatted: c.dailyBudget ? Number((c.dailyBudget / divisor).toFixed(2)) : null,
        lifetimeBudgetSubunits: c.lifetimeBudget,
        lifetimeBudgetFormatted: c.lifetimeBudget ? Number((c.lifetimeBudget / divisor).toFixed(2)) : null,
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
    const insightsResult = await metaService.getAdsInsights(targetAdAccId, integration.accessToken, { ...queryParams, level: 'adset', limit: 100 }, userId);
    adSetInsights = insightsResult.insights || [];
  } catch (err) {
    // Graceful degradation: metadata still available
  }

  const normalizedAdSets = adSetResult.adSets.map((adSet) => {
    const insights = adSetInsights.find((i) => i.adSetId === adSet.adSetId) || {};
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
        dailyBudgetSubunits: adSet.dailyBudget, // Raw integer subunits
        dailyBudgetFormatted: adSet.dailyBudget ? Number((adSet.dailyBudget / divisor).toFixed(2)) : null,
        lifetimeBudgetSubunits: adSet.lifetimeBudget,
        lifetimeBudgetFormatted: adSet.lifetimeBudget ? Number((adSet.lifetimeBudget / divisor).toFixed(2)) : null,
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
    const insightsResult = await metaService.getAdsInsights(targetAdAccId, integration.accessToken, { ...queryParams, level: 'ad', limit: 100 }, userId);
    adInsightsData = insightsResult.insights || [];
  } catch (err) {
    // Graceful degradation: metadata still available
  }

  const normalizedAds = adResult.ads.map((ad) => {
    const insights = adInsightsData.find((i) => i.adId === ad.adId) || {};
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
  getOverview,
  getSocialInsights,
  getContentInsights,
  getSingleContentInsights,
  getAdsInsights,
  getCampaignInsights,
  getAdSetInsights,
  getAdInsights,
  invalidateUserCache,
  getUserContextAndAssets,
};
