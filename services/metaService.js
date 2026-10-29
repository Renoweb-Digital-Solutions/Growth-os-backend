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
      'ads_read,pages_show_list,pages_read_engagement,pages_read_user_content,read_insights,instagram_basic,instagram_manage_insights'
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

/**
 * Helper to parse YYYY-MM-DD date string or timestamp into integer Unix timestamp (seconds)
 */
const toUnixTimestamp = (dateVal, isEndOfDay = false) => {
  if (!dateVal) return null;
  if (typeof dateVal === 'number' && Number.isFinite(dateVal)) {
    return Math.floor(dateVal);
  }
  const strVal = String(dateVal).trim();
  if (!strVal) return null;

  if (/^\d{9,12}$/.test(strVal)) {
    const parsedInt = parseInt(strVal, 10);
    return Number.isFinite(parsedInt) ? parsedInt : null;
  }

  const dateObj = new Date(strVal);
  if (isNaN(dateObj.getTime())) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) {
    if (isEndOfDay) {
      dateObj.setUTCHours(23, 59, 59, 999);
    } else {
      dateObj.setUTCHours(0, 0, 0, 0);
    }
  }

  const ts = Math.floor(dateObj.getTime() / 1000);
  return Number.isFinite(ts) ? ts : null;
};

/**
 * Helper to strictly parse numeric metrics without coercing null/undefined to zero
 */
