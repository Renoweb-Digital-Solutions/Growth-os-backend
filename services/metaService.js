/**
 * Reason: Unified Meta service layer encapsulating all external Graph API v26.0 requests.
 * How: Provides helper methods for Phase 1 OAuth token exchange and Phase 2 Graph API asset discovery, 
 * social data retrieval (Pages & Instagram), advertising hierarchy (Ad Accounts, Campaigns, Ad Sets, Ads), 
 * Ads Insights, cursor pagination, and Meta error normalization.
 */

const MetaIntegration = require('../models/MetaIntegration');

/**
 * Enforces mandatory META_GRAPH_API_VERSION environment variable
 */
const getGraphApiVersion = () => {
  if (!process.env.META_GRAPH_API_VERSION) {
    throw new Error('META_GRAPH_API_VERSION environment variable is missing');
  }
  return process.env.META_GRAPH_API_VERSION;
};

/**
 * Builds Meta Facebook Login for Business Authorization URL
 */
const buildAuthorizationUrl = (state) => {
  const version = getGraphApiVersion();
  const baseUrl = `https://www.facebook.com/${version}/dialog/oauth`;

  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    state: state,
    response_type: 'code',
  });

  if (process.env.META_CONFIG_ID) {
    params.append('config_id', process.env.META_CONFIG_ID);
  } else {
    params.append(
      'scope',
      'ads_read,pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights'
    );
  }

  return `${baseUrl}?${params.toString()}`;
};

/**
 * Exchanges authorization code for access token with Meta Graph API
 */
