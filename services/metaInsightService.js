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

  const startDate = since ? new Date(since) : null;
  const endDate = until ? new Date(until) : null;

  return items.filter((item) => {
    const itemDate = new Date(item.createdTime || item.timestamp || item.created_time);
    if (isNaN(itemDate.getTime())) return true;
    if (startDate && itemDate < startDate) return false;
    if (endDate && itemDate > endDate) return false;
    return true;
  });
};

/**
 * Fetches user context, integration, and assets safely
 */
const getUserContextAndAssets = async (userId) => {
  const user = await User.findById(userId);
  const tenant = user?.tenantId ? await Tenant.findById(user.tenantId) : null;
  const integration = await MetaIntegration.findOne({ userId });

  let assets = { pages: [], instagramAccounts: [], adAccounts: [] };
  if (integration && integration.accessToken && integration.status === 'connected') {
    try {
      assets = await metaService.discoverAssets(integration.accessToken, userId);
    } catch (err) {
      assets = { pages: [], instagramAccounts: [], adAccounts: [] };
    }
  }

  const capabilities = evaluateCapabilities(integration, user, tenant, assets);

  return {
    user,
    tenant,
    integration,
    assets,
    capabilities,
  };
};

/**
 * GET /api/meta/insights/overview
 * Executive summary across Social and Ads
 */