const parseNumericMetric = (val) => {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
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
      if (isUserToken) {
        // Only mark integration as expired if message or subcode confirms session expiry/revocation,
        // and NOT when user token was queried against an unauthorized or mismatched endpoint.
        const isTrueExpiry = subcode === 463 || subcode === 467 || /expired|revoked|session is invalid/i.test(message);
        if (userId && isTrueExpiry) {
          await MetaIntegration.findOneAndUpdate(
            { userId },
            { status: 'expired', accessToken: null }
          );
        }
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
  const fields = 'id,name,category,category_list,tasks,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}';
  
  let response;
  try {
    response = await fetchGraphApi('/me/accounts', accessToken, { fields }, userId, true);
    
    // Instrumenting successful response
    const dataLen = Array.isArray(response.data) ? response.data.length : 0;
    const pageIdsAndNames = Array.isArray(response.data) ? response.data.map(p => ({ id: p.id, name: p.name })) : [];
    console.log(`[INSTRUMENTATION /me/accounts] HTTP Status: 200`);
    console.log(`[INSTRUMENTATION /me/accounts] data.length: ${dataLen}`);
    console.log(`[INSTRUMENTATION /me/accounts] pages: ${JSON.stringify(pageIdsAndNames)}`);
    console.log(`[INSTRUMENTATION /me/accounts] paging presence: ${Boolean(response.paging)}`);
  } catch (error) {
    // Instrumenting error response
    console.log(`[INSTRUMENTATION /me/accounts] HTTP Status: ${error.statusCode || 500}`);
    if (error.metaError) {
      console.log(`[INSTRUMENTATION /me/accounts] Error Code: ${error.metaError.code}`);
      console.log(`[INSTRUMENTATION /me/accounts] Error Type: ${error.metaError.type}`);
      console.log(`[INSTRUMENTATION /me/accounts] Error Message: ${error.metaError.message}`);
    } else {
      console.log(`[INSTRUMENTATION /me/accounts] Error Message: ${error.message}`);
    }
    throw error;
  }

  const rawPages = Array.isArray(response.data) ? response.data : [];
  return rawPages.map((page) => ({
    pageId: page.id,
    pageToken: page.access_token || null,
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
          followersCount: typeof page.instagram_business_account.followers_count === 'number' ? page.instagram_business_account.followers_count : 0,
          mediaCount: typeof page.instagram_business_account.media_count === 'number' ? page.instagram_business_account.media_count : 0,
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
    fanCount: parseNumericMetric(page.fan_count),
    followersCount: parseNumericMetric(page.followers_count),
    link: page.link || null,
    about: page.about || null,
    website: page.website || null,
  };
};

/**
 * Helper to safely extract reaction breakdown dictionary by type (like, love, wow, etc.)
 */
const extractReactionBreakdown = (insightsData) => {
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
 * Helper to derive total reaction count from post insights (post_reactions_by_type_total)
 */
const deriveReactionsFromInsights = (insightsData) => {
  if (!Array.isArray(insightsData) || insightsData.length === 0) return null;
  const metric = insightsData.find((i) => i && i.name === 'post_reactions_by_type_total');
  if (!metric || !Array.isArray(metric.values) || metric.values.length === 0) return null;
  const val = metric.values[0]?.value;
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const keys = Object.keys(val);
    if (keys.length === 0) {
      return 0;
    }
    const counts = Object.values(val);
    if (counts.every((c) => typeof c === 'number' && Number.isFinite(c))) {
      return counts.reduce((acc, c) => acc + c, 0);
    }
  }
  return null;
};

/**
 * Helper to extract shareCount conservatively (preserving genuine zero vs null when omitted)
 */
const extractShareCount = (post) => {
  if (!post) return null;
  if (typeof post.shareCount === 'number' && Number.isFinite(post.shareCount)) {
    return post.shareCount;
  }
  if (post.shares && typeof post.shares.count === 'number' && Number.isFinite(post.shares.count)) {
    return post.shares.count;
  }
  if (typeof post.share_count === 'number' && Number.isFinite(post.share_count)) {
    return post.share_count;
  }
  return null;
};

/**
 * Helper to extract commentCount (preserving genuine zero vs null when omitted)
 */
const extractCommentCount = (post) => {
  if (!post) return null;
  if (typeof post.commentCount === 'number' && Number.isFinite(post.commentCount)) {
    return post.commentCount;
  }
  if (
    post.comments?.summary &&
    typeof post.comments.summary.total_count === 'number' &&
    Number.isFinite(post.comments.summary.total_count)
  ) {
    return post.comments.summary.total_count;
  }
  if (post.comments && typeof post.comments.count === 'number' && Number.isFinite(post.comments.count)) {
    return post.comments.count;
  }
  if (typeof post.comment_count === 'number' && Number.isFinite(post.comment_count)) {
    return post.comment_count;
  }
  return null;
};

/**
 * Helper to extract reactionCount (from summary or derived from post_reactions_by_type_total insights)
 */
const extractReactionCount = (post, insightsData = null) => {
  if (!post) return null;
  if (typeof post.reactionCount === 'number' && Number.isFinite(post.reactionCount)) {
    return post.reactionCount;
  }
  if (
    post.reactions?.summary &&
    typeof post.reactions.summary.total_count === 'number' &&
    Number.isFinite(post.reactions.summary.total_count)
  ) {
    return post.reactions.summary.total_count;
  }
  if (post.reactions && typeof post.reactions.total_count === 'number' && Number.isFinite(post.reactions.total_count)) {
    return post.reactions.total_count;
  }
  if (typeof post.reaction_count === 'number' && Number.isFinite(post.reaction_count)) {
    return post.reaction_count;
  }
  const derived = deriveReactionsFromInsights(insightsData || post.insightsData);
  if (typeof derived === 'number' && Number.isFinite(derived)) {
    return derived;
  }
  return null;
};
/**
 * Fetches posts published on a Facebook Page using its Page Access Token
 */
const getFacebookPagePosts = async (pageId, accessToken, paginationParams = {}, userId = null, preFetchedPageToken = null) => {
  const resolvedPageToken = preFetchedPageToken || await getPageAccessToken(pageId, accessToken, userId);
  const enhancedFields = 'id,message,created_time,full_picture,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)';
  const baseFields = 'id,message,created_time,full_picture,permalink_url,shares';

  let result;
  let postFieldsWarning = null;
  try {
    result = await fetchPaginatedGraphApi(`/${pageId}/published_posts`, resolvedPageToken, { ...paginationParams, fields: enhancedFields }, userId, false);
  } catch (fetchErr) {
    if (fetchErr.statusCode === 429 || fetchErr.statusCode === 401) {
      throw fetchErr;
    }
    const safeMsg = fetchErr.message ? fetchErr.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
    console.log(`[POSTS] Enhanced post fields request failed for pageId=${pageId}: ${safeMsg}. Retrying with base fields.`);
    if (fetchErr.metaCode === 10 || /pages_read_user_content/i.test(fetchErr.message)) {
      postFieldsWarning = "Reading post reaction and comment summaries requires 'pages_read_user_content' permission. Please reconnect your Meta account with this permission granted.";
    } else {
      postFieldsWarning = `Enhanced post fields unavailable: ${safeMsg}`;
    }
    result = await fetchPaginatedGraphApi(`/${pageId}/published_posts`, resolvedPageToken, { ...paginationParams, fields: baseFields }, userId, false);
  }

  const normalizedPosts = [];
  let rateLimitHit = false;
  const BATCH_SIZE = 5;

  for (let i = 0; i < result.data.length; i += BATCH_SIZE) {
    const batch = result.data.slice(i, i + BATCH_SIZE);
    
    if (rateLimitHit) {
      // If a previous batch hit the rate limit, stop launching new insight requests
      batch.forEach(post => {
        const shareCount = extractShareCount(post);
        const reactionCount = extractReactionCount(post, []);
        const commentCount = extractCommentCount(post);

        normalizedPosts.push({
          postId: post.id,
          message: post.message || '',
          createdTime: post.created_time,
          fullPicture: post.full_picture || null,
          permalinkUrl: post.permalink_url || null,
          shareCount,
          reactionCount,
          commentCount,
          reactions: post.reactions || null,
          comments: post.comments || null,
          shares: post.shares || null,
          insightsData: [],
          insightsError: 'Rate limit encountered in preceding batch',
        });
      });
      continue;
    }

    const batchPromises = batch.map(async (post) => {
      let insightsData = [];
      let insightsError = null;
      try {
        // Supported post-level insights metrics tested on Graph API v26.0 with lifetime period
        const metric = 'post_media_view,post_reactions_by_type_total,post_total_media_view_unique';
        const insResult = await fetchGraphApi(`/${post.id}/insights`, resolvedPageToken, { metric, period: 'lifetime' }, userId, false);
        insightsData = insResult.data || [];
      } catch (err) {
        if (err.statusCode === 429 || err.metaCode === 4) {
          rateLimitHit = true;
          throw err;
        }
        // If combined request fails (e.g. non-media post rejecting post_total_media_view_unique), retry metrics independently
        if (err.statusCode === 400 || err.metaCode === 100) {
          const singleMetrics = ['post_media_view', 'post_reactions_by_type_total', 'post_total_media_view_unique'];
          const recovered = [];
          for (const sm of singleMetrics) {
            try {
              const singleRes = await fetchGraphApi(`/${post.id}/insights`, resolvedPageToken, { metric: sm, period: 'lifetime' }, userId, false);
              if (Array.isArray(singleRes.data)) {
                recovered.push(...singleRes.data);
              }
            } catch (subErr) {
              if (subErr.statusCode === 429 || subErr.metaCode === 4) {
                rateLimitHit = true;
                throw subErr;
              }
            }
          }
          if (recovered.length > 0) {
            insightsData = recovered;
          } else {
            const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
            insightsError = safeMsg;
            insightsData = [];
          }
        } else {
          const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
          console.log(`[POSTS] Post insights failed for postId=${post.id}: ${safeMsg}`);
          insightsError = safeMsg;
          insightsData = [];
        }
      }

      const shareCount = extractShareCount(post);
      const reactionCount = extractReactionCount(post, insightsData);
      const commentCount = extractCommentCount(post);

      return {
        postId: post.id,
        id: post.id,
        message: post.message || '',
        createdTime: post.created_time,
        fullPicture: post.full_picture || null,
        permalinkUrl: post.permalink_url || null,
        permalink: post.permalink_url || null,
        shareCount,
        reactionCount,
        commentCount,
        reactions: post.reactions || null,
        comments: post.comments || null,
        shares: post.shares || null,
        insightsData,
        insightsError,
      };
    });

    try {
      const mappedBatch = await Promise.all(batchPromises);
      normalizedPosts.push(...mappedBatch);
    } catch (err) {
      if (err.statusCode === 429) {
        throw err;
      }
    }
  }

  return {
    posts: normalizedPosts,
    pagination: result.pagination,
    ...(postFieldsWarning ? { warning: postFieldsWarning } : {}),
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
      likeCount: typeof item.like_count === 'number' ? item.like_count : null,
      commentCount: typeof item.comments_count === 'number' ? item.comments_count : null,
      owner: item.owner || null,
      insightsData,
    };
  } else {
    // Facebook Page Post
    const enhancedFields = 'id,message,created_time,full_picture,permalink_url,shares,from,reactions.summary(true).limit(0),comments.summary(true).limit(0)';
    const baseFields = 'id,message,created_time,full_picture,permalink_url,shares,from';
    let post;
    try {
      post = await fetchGraphApi(`/${contentId}`, accessToken, { fields: enhancedFields }, userId, false);
    } catch (err) {
      if (err.statusCode === 429 || err.statusCode === 401) throw err;
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[SINGLE_POST] Enhanced fields request failed for contentId=${contentId}: ${safeMsg}. Retrying with base fields.`);
      post = await fetchGraphApi(`/${contentId}`, accessToken, { fields: baseFields }, userId, false);
    }

    let insightsData = [];
    try {
      const metric = 'post_media_view,post_reactions_by_type_total,post_total_media_view_unique';
      const insResult = await fetchGraphApi(`/${post.id}/insights`, accessToken, { metric, period: 'lifetime' }, userId, false);
      insightsData = insResult.data || [];
    } catch (err) {
      if (err.statusCode === 429 || err.metaCode === 4) throw err;
      if (err.statusCode === 400 || err.metaCode === 100) {
        const recovered = [];
        for (const sm of ['post_media_view', 'post_reactions_by_type_total', 'post_total_media_view_unique']) {
          try {
            const singleRes = await fetchGraphApi(`/${post.id}/insights`, accessToken, { metric: sm, period: 'lifetime' }, userId, false);
            if (Array.isArray(singleRes.data)) recovered.push(...singleRes.data);
          } catch (subErr) {
            if (subErr.statusCode === 429 || subErr.metaCode === 4) throw subErr;
          }
        }
        insightsData = recovered;
      } else {
        insightsData = [];
      }
    }

    const shareCount = extractShareCount(post);
    const reactionCount = extractReactionCount(post, insightsData);
    const commentCount = extractCommentCount(post);

    return {
      postId: post.id,
      id: post.id,
      message: post.message || '',
      createdTime: post.created_time,
      fullPicture: post.full_picture || null,
      permalinkUrl: post.permalink_url || null,
      permalink: post.permalink_url || null,
      shareCount,
      reactionCount,
      commentCount,
      reactions: post.reactions || null,
      comments: post.comments || null,
      shares: post.shares || null,
      from: post.from || null,
      insightsData,
    };
  }
};

/**
 * Fetches Facebook Page insights metrics using its Page Access Token
 */
const getFacebookPageInsights = async (pageId, accessToken, timeParams = {}, userId = null, preFetchedPageToken = null) => {
  const pageToken = preFetchedPageToken || await getPageAccessToken(pageId, accessToken, userId);

  const defaultMetric = 'page_follows,page_views_total,page_post_engagements,page_total_actions';

  // Build groups of compatible metrics
  // If caller provided explicit metricGroups, honour them with their specific metric lists and periods.
  // Otherwise, split timeParams.metric compatibly or use defaultMetric.
  let groups = [];
  if (Array.isArray(timeParams.metricGroups) && timeParams.metricGroups.length > 0) {
    groups = timeParams.metricGroups.map((g) => {
      const metricStr = Array.isArray(g.metrics) ? g.metrics.join(',') : (g.metric || '');
      const period = g.period || timeParams.period || 'day';
      return {
        metric: metricStr,
        period,
        group: g.group || null,
      };
    });
  } else if (timeParams.metric) {
    const rawMetrics = timeParams.metric.split(',').map((m) => m.trim()).filter(Boolean);

    // page_video_view_time requires period=total_over_range; day metrics require period=day
    const videoTimeMetrics = rawMetrics.filter((m) => m === 'page_video_view_time');
    const standardMetrics = rawMetrics.filter((m) => m !== 'page_video_view_time');

    if (videoTimeMetrics.length > 0 && standardMetrics.length > 0) {
      groups.push({
        metric: standardMetrics.join(','),
        period: timeParams.period || 'day',
      });
      groups.push({
        metric: videoTimeMetrics.join(','),
        period: 'total_over_range',
      });
    } else if (videoTimeMetrics.length > 0) {
      groups.push({
        metric: videoTimeMetrics.join(','),
        period: timeParams.period || 'total_over_range',
      });
    } else {
      groups.push({
        metric: rawMetrics.join(','),
        period: timeParams.period || 'day',
      });
    }
  } else {
    groups.push({
      metric: defaultMetric,
      period: timeParams.period || 'day',
    });
  }

  const allReturnedMetrics = [];
  const requestedMetrics = [];
  const groupErrors = [];
  let firstError = null;

  for (const group of groups) {
    const groupMetricStr = group.metric;
    const groupPeriod = group.period || timeParams.period || 'day';
    const groupMetricsList = groupMetricStr.split(',').map((m) => m.trim()).filter(Boolean);
    groupMetricsList.forEach((m) => {
      if (!requestedMetrics.includes(m)) requestedMetrics.push(m);
    });

    const params = {
      metric: groupMetricStr,
      period: groupPeriod,
    };

    if (timeParams.since) {
      const sinceTs = toUnixTimestamp(timeParams.since, false);
      if (sinceTs !== null) params.since = sinceTs;
    }
    if (timeParams.until) {
      const untilTs = toUnixTimestamp(timeParams.until, true);
      if (untilTs !== null) params.until = untilTs;
    }

    try {
      const response = await fetchGraphApi(`/${pageId}/insights`, pageToken, params, userId, false);
      if (Array.isArray(response.data)) {
        allReturnedMetrics.push(...response.data);
      }
    } catch (err) {
      if (err.statusCode === 429 || err.statusCode === 401 || err.statusCode === 403) throw err;

      // Resilient Multi-Metric Group Retry:
      // If a combined group (e.g. 2 or more metrics) fails due to Meta code 2 (unexpected/transient error)
      // or code 100 (unsupported metric), retry each metric individually so one failing or slow metric
      // does not discard other valid, available metrics.
      if (groupMetricsList.length > 1) {
        let anyRecovered = false;
        for (const singleMetric of groupMetricsList) {
          try {
            const singleParams = { ...params, metric: singleMetric };
            const singleResp = await fetchGraphApi(`/${pageId}/insights`, pageToken, singleParams, userId, false);
            if (Array.isArray(singleResp.data) && singleResp.data.length > 0) {
              allReturnedMetrics.push(...singleResp.data);
              anyRecovered = true;
            }
          } catch (singleErr) {
            if (singleErr.statusCode === 429 || singleErr.statusCode === 401 || singleErr.statusCode === 403) throw singleErr;
            const singleSafeMsg = singleErr.message ? singleErr.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
            console.log(`[FB_INSIGHTS] Isolated retry for "${singleMetric}" (${groupPeriod}) failed for pageId=${pageId}: ${singleSafeMsg}`);
            groupErrors.push({
              metrics: [singleMetric],
              period: groupPeriod,
              error: singleSafeMsg,
            });
          }
        }
        if (anyRecovered) {
          continue;
        }
      }

      if (!firstError) firstError = err;
      const safeMsg = err.message ? err.message.replace(/access_token=[^&]+/gi, '[REDACTED]') : 'Unknown error';
      console.log(`[FB_INSIGHTS] Metric group "${groupMetricStr}" (${groupPeriod}) failed for pageId=${pageId}: ${safeMsg}`);
      groupErrors.push({
        metrics: groupMetricsList,
        period: groupPeriod,
        error: safeMsg,
      });
    }
  }

  // If all groups failed and no data returned at all, rethrow if it was a permission or critical error;
  // for unsupported metric errors, return normalized empty metrics with groupErrors diagnostics.
  if (allReturnedMetrics.length === 0 && groupErrors.length === groups.length && firstError && firstError.statusCode === 403) {
    throw firstError;
  }

  const returnedMetricsMap = new Map();
  allReturnedMetrics.forEach((item) => {
    if (item && item.name) {
      const period = item.period || 'day';
      const keyWithPeriod = `${item.name}:${period}`;
      const hasValues = Array.isArray(item.values) && item.values.length > 0;

      const normalizedEntry = {
        name: item.name,
        period,
        title: item.title || item.name,
        description: item.description || null,
        values: Array.isArray(item.values)
          ? item.values.map((v) => ({
              value: v.value,
              endTime: v.end_time || v.endTime,
            }))
          : [],
      };

      returnedMetricsMap.set(keyWithPeriod, normalizedEntry);

      const existingBare = returnedMetricsMap.get(item.name);
      if (!existingBare || (!existingBare.values.length && hasValues) || (period === 'day' && existingBare.period !== 'day')) {
        returnedMetricsMap.set(item.name, normalizedEntry);
      }
    }
  });

  const normalizedMetrics = [];
  const seenPeriodKeys = new Set();

  requestedMetrics.forEach((metricName) => {
    const dayItem = returnedMetricsMap.get(`${metricName}:day`);
    const genericItem = returnedMetricsMap.get(metricName);
    const primaryItem = dayItem || genericItem;

    if (primaryItem) {
      const k = `${primaryItem.name}:${primaryItem.period || 'day'}`;
      if (!seenPeriodKeys.has(k)) {
        seenPeriodKeys.add(k);
        normalizedMetrics.push(primaryItem);
      }
    } else {
      normalizedMetrics.push({
        name: metricName,
        period: 'day',
        title: metricName,
        description: null,
        values: [],
      });
    }
  });

  allReturnedMetrics.forEach((raw) => {
    if (raw && raw.name) {
      const period = raw.period || 'day';
      const k = `${raw.name}:${period}`;
      if (!seenPeriodKeys.has(k)) {
        seenPeriodKeys.add(k);
        const item = returnedMetricsMap.get(k);
        if (item) {
          normalizedMetrics.push(item);
        }
      }
    }
  });

  return {
    pageId,
    metrics: normalizedMetrics,
    dataEmpty: allReturnedMetrics.length === 0,
    ...(groupErrors.length > 0 ? { groupErrors } : {}),
  };
};
/**
 * Fetches lifetime Facebook Page audience demographics (gender/age, country, city, locale)
 */
const getFacebookPageDemographics = async (pageId, accessToken, userId = null, preFetchedPageToken = null) => {
  try {
    const pageToken = preFetchedPageToken || await getPageAccessToken(pageId, accessToken, userId);
    const params = {
      metric: 'page_fans_gender_age,page_fans_country,page_fans_city,page_fans_locale',
      period: 'lifetime',
    };

    const response = await fetchGraphApi(`/${pageId}/insights`, pageToken, params, userId, false);
    const data = Array.isArray(response.data) ? response.data : [];

    const findMetricValues = (metricName) => {
      const item = data.find((m) => m.name === metricName);
      if (!item || !Array.isArray(item.values) || item.values.length === 0) return null;
      const latestVal = item.values[item.values.length - 1]?.value;
      return (latestVal && typeof latestVal === 'object') ? latestVal : null;
    };

    return {
      pageId,
      demographics: {
        genderAge: findMetricValues('page_fans_gender_age'),
        countries: findMetricValues('page_fans_country'),
        cities: findMetricValues('page_fans_city'),
        locales: findMetricValues('page_fans_locale'),
      },
    };
  } catch (err) {
    if (err.statusCode === 429 || err.statusCode === 401) throw err;
    return {
      pageId,
      demographics: {
        genderAge: null,
        countries: null,
        cities: null,
        locales: null,
      },
    };
  }
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
          likeCount: typeof item.like_count === 'number' ? item.like_count : null,
          commentCount: typeof item.comments_count === 'number' ? item.comments_count : null,
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
        likeCount: typeof item.like_count === 'number' ? item.like_count : null,
        commentCount: typeof item.comments_count === 'number' ? item.comments_count : null,
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
    metric: 'reach',
    period: 'day',
  };

  if (timeParams.since) {
    const sinceTs = toUnixTimestamp(timeParams.since, false);
    if (sinceTs !== null) params.since = sinceTs;
  }
  if (timeParams.until) {
    const untilTs = toUnixTimestamp(timeParams.until, true);
    if (untilTs !== null) params.until = untilTs;
  }

  let dateWindowTruncated = false;
  // Cap Graph API request window to Meta's maximum 30-day (2,592,000s) Insights limit
  if (params.since && params.until && (params.until - params.since >= 2592000)) {
    dateWindowTruncated = true;
    params.until = params.since + (30 * 24 * 60 * 60 - 1);
  }

  const response = await fetchGraphApi(`/${instagramAccountId}/insights`, accessToken, params, userId);
  const metricsData = Array.isArray(response.data) ? response.data : [];

  const requestedMetrics = params.metric.split(',').map((m) => m.trim()).filter(Boolean);

  const returnedMetricsMap = new Map();
  metricsData.forEach((item) => {
    if (item && item.name) {
      returnedMetricsMap.set(item.name, {
        name: item.name,
        period: item.period || params.period || 'day',
        title: item.title || item.name,
        description: item.description || null,
        values: Array.isArray(item.values)
          ? item.values.map((v) => ({
              value: v.value,
              endTime: v.end_time,
            }))
          : [],
      });
    }
  });

  const normalizedMetrics = requestedMetrics.map((metricName) => {
    if (returnedMetricsMap.has(metricName)) {
      return returnedMetricsMap.get(metricName);
    }
    return {
      name: metricName,
      period: params.period || 'day',
      title: metricName,
      description: null,
      values: [],
    };
  });

  metricsData.forEach((item) => {
    if (item && item.name && !requestedMetrics.includes(item.name)) {
      normalizedMetrics.push(returnedMetricsMap.get(item.name));
    }
  });

  return {
    instagramAccountId,
    metrics: normalizedMetrics,
    dateWindowTruncated,
    warning: dateWindowTruncated ? "Instagram Insights date window was capped to Meta's maximum 30-day limit" : null,
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
    balance: parseNumericMetric(acc.balance),
    spendCap: parseNumericMetric(acc.spend_cap),
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
    dailyBudget: parseNumericMetric(c.daily_budget),
    lifetimeBudget: parseNumericMetric(c.lifetime_budget),
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
    dailyBudget: parseNumericMetric(adSet.daily_budget),
    lifetimeBudget: parseNumericMetric(adSet.lifetime_budget),
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
    const spend = parseNumericMetric(row.spend);
    const impressions = parseNumericMetric(row.impressions);
    const clicks = parseNumericMetric(row.clicks);
    const reach = parseNumericMetric(row.reach);

    // Derived metric fallback logic
    let ctr = null;
    if (row.ctr !== undefined && row.ctr !== null && row.ctr !== '') {
      const parsedCtr = parseNumericMetric(row.ctr);
      ctr = parsedCtr !== null ? Number(parsedCtr.toFixed(4)) : null;
    } else if (clicks !== null && impressions !== null && impressions > 0) {
      ctr = Number(((clicks / impressions) * 100).toFixed(4));
    }

    let cpc = null;
    if (row.cpc !== undefined && row.cpc !== null && row.cpc !== '') {
      const parsedCpc = parseNumericMetric(row.cpc);
      cpc = parsedCpc !== null ? Number(parsedCpc.toFixed(4)) : null;
    } else if (spend !== null && clicks !== null && clicks > 0) {
      cpc = Number((spend / clicks).toFixed(4));
    }

    let cpm = null;
    if (row.cpm !== undefined && row.cpm !== null && row.cpm !== '') {
      const parsedCpm = parseNumericMetric(row.cpm);
      cpm = parsedCpm !== null ? Number(parsedCpm.toFixed(4)) : null;
    } else if (spend !== null && impressions !== null && impressions > 0) {
      cpm = Number(((spend / impressions) * 1000).toFixed(4));
    }

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
      ctr,
      cpc,
      cpm,
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
  let pages = [];
  let pagesError = null;
  try {
    pages = await getFacebookPages(accessToken, userId);
    console.log(`[Meta Graph API] Asset Discovery | GET /me/accounts returned ${pages.length} pages`);
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 429 || error.metaCode === 190) {
      throw error;
    }
    console.log(`[Meta Graph API] Asset Discovery | getFacebookPages failed (${error.message}) - continuing with other assets`);
    pagesError = error.message;
    pages = [];
  }

  const instagramAccounts = [];
  const seenIgIds = new Set();

  for (const page of pages) {
    if (!page.pageToken) {
      try {
        page.pageToken = await getPageAccessToken(page.pageId, accessToken, userId);
        console.log(`[Meta Graph API] Asset Discovery | Fetched pageToken for Page ID ${page.pageId} (Success)`);
      } catch (err) {
        if (err.statusCode === 429) throw err;
        console.log(`[Meta Graph API] Asset Discovery | Fetched pageToken for Page ID ${page.pageId} (Failed: ${err.metaCode || 'UNKNOWN'})`);
        page.pageToken = null;
      }
    }

    if (page.instagramAccount && !seenIgIds.has(page.instagramAccount.instagramAccountId)) {
      seenIgIds.add(page.instagramAccount.instagramAccountId);
      instagramAccounts.push(page.instagramAccount);
    }
  }

  let adAccounts = [];
  let adAccountsError = null;
  try {
    adAccounts = await getAdAccounts(accessToken, userId);
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 429 || error.metaCode === 190) {
      throw error;
    }
    console.log(`[Meta Graph API] Asset Discovery | getAdAccounts failed (${error.message})`);
    adAccountsError = error.message;
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
    errors: {
      pages: pagesError,
      adAccounts: adAccountsError,
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
  parseNumericMetric,
  getFacebookPageDemographics,
  deriveReactionsFromInsights,
  extractShareCount,
  extractCommentCount,
  extractReactionCount,
  extractReactionBreakdown,
};