const exchangeCodeForToken = async (code) => {
  const version = getGraphApiVersion();
  const tokenUrl = `https://graph.facebook.com/${version}/oauth/access_token`;

  // Step 1: Exchange authorization code for initial short-lived user access token
  const codeParams = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code: code,
  });

  const response = await fetch(`${tokenUrl}?${codeParams.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || 'Meta authorization code exchange failed';
    const err = new Error(errorMsg);
    err.metaError = data.error;
    
    if (data.error?.code === 4 || data.error?.code === 17 || data.error?.code === 32 || data.error?.code === 613) {
      err.statusCode = 429;
    }
    
    throw err;
  }

  const shortLivedToken = data.access_token;

  // Step 2: Exchange short-lived token for long-lived User Access Token (~60 days)
  const exchangeParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });

  const longLivedResponse = await fetch(`${tokenUrl}?${exchangeParams.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const longLivedData = await longLivedResponse.json();

  if (!longLivedResponse.ok || longLivedData.error || !longLivedData.access_token) {
    const errorMsg = longLivedData.error?.message || 'Meta long-lived token exchange failed';
    const err = new Error(errorMsg);
    err.metaError = longLivedData.error;
    throw err;
  }

  return {
    accessToken: longLivedData.access_token,
    tokenType: longLivedData.token_type || data.token_type,
    expiresIn: longLivedData.expires_in,
  };
};

/**
 * Fetches authenticated Meta user profile (/me)
 */
const getMetaUserProfile = async (accessToken) => {
  return await fetchGraphApi('/me', accessToken, {}, null, true);
};

/**
 * Fetches authoritatively granted scopes from Meta (/me/permissions)
 */
const getGrantedPermissions = async (accessToken) => {
  const data = await fetchGraphApi('/me/permissions', accessToken, {}, null, true);

  if (Array.isArray(data.data)) {
    return data.data
      .filter((item) => item.status === 'granted')
      .map((item) => item.permission);
  }

  return [];
};

// ============================================================================
// PHASE 2 — GRAPH API FETCH & ERROR NORMALIZATION ENGINE
// ============================================================================

/**
 * Base Graph API fetch wrapper with centralized Meta error response parsing
 */
const fetchGraphApi = async (endpoint, accessToken, params = {}, userId = null, isUserToken = true) => {
  const version = getGraphApiVersion();
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, typeof value === 'object' ? JSON.stringify(value) : value);
    }
  });

  if (!searchParams.has('access_token')) {
    searchParams.append('access_token', accessToken);
  }

  const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const url = `https://graph.facebook.com/${version}/${path}?${searchParams.toString()}`;
  const safeUrl = `https://graph.facebook.com/${version}/${path}`;
  
  const reqId = Math.random().toString(36).substring(2, 9);
  const ts = new Date().toISOString();

  console.log(`[GRAPH] requestId=${reqId} purpose=meta_request endpoint=${path} timestamp=${ts} status=LAUNCHING metaCode=none`);

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (fetchError) {
    const rawCauseMessage = fetchError.cause?.message || fetchError.cause?.code || fetchError.message || 'Unknown network error';
    const safeCauseMessage = String(rawCauseMessage).replace(/access_token=[^&]+/gi, 'access_token=[REDACTED]');

    console.log(`[GRAPH] requestId=${reqId} purpose=meta_request endpoint=${path} timestamp=${new Date().toISOString()} status=NETWORK_ERROR metaCode=none`);

    const err = new Error(`Meta Graph API network failure: ${safeCauseMessage}`);
    err.statusCode = 502;
    err.cause = fetchError.cause || fetchError;
    err.metaError = {
      code: fetchError.cause?.code || 'FETCH_FAILED',
      message: safeCauseMessage,
      syscall: fetchError.cause?.syscall || null,
    };
    throw err;
  }

  const data = await response.json();

  // Handle Meta error payload
  if (!response.ok || data.error) {
    const errorInfo = data.error || {};
    const code = errorInfo.code;
    const subcode = errorInfo.error_subcode;
    const message = errorInfo.message || 'Meta API request failed';

    console.log(`[GRAPH] requestId=${reqId} purpose=meta_request endpoint=${path} timestamp=${new Date().toISOString()} status=${response.status} metaCode=${code}`);

    // Code 190: OAuth Access Token Expired or Revoked
    if (code === 190) {
      if (isUserToken && userId) {
        await MetaIntegration.findOneAndUpdate(
          { userId },
          { status: 'expired', accessToken: null }
        );
        const err = new Error('Meta access token has expired or been revoked. Please reconnect your Meta account');
        err.statusCode = 401;
        err.metaCode = code;
        throw err;
      }

      // If Page Access Token failed with 190, do not invalidate User Access Token in DB
      const err = new Error(`Facebook Page access token error: ${message}`);
      err.statusCode = 403;
      err.metaCode = code;
      throw err;
    }

    // Code 4, 17, 32, 613: Rate Limit Exceeded
    if (code === 4 || code === 17 || code === 32 || code === 613) {
      const err = new Error('Meta API rate limit exceeded. Please try again shortly');
      err.statusCode = 429;
      err.metaCode = code;
      throw err;
    }

    // Code 100, subcode 33: Asset Not Found / Permission Denied
    if (code === 100 && subcode === 33) {
      const err = new Error('Requested Meta asset was not found or is inaccessible');
      err.statusCode = 404;
      err.metaCode = code;
      throw err;
    }

    // Code 10, 200-299: Missing Permission Error
    if (code === 10 || (code >= 200 && code <= 299)) {
      const err = new Error(`Meta permission error: ${message}`);
      err.statusCode = 403;
      err.metaCode = code;
      throw err;
    }

    // Generic Meta API error
    const err = new Error(`Meta API error (${code || response.status}): ${message}`);
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 500;
    err.metaError = errorInfo;
    throw err;
  }

  console.log(`[GRAPH] requestId=${reqId} purpose=meta_request endpoint=${path} timestamp=${new Date().toISOString()} status=${response.status} metaCode=none`);
  return data;
};

/**
 * Reusable cursor-based pagination helper for Graph API endpoints
 */