const getOverview = async (userId, timeParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  let adsOverview = null;
  if (capabilities.ads.available && assets.adAccounts.length > 0) {
    const defaultAdAcc = assets.adAccounts[0];
    try {
      const insightsResult = await metaService.getAdsInsights(
        defaultAdAcc.adAccountId,
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
        adAccountId: defaultAdAcc.adAccountId,
        adAccountName: defaultAdAcc.name,
        currency: defaultAdAcc.currency,
        timezone: defaultAdAcc.timezone,
        spend: Number(totalSpend.toFixed(2)),
        impressions: totalImpressions,
        clicks: totalClicks,
        reach: totalReach,
        ctr: Number(ctr.toFixed(4)),
        cpc: Number(cpc.toFixed(4)),
        cpm: Number(cpm.toFixed(4)),
      };
    } catch (err) {
      adsOverview = null;
    }
  }

  let socialOverview = null;
  if (capabilities.social.available && assets.pages.length > 0) {
    const defaultPage = assets.pages[0];
    try {
      const pageDetails = await metaService.getFacebookPageDetails(defaultPage.pageId, integration.accessToken, userId);
      const pageInsights = await metaService.getFacebookPageInsights(defaultPage.pageId, integration.accessToken, timeParams, userId);

      socialOverview = {
        pageId: defaultPage.pageId,
        pageName: pageDetails.name,
        followersCount: pageDetails.followersCount,
        fanCount: pageDetails.fanCount,
        metrics: pageInsights.metrics || [],
      };
    } catch (err) {
      socialOverview = null;
    }
  }

  let instagramOverview = null;
  let instagramTruncated = false;
  if (capabilities.instagram.available && assets.instagramAccounts.length > 0) {
    const defaultIg = assets.instagramAccounts[0];
    try {
      const allMediaResult = await fetchWithDateBoundary(
        metaService.getInstagramMedia,
        defaultIg.instagramAccountId,
        integration.accessToken,
        timeParams,
        userId,
        'media'
      );
      const inPeriodMedia = filterPublishedItemsInPeriod(allMediaResult.items, timeParams.since, timeParams.until);
      instagramTruncated = allMediaResult.paginationTruncated;

      instagramOverview = {
        instagramAccountId: defaultIg.instagramAccountId,
        username: defaultIg.username,
        followersCount: defaultIg.followersCount,
        lifetimeMediaCatalogCount: defaultIg.mediaCount, // Profile lifetime static count
        publishedMediaInPeriod: inPeriodMedia.length, // Time-bounded published count
      };
    } catch (err) {
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
        timezone: assets.adAccounts[0]?.timezone || 'UTC',
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

  const targetPageId = queryParams.pageId || (assets.pages[0] ? assets.pages[0].pageId : null);
  const targetIgId = queryParams.instagramAccountId || (assets.instagramAccounts[0] ? assets.instagramAccounts[0].instagramAccountId : null);

  let pageData = null;
  if (capabilities.social.available && targetPageId) {
    try {
      const details = await metaService.getFacebookPageDetails(targetPageId, integration.accessToken, userId);
      const insights = await metaService.getFacebookPageInsights(targetPageId, integration.accessToken, queryParams, userId);
      pageData = {
        details,
        insights: insights.metrics,
      };
    } catch (err) {
      pageData = null;
    }
  }

  let instagramData = null;
  if (capabilities.instagram.available && targetIgId) {
    try {
      const insights = await metaService.getInstagramInsights(targetIgId, integration.accessToken, queryParams, userId);
      instagramData = {
        instagramAccountId: targetIgId,
        insights: insights.metrics,
      };
    } catch (err) {
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
const fetchWithDateBoundary = async (fetchFn, id, accessToken, queryParams, userId, dataKey) => {
  let allItems = [];
  let currentAfter = queryParams.after || null;
  let hasNext = true;
  const limit = queryParams.limit || 25;
  const startDate = queryParams.since ? new Date(queryParams.since) : null;

  let pageCount = 0;
  const MAX_PAGES = 50; // Guard against unbounded loops
  let isTruncated = false;

  while (hasNext && pageCount < MAX_PAGES) {
    pageCount++;
    const params = { ...queryParams, limit, after: currentAfter };
    const result = await fetchFn(id, accessToken, params, userId);
    
    const items = result[dataKey] || [];
    allItems = allItems.concat(items);

    if (items.length === 0) break;
    
    const oldestItem = items[items.length - 1];
    const oldestDate = new Date(oldestItem.createdTime || oldestItem.timestamp);
    
    // Stop paginating if oldest item is strictly older than startDate
    if (startDate && !isNaN(oldestDate.getTime()) && oldestDate < startDate) {
      break;
    }
    
    if (result.pagination && result.pagination.hasNextPage) {
      currentAfter = result.pagination.cursors.after;
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
 * GET /api/meta/insights/content
 * Normalized post and media performance list
 */
const getContentInsights = async (userId, queryParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  const platform = queryParams.platform || 'all';
  let facebookPosts = [];
  let instagramMedia = [];
  let facebookTruncated = false;
  let instagramTruncated = false;

  if ((platform === 'all' || platform === 'facebook') && capabilities.social.available && assets.pages[0]) {
    try {
      const fbResult = await fetchWithDateBoundary(
        metaService.getFacebookPagePosts,
        assets.pages[0].pageId,
        integration.accessToken,
        queryParams,
        userId,
        'posts'
      );
      facebookTruncated = fbResult.paginationTruncated;
      
      facebookPosts = filterPublishedItemsInPeriod(fbResult.items, queryParams.since, queryParams.until).map((p) => {
        const getInsight = (name) => {
          const metric = p.insightsData?.find((i) => i.name === name);
          return metric && metric.values && metric.values.length > 0 ? metric.values[0].value : null;
        };

        return {
          platform: 'facebook',
          contentId: p.postId,
          message: p.message,
          createdTime: p.createdTime,
          permalinkUrl: p.permalinkUrl,
          fullPicture: p.fullPicture,
          metrics: {
            shareCount: p.shareCount,
            reactionCount: p.reactionCount,
            commentCount: p.commentCount,
            fbPostInteractions: p.reactionCount + p.commentCount + p.shareCount,
            impressions: getInsight('post_impressions'),
            reach: getInsight('post_impressions_unique'),
            engagement: getInsight('post_engaged_users'),
          },
        };
      });
    } catch (err) {
      facebookPosts = [];
    }
  }

  if ((platform === 'all' || platform === 'instagram') && capabilities.instagram.available && assets.instagramAccounts[0]) {
    try {
      const igResult = await fetchWithDateBoundary(
        metaService.getInstagramMedia,
        assets.instagramAccounts[0].instagramAccountId,
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
    } catch (err) {
      instagramMedia = [];
    }
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
 * GET /api/meta/insights/ads
 * Advertising Insights for an Ad Account
 */
const getAdsInsights = async (userId, queryParams = {}) => {
  const ctx = await getUserContextAndAssets(userId);
  const { integration, assets, capabilities } = ctx;

  if (!capabilities.ads.available || assets.adAccounts.length === 0) {
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

  const targetAdAccId = queryParams.adAccountId || assets.adAccounts[0].adAccountId;
  const adAccInfo = assets.adAccounts.find((a) => a.adAccountId === targetAdAccId) || assets.adAccounts[0];

  const result = await metaService.getAdsInsights(targetAdAccId, integration.accessToken, queryParams, userId);

  return {
    data: {
      adAccountId: targetAdAccId,
      currency: adAccInfo.currency,
      timezone: adAccInfo.timezone,
      insights: result.insights,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: adAccInfo.timezone || 'UTC',
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

  if (!capabilities.ads.available || assets.adAccounts.length === 0) {
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

  const targetAdAccId = queryParams.adAccountId || assets.adAccounts[0].adAccountId;
  const adAccInfo = assets.adAccounts.find((a) => a.adAccountId === targetAdAccId) || assets.adAccounts[0];
  const divisor = getCurrencyDivisor(adAccInfo.currency);

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
        currency: adAccInfo.currency,
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
      currency: adAccInfo.currency,
      campaigns: normalizedCampaigns,
      pagination: campaignResult.pagination,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: adAccInfo.timezone || 'UTC',
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

  if (!capabilities.ads.available || assets.adAccounts.length === 0) {
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

  const targetAdAccId = queryParams.adAccountId || assets.adAccounts[0].adAccountId;
  const adAccInfo = assets.adAccounts.find((a) => a.adAccountId === targetAdAccId) || assets.adAccounts[0];
  const divisor = getCurrencyDivisor(adAccInfo.currency);

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
        currency: adAccInfo.currency,
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
      currency: adAccInfo.currency,
      adSets: normalizedAdSets,
      pagination: adSetResult.pagination,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: adAccInfo.timezone || 'UTC',
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

  if (!capabilities.ads.available || assets.adAccounts.length === 0) {
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

  const targetAdAccId = queryParams.adAccountId || assets.adAccounts[0].adAccountId;
  const adAccInfo = assets.adAccounts.find((a) => a.adAccountId === targetAdAccId) || assets.adAccounts[0];

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
      currency: adAccInfo.currency,
      ads: normalizedAds,
      pagination: adResult.pagination,
    },
    meta: {
      source: 'meta',
      dateRange: {
        since: queryParams.since || null,
        until: queryParams.until || null,
        preset: queryParams.datePreset || null,
        timezone: adAccInfo.timezone || 'UTC',
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
  getAdsInsights,
  getCampaignInsights,
  getAdSetInsights,
  getAdInsights,
};