const fetchPaginatedGraphApi = async (endpoint, accessToken, options = {}, userId = null, isUserToken = true) => {
  const limit = Math.min(parseInt(options.limit, 10) || 25, 100);
  const params = {
    ...options,
    limit,
  };

  if (options.after) {
    params.after = options.after;
  }

  const response = await fetchGraphApi(endpoint, accessToken, params, userId, isUserToken);

  const items = Array.isArray(response.data) ? response.data : [];
  const paging = response.paging || {};
  const cursors = paging.cursors || {};

  return {
    data: items,
    pagination: {
      limit,
      cursors: {
        before: cursors.before || null,
        after: cursors.after || null,
      },
      hasNextPage: Boolean(paging.next && cursors.after),
      hasPreviousPage: Boolean(paging.previous && cursors.before),
    },
  };
};

/**
 * Helper to fetch a Page Access Token on-demand using the user's User Access Token
 */
const getPageAccessToken = async (pageId, userAccessToken, userId = null) => {
  const response = await fetchGraphApi(`/${pageId}`, userAccessToken, { fields: 'access_token' }, userId, true);

  if (!response || !response.access_token) {
    const err = new Error('Page access token could not be retrieved for this Page');
    err.statusCode = 403;
    throw err;
  }

  return response.access_token;
};

// ============================================================================
// PHASE 2 — ASSET DISCOVERY & DATA RETRIEVAL
// ============================================================================

/**
 * Discovers Facebook Pages accessible to the connected user
 */
const getFacebookPages = async (accessToken, userId = null) => {
  const fields = 'id,name,category,category_list,tasks,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}';
  const response = await fetchGraphApi('/me/accounts', accessToken, { fields }, userId, true);

  const rawPages = Array.isArray(response.data) ? response.data : [];
  return rawPages.map((page) => ({
    pageId: page.id,
    pageToken: null,
    name: page.name,
    category: page.category || null,
    tasks: page.tasks || [],
    hasInstagramLinked: Boolean(page.instagram_business_account),
    instagramAccount: page.instagram_business_account
      ? {
          instagramAccountId: page.instagram_business_account.id,
          username: page.instagram_business_account.username || null,
          name: page.instagram_business_account.name || null,
          profilePictureUrl: page.instagram_business_account.profile_picture_url || null,
          followersCount: page.instagram_business_account.followers_count || 0,
          mediaCount: page.instagram_business_account.media_count || 0,
          linkedPageId: page.id,
        }
      : null,
  }));
};

/**
 * Fetches details for a specific Facebook Page using its Page Access Token
 */
const getFacebookPageDetails = async (pageId, accessToken, userId = null) => {
  const pageToken = await getPageAccessToken(pageId, accessToken, userId);
  const fields = 'id,name,category,fan_count,followers_count,link,about,website';
  const page = await fetchGraphApi(`/${pageId}`, pageToken, { fields }, userId, false);

  return {
    pageId: page.id,
    name: page.name,
    category: page.category || null,
    fanCount: page.fan_count || 0,
    followersCount: page.followers_count || 0,
    link: page.link || null,
    about: page.about || null,
    website: page.website || null,
  };
};

/**
 * Fetches posts published on a Facebook Page using its Page Access Token
 */
const getFacebookPagePosts = async (pageId, accessToken, paginationParams = {}, userId = null, preFetchedPageToken = null) => {
  const resolvedPageToken = preFetchedPageToken || await getPageAccessToken(pageId, accessToken, userId);
  const fields = 'id,message,created_time,full_picture,permalink_url,shares';
  const result = await fetchPaginatedGraphApi(`/${pageId}/published_posts`, resolvedPageToken, { ...paginationParams, fields }, userId, false);

  const normalizedPosts = [];
  let rateLimitHit = false;
  const BATCH_SIZE = 5;

  for (let i = 0; i < result.data.length; i += BATCH_SIZE) {
    const batch = result.data.slice(i, i + BATCH_SIZE);
    
    if (rateLimitHit) {
      // If a previous batch hit the rate limit, stop launching new insight requests
      batch.forEach(post => {
        normalizedPosts.push({
          postId: post.id,
          message: post.message || '',
          createdTime: post.created_time,
          fullPicture: post.full_picture || null,
          permalinkUrl: post.permalink_url || null,
          shareCount: post.shares ? post.shares.count : 0,
          insightsData: [],
        });
      });
      continue;
    }

    const batchPromises = batch.map(async (post) => {
      let insightsData = [];
      try {
        const metric = 'post_impressions,post_impressions_unique,post_engaged_users,post_activity_by_action_type';
        const insResult = await fetchGraphApi(`/${post.id}/insights`, resolvedPageToken, { metric }, userId, false);
        insightsData = insResult.data || [];
      } catch (err) {
        if (err.statusCode === 429 || err.metaCode === 4) {
          rateLimitHit = true;
          throw err;
        }
        // Fallback: If post_activity_by_action_type fails or is unsupported for this post/version, try standard metrics
        try {
          const fallbackMetric = 'post_impressions,post_impressions_unique,post_engaged_users';
          const insResult = await fetchGraphApi(`/${post.id}/insights`, resolvedPageToken, { metric: fallbackMetric }, userId, false);
          insightsData = insResult.data || [];
        } catch (fallbackErr) {
          if (fallbackErr.statusCode === 429 || fallbackErr.metaCode === 4) {
            rateLimitHit = true;
            throw fallbackErr;
          }
        }
      }

      return {
        postId: post.id,
        message: post.message || '',
        createdTime: post.created_time,
        fullPicture: post.full_picture || null,
        permalinkUrl: post.permalink_url || null,
        shareCount: post.shares ? post.shares.count : 0,
        insightsData,
      };
    });

    try {
      const mappedBatch = await Promise.all(batchPromises);
      normalizedPosts.push(...mappedBatch);
    } catch (err) {
      if (err.statusCode === 429) {
        // A rate limit error was thrown by one of the promises, halting the pipeline
        throw err;
      }
    }
  }

  return {
    posts: normalizedPosts,
    pagination: result.pagination,
  };
};

/**
 * Fetches single Facebook post or Instagram media item directly by ID without fetching the feed
 */
const getSingleContent = async (contentId, accessToken, isInstagram = false, userId = null) => {
  if (isInstagram) {
    const fields = 'id,caption,media_type,media_product_type,media_url,permalink,timestamp,like_count,comments_count,owner';
    const item = await fetchGraphApi(`/${contentId}`, accessToken, { fields }, userId);

    let insightsData = [];
    try {
      let metric = 'impressions,reach,engagement,saved';
      if (item.media_product_type === 'REELS') {
        metric = 'plays,reach,saved';
      } else if (item.media_type === 'CAROUSEL_ALBUM') {
        metric = 'carousel_album_impressions,carousel_album_reach,carousel_album_engagement,carousel_album_saved';
      }
      const insResult = await fetchGraphApi(`/${item.id}/insights`, accessToken, { metric }, userId);
      insightsData = insResult.data || [];
    } catch (err) {
      if (err.statusCode === 429 || err.metaCode === 4) throw err;
    }

    return {
      mediaId: item.id,
      caption: item.caption || '',
      mediaType: item.media_type,
      mediaProductType: item.media_product_type || null,
      mediaUrl: item.media_url || null,
      permalink: item.permalink || null,
      timestamp: item.timestamp,
      likeCount: item.like_count || 0,
      commentCount: item.comments_count || 0,
      owner: item.owner || null,
      insightsData,
    };
  } else {
    // Facebook Page Post
    const fields = 'id,message,created_time,full_picture,permalink_url,shares,from';
    const post = await fetchGraphApi(`/${contentId}`, accessToken, { fields }, userId, false);

    let insightsData = [];
    try {
      const metric = 'post_impressions,post_impressions_unique,post_engaged_users,post_activity_by_action_type';
      const insResult = await fetchGraphApi(`/${post.id}/insights`, accessToken, { metric }, userId, false);
      insightsData = insResult.data || [];
    } catch (err) {
      if (err.statusCode === 429 || err.metaCode === 4) throw err;
      try {
        const fallbackMetric = 'post_impressions,post_impressions_unique,post_engaged_users';
        const insResult = await fetchGraphApi(`/${post.id}/insights`, accessToken, { metric: fallbackMetric }, userId, false);
        insightsData = insResult.data || [];
      } catch (fallbackErr) {
        if (fallbackErr.statusCode === 429 || fallbackErr.metaCode === 4) throw fallbackErr;
      }
    }

    return {
      postId: post.id,
      message: post.message || '',
      createdTime: post.created_time,
      fullPicture: post.full_picture || null,
      permalinkUrl: post.permalink_url || null,
      shareCount: post.shares ? post.shares.count : 0,
      from: post.from || null,
      insightsData,
    };
  }
};

/**
 * Fetches Facebook Page insights metrics using its Page Access Token
 */
const getFacebookPageInsights = async (pageId, accessToken, timeParams = {}, userId = null) => {
  const pageToken = await getPageAccessToken(pageId, accessToken, userId);
  const params = {
    metric: 'page_views_total,page_fan_adds,page_engaged_users,page_impressions,page_post_engagements',
    period: 'day',
  };

  if (timeParams.since) params.since = timeParams.since;
  if (timeParams.until) params.until = timeParams.until;

  const response = await fetchGraphApi(`/${pageId}/insights`, pageToken, params, userId, false);
  const metricsData = Array.isArray(response.data) ? response.data : [];

  const normalizedMetrics = metricsData.map((item) => ({
    name: item.name,
    period: item.period,
    title: item.title || item.name,
    description: item.description || null,
    values: Array.isArray(item.values)
      ? item.values.map((v) => ({
          value: v.value,
          endTime: v.end_time,
        }))
      : [],
  }));

  return {
    pageId,
    metrics: normalizedMetrics,
  };
};

/**
 * Discovers Instagram Professional Accounts connected via Facebook Pages
 */
const getInstagramAccounts = async (accessToken, userId = null) => {
  const pages = await getFacebookPages(accessToken, userId);
  const igAccounts = [];
  const seenIds = new Set();

  pages.forEach((page) => {
    if (page.instagramAccount && !seenIds.has(page.instagramAccount.instagramAccountId)) {
      seenIds.add(page.instagramAccount.instagramAccountId);
      igAccounts.push(page.instagramAccount);
    }
  });

  return igAccounts;
};

/**
 * Fetches media posts published by an Instagram Professional Account with pagination
 */
const getInstagramMedia = async (instagramAccountId, accessToken, paginationParams = {}, userId = null) => {
  const fields = 'id,caption,media_type,media_product_type,media_url,permalink,timestamp,like_count,comments_count';
  const result = await fetchPaginatedGraphApi(`/${instagramAccountId}/media`, accessToken, { ...paginationParams, fields }, userId);

  const normalizedMedia = [];
  let rateLimitHit = false;
  const BATCH_SIZE = 5;

  for (let i = 0; i < result.data.length; i += BATCH_SIZE) {
    const batch = result.data.slice(i, i + BATCH_SIZE);
    
    if (rateLimitHit) {
      batch.forEach(item => {
        normalizedMedia.push({
          mediaId: item.id,
          caption: item.caption || '',
          mediaType: item.media_type,
          mediaProductType: item.media_product_type || null,
          mediaUrl: item.media_url || null,
          permalink: item.permalink || null,
          timestamp: item.timestamp,
          likeCount: item.like_count || 0,
          commentCount: item.comments_count || 0,
          insightsData: [],
        });
      });
      continue;
    }

    const batchPromises = batch.map(async (item) => {
      let insightsData = [];
      
      try {
        let metric = 'impressions,reach,engagement,saved';
        if (item.media_product_type === 'REELS') {
          metric = 'plays,reach,saved';
        } else if (item.media_type === 'CAROUSEL_ALBUM') {
          metric = 'carousel_album_impressions,carousel_album_reach,carousel_album_engagement,carousel_album_saved';
        }

        const insResult = await fetchGraphApi(`/${item.id}/insights`, accessToken, { metric }, userId);
        insightsData = insResult.data || [];
      } catch (err) {
        if (err.statusCode === 429 || err.metaCode === 4) {
          rateLimitHit = true;
          throw err;
        }
        // Gracefully ignore unsupported media type errors or missing metrics
      }

      return {
        mediaId: item.id,
        caption: item.caption || '',
        mediaType: item.media_type,
        mediaProductType: item.media_product_type || null,
        mediaUrl: item.media_url || null,
        permalink: item.permalink || null,
        timestamp: item.timestamp,
        likeCount: item.like_count || 0,
        commentCount: item.comments_count || 0,
        insightsData,
      };
    });

    try {
      const mappedBatch = await Promise.all(batchPromises);
      normalizedMedia.push(...mappedBatch);
    } catch (err) {
      if (err.statusCode === 429) {
        throw err;
      }
    }
  }

  return {
    media: normalizedMedia,
    pagination: result.pagination,
  };
};

/**
 * Fetches insights for an Instagram Professional Account
 */
const getInstagramInsights = async (instagramAccountId, accessToken, timeParams = {}, userId = null) => {
  const params = {
    metric: 'impressions,reach,profile_views,follower_count',
    period: 'day',
  };

  if (timeParams.since) params.since = timeParams.since;
  if (timeParams.until) params.until = timeParams.until;

  const response = await fetchGraphApi(`/${instagramAccountId}/insights`, accessToken, params, userId);
  const metricsData = Array.isArray(response.data) ? response.data : [];

  const normalizedMetrics = metricsData.map((item) => ({
    name: item.name,
    period: item.period,
    title: item.title || item.name,
    description: item.description || null,
    values: Array.isArray(item.values)
      ? item.values.map((v) => ({
          value: v.value,
          endTime: v.end_time,
        }))
      : [],
  }));

  return {
    instagramAccountId,
    metrics: normalizedMetrics,
  };
};

/**
 * Discovers accessible Meta Ad Accounts
 */
const getAdAccounts = async (accessToken, userId = null) => {
  const fields = 'id,account_id,name,account_status,currency,timezone_name,balance,spend_cap';
  const response = await fetchGraphApi('/me/adaccounts', accessToken, { fields }, userId);

  const rawAccounts = Array.isArray(response.data) ? response.data : [];
  return rawAccounts.map((acc) => ({
    adAccountId: acc.id,
    accountId: acc.account_id,
    name: acc.name,
    accountStatus: acc.account_status,
    currency: acc.currency,
    timezone: acc.timezone_name,
    balance: acc.balance || 0,
    spendCap: acc.spend_cap || null,
  }));
};

/**
 * Fetches campaigns for an Ad Account with pagination
 */
const getCampaigns = async (adAccountId, accessToken, paginationParams = {}, userId = null) => {
  const fields = 'id,name,status,effective_status,objective,buying_type,start_time,stop_time,daily_budget,lifetime_budget';
  const result = await fetchPaginatedGraphApi(`/${adAccountId}/campaigns`, accessToken, { ...paginationParams, fields }, userId);

  const normalizedCampaigns = result.data.map((c) => ({
    campaignId: c.id,
    name: c.name,
    status: c.status,
    effectiveStatus: c.effective_status,
    objective: c.objective || null,
    buyingType: c.buying_type || null,
    startTime: c.start_time || null,
    stopTime: c.stop_time || null,
    dailyBudget: c.daily_budget ? Number(c.daily_budget) : null,
    lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) : null,
  }));

  return {
    campaigns: normalizedCampaigns,
    pagination: result.pagination,
  };
};

/**
 * Fetches Ad Sets for an Ad Account or Campaign with pagination
 */
const getAdSets = async (adAccountId, accessToken, paginationParams = {}, userId = null) => {
  const targetEndpoint = paginationParams.campaignId ? `/${paginationParams.campaignId}/adsets` : `/${adAccountId}/adsets`;
  const fields = 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,optimization_goal,billing_event';
  
  const cleanParams = { ...paginationParams };
  delete cleanParams.campaignId;

  const result = await fetchPaginatedGraphApi(targetEndpoint, accessToken, { ...cleanParams, fields }, userId);

  const normalizedAdSets = result.data.map((adSet) => ({
    adSetId: adSet.id,
    name: adSet.name,
    campaignId: adSet.campaign_id,
    status: adSet.status,
    effectiveStatus: adSet.effective_status,
    dailyBudget: adSet.daily_budget ? Number(adSet.daily_budget) : null,
    lifetimeBudget: adSet.lifetime_budget ? Number(adSet.lifetime_budget) : null,
    startTime: adSet.start_time || null,
    endTime: adSet.end_time || null,
    optimizationGoal: adSet.optimization_goal || null,
    billingEvent: adSet.billing_event || null,
  }));

  return {
    adSets: normalizedAdSets,
    pagination: result.pagination,
  };
};

/**
 * Fetches Ads for an Ad Account, Ad Set, or Campaign with pagination
 */
const getAds = async (adAccountId, accessToken, paginationParams = {}, userId = null) => {
  let targetEndpoint = `/${adAccountId}/ads`;
  if (paginationParams.adSetId) {
    targetEndpoint = `/${paginationParams.adSetId}/ads`;
  } else if (paginationParams.campaignId) {
    targetEndpoint = `/${paginationParams.campaignId}/ads`;
  }

  const fields = 'id,name,campaign_id,adset_id,status,effective_status,created_time,updated_time';
  const cleanParams = { ...paginationParams };
  delete cleanParams.adSetId;
  delete cleanParams.campaignId;

  const result = await fetchPaginatedGraphApi(targetEndpoint, accessToken, { ...cleanParams, fields }, userId);

  const normalizedAds = result.data.map((ad) => ({
    adId: ad.id,
    name: ad.name,
    campaignId: ad.campaign_id,
    adSetId: ad.adset_id,
    status: ad.status,
    effectiveStatus: ad.effective_status,
    createdTime: ad.created_time || null,
    updatedTime: ad.updated_time || null,
  }));

  return {
    ads: normalizedAds,
    pagination: result.pagination,
  };
};

/**
 * Fetches Ads Insights for an Ad Account with metrics normalization & derived calculation rules
 */
const getAdsInsights = async (adAccountId, accessToken, queryParams = {}, userId = null) => {
  const level = ['account', 'campaign', 'adset', 'ad'].includes(queryParams.level) ? queryParams.level : 'account';
  
  let fields = 'account_id,account_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,date_start,date_stop';
  if (level === 'campaign' || level === 'adset' || level === 'ad') {
    fields += ',campaign_id,campaign_name';
  }
  if (level === 'adset' || level === 'ad') {
    fields += ',adset_id,adset_name';
  }
  if (level === 'ad') {
    fields += ',ad_id,ad_name';
  }

  const params = {
    fields,
    level,
  };

  if (queryParams.datePreset) {
    params.date_preset = queryParams.datePreset;
  } else if (queryParams.since && queryParams.until) {
    params.time_range = JSON.stringify({ since: queryParams.since, until: queryParams.until });
  }

  if (queryParams.after) params.after = queryParams.after;
  if (queryParams.limit) params.limit = queryParams.limit;

  const result = await fetchPaginatedGraphApi(`/${adAccountId}/insights`, accessToken, params, userId);

  const normalizedInsights = result.data.map((row) => {
    const spend = Number(row.spend || 0);
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const reach = Number(row.reach || 0);

    // Derived metric fallback logic
    const ctr = row.ctr !== undefined ? Number(row.ctr) : (impressions > 0 ? (clicks / impressions) * 100 : 0);
    const cpc = row.cpc !== undefined ? Number(row.cpc) : (clicks > 0 ? spend / clicks : 0);
    const cpm = row.cpm !== undefined ? Number(row.cpm) : (impressions > 0 ? (spend / impressions) * 1000 : 0);

    const base = {
      accountId: row.account_id,
      accountName: row.account_name || null,
    };
    if (['campaign', 'adset', 'ad'].includes(level)) {
      base.campaignId = row.campaign_id;
      base.campaignName = row.campaign_name || null;
    }
    if (['adset', 'ad'].includes(level)) {
      base.adSetId = row.adset_id;
      base.adSetName = row.adset_name || null;
    }
    if (level === 'ad') {
      base.adId = row.ad_id;
      base.adName = row.ad_name || null;
    }

    return {
      ...base,
      spend,
      impressions,
      reach,
      clicks,
      ctr: Number(ctr.toFixed(4)),
      cpc: Number(cpc.toFixed(4)),
      cpm: Number(cpm.toFixed(4)),
      actions: row.actions || [],
      costPerActionType: row.cost_per_action_type || [],
      dateStart: row.date_start,
      dateStop: row.date_stop,
    };
  });

  return {
    insights: normalizedInsights,
    level,
    pagination: result.pagination,
  };
};

/**
 * Aggregates all accessible Meta assets and capabilities for the connected user
 */
const discoverAssets = async (accessToken, userId = null) => {
  const pages = await getFacebookPages(accessToken, userId);
  const instagramAccounts = [];
  const seenIgIds = new Set();
  
  console.log(`[Meta Graph API] Asset Discovery | GET /me/accounts returned ${pages.length} pages`);

  for (const page of pages) {
    try {
      page.pageToken = await getPageAccessToken(page.pageId, accessToken, userId);
      console.log(`[Meta Graph API] Asset Discovery | Fetched pageToken for Page ID ${page.pageId} (Success)`);
    } catch (err) {
      console.log(`[Meta Graph API] Asset Discovery | Fetched pageToken for Page ID ${page.pageId} (Failed: ${err.metaCode || 'UNKNOWN'})`);
      page.pageToken = null;
    }

    if (page.instagramAccount && !seenIgIds.has(page.instagramAccount.instagramAccountId)) {
      seenIgIds.add(page.instagramAccount.instagramAccountId);
      instagramAccounts.push(page.instagramAccount);
    }
  }

  let adAccounts = [];
  try {
    adAccounts = await getAdAccounts(accessToken, userId);
  } catch (error) {
    // If user lacks ads permission or has no ad account, report ads as unavailable cleanly
    adAccounts = [];
  }

  return {
    pages,
    instagramAccounts,
    adAccounts,
    capabilities: {
      pagesAvailable: pages.length > 0,
      instagramAvailable: instagramAccounts.length > 0,
      adsAvailable: adAccounts.length > 0,
    },
  };
};

module.exports = {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  getMetaUserProfile,
  getGrantedPermissions,
  fetchGraphApi,
  fetchPaginatedGraphApi,
  discoverAssets,
  getFacebookPages,
  getFacebookPageDetails,
  getFacebookPagePosts,
  getFacebookPageInsights,
  getInstagramAccounts,
  getInstagramMedia,
  getInstagramInsights,
  getAdAccounts,
  getCampaigns,
  getAdSets,
  getAds,
  getAdsInsights,
  getSingleContent,
};
