// Reason: External X (Twitter) API v2 client encapsulating all outbound REST calls.
// How: Implements authenticated calls for /2/users/me and /2/users/:id/tweets, extracts public/organic/media metrics,
// handles rate limits (429) with reset timestamp parsing, normalizes provider errors, and strictly redacts tokens from logs.

const X_API_BASE_URL = 'https://api.x.com/2';

/**
 * Base fetch wrapper with error normalization and token sanitization
 */
const fetchXApi = async (endpoint, accessToken, params = {}) => {
  const urlObj = new URL(`${X_API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      urlObj.searchParams.append(key, value);
    }
  });

  const reqId = Math.random().toString(36).substring(2, 9);
  const safeEndpoint = endpoint.split('?')[0];

  console.log(`[X_API] requestId=${reqId} endpoint=${safeEndpoint} timestamp=${new Date().toISOString()} status=LAUNCHING`);

  let response;
  try {
    response = await fetch(urlObj.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
  } catch (networkError) {
    console.log(`[X_API] requestId=${reqId} endpoint=${safeEndpoint} status=NETWORK_ERROR`);
    const err = new Error(`X API network connection failed: ${networkError.message}`);
    err.statusCode = 502;
    err.cause = networkError;
    throw err;
  }

  // Track rate limit headers for logging & cost control
  const rateLimitRemaining = response.headers?.get ? response.headers.get('x-rate-limit-remaining') : null;
  const rateLimitReset = response.headers?.get ? response.headers.get('x-rate-limit-reset') : null;

  const data = await response.json();

  if (!response.ok || data.errors || data.error) {
    const errorDetail = data.errors && data.errors.length > 0 ? data.errors[0] : (data.error_description || data.error || data);
    const message = errorDetail?.message || errorDetail?.detail || data.title || 'X API request failed';
    const code = response.status;

    console.log(`[X_API] requestId=${reqId} endpoint=${safeEndpoint} status=${code} rateLimitRemaining=${rateLimitRemaining}`);

    // Rate Limit (429)
    if (code === 429) {
      const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset, 10) * 1000).toISOString() : 'in 15 minutes';
      const err = new Error(`X API rate limit exceeded. Window resets at ${resetTime}`);
      err.statusCode = 429;
      err.isRateLimited = true;
      err.rateLimitReset = rateLimitReset ? parseInt(rateLimitReset, 10) : null;
      err.xError = data;
      throw err;
    }

    // Token Expired or Revoked (401)
    if (code === 401) {
      const err = new Error('X API authorization token has expired or been revoked');
      err.statusCode = 401;
      err.xError = data;
      throw err;
    }

    // Forbidden / Access Denied / Plan restrictions (403)
    if (code === 403) {
      const err = new Error(`X API access denied: ${message}`);
      err.statusCode = 403;
      err.xError = data;
      throw err;
    }

    const err = new Error(`X API error (${code}): ${message}`);
    err.statusCode = code >= 400 && code < 600 ? code : 500;
    err.xError = data;
    throw err;
  }

  console.log(`[X_API] requestId=${reqId} endpoint=${safeEndpoint} status=200 rateLimitRemaining=${rateLimitRemaining}`);
  return data;
};

/**
 * Fetches authenticated user's profile and public metrics from /2/users/me
 */
const getAuthenticatedUser = async (accessToken) => {
  const fields = 'id,name,username,created_at,description,profile_image_url,public_metrics,verified,verified_type';
  const result = await fetchXApi('/users/me', accessToken, { 'user.fields': fields });

  const user = result.data || {};
  const metrics = user.public_metrics || {};

  return {
    id: user.id,
    xUserId: user.id,
    username: user.username,
    name: user.name,
    description: user.description || null,
    profileImageUrl: user.profile_image_url || null,
    createdAt: user.created_at || null,
    verified: Boolean(user.verified),
    verifiedType: user.verified_type || null,
    publicMetrics: {
      followersCount: metrics.followers_count || 0,
      followingCount: metrics.following_count || 0,
      tweetCount: metrics.tweet_count || 0,
      listedCount: metrics.listed_count || 0,
    },
    public_metrics: {
      followers_count: metrics.followers_count || 0,
      following_count: metrics.following_count || 0,
      tweet_count: metrics.tweet_count || 0,
      listed_count: metrics.listed_count || 0,
    },
  };
};

/**
 * Fetches recent posts and metrics published by an X account from /2/users/:id/tweets
 */
const getUserTweets = async (xUserIdOrOptions, maybeAccessToken = null, maybeOptions = {}) => {
  let xUserId = xUserIdOrOptions;
  let accessToken = maybeAccessToken;
  let options = maybeOptions;

  if (xUserIdOrOptions && typeof xUserIdOrOptions === 'object') {
    xUserId = xUserIdOrOptions.xUserId || xUserIdOrOptions.userId;
    accessToken = xUserIdOrOptions.accessToken;
    options = xUserIdOrOptions;
  }

  const maxResults = Math.min(Math.max(parseInt(options.maxResults || options.max_results || 100, 10), 5), 100);

  const params = {
    max_results: maxResults,
    'tweet.fields': 'id,text,created_at,public_metrics,non_public_metrics,organic_metrics,attachments,entities,conversation_id',
    expansions: 'attachments.media_keys',
    'media.fields': 'media_key,type,duration_ms,public_metrics,preview_image_url,url',
  };

  if (options.paginationToken) {
    params.pagination_token = options.paginationToken;
  }
  if (options.sinceId) {
    params.since_id = options.sinceId;
  }
  if (options.untilId) {
    params.until_id = options.untilId;
  }
  if (options.startTime) {
    params.start_time = options.startTime;
  }
  if (options.endTime) {
    params.end_time = options.endTime;
  }

  let result;
  try {
    result = await fetchXApi(`/users/${xUserId}/tweets`, accessToken, params);
  } catch (err) {
    // If organic_metrics or non_public_metrics failed due to permission or tier differences, retry with core public fields
    if (err.statusCode === 400 || err.statusCode === 403) {
      console.log(`[X_API] Extended tweet metrics request failed (${err.message}). Retrying with base public fields.`);
      const fallbackParams = {
        max_results: maxResults,
        'tweet.fields': 'id,text,created_at,public_metrics,attachments,entities,conversation_id',
        expansions: 'attachments.media_keys',
        'media.fields': 'media_key,type,duration_ms,public_metrics,preview_image_url,url',
      };
      result = await fetchXApi(`/users/${xUserId}/tweets`, accessToken, fallbackParams);
    } else {
      throw err;
    }
  }

  const tweets = Array.isArray(result.data) ? result.data : [];
  const mediaList = result.includes && Array.isArray(result.includes.media) ? result.includes.media : [];

  // Build media map for fast attachment resolution
  const mediaMap = new Map();
  mediaList.forEach((m) => {
    if (m && m.media_key) {
      mediaMap.set(m.media_key, {
        mediaKey: m.media_key,
        type: m.type,
        url: m.url || null,
        previewImageUrl: m.preview_image_url || null,
        durationMs: m.duration_ms || null,
        viewCount: m.public_metrics?.view_count ?? null,
        public_metrics: m.public_metrics || (m.public_metrics?.view_count !== undefined ? { view_count: m.public_metrics.view_count } : {}),
      });
    }
  });

  const normalizedTweets = tweets.map((tweet) => {
    const pub = tweet.public_metrics || {};
    const org = tweet.organic_metrics || {};
    const nonPub = tweet.non_public_metrics || {};

    const impressions = typeof pub.impression_count === 'number'
      ? pub.impression_count
      : (typeof org.impression_count === 'number' ? org.impression_count : (typeof nonPub.impression_count === 'number' ? nonPub.impression_count : 0));

    const likes = pub.like_count ?? org.like_count ?? 0;
    const retweets = pub.retweet_count ?? org.retweet_count ?? 0;
    const replies = pub.reply_count ?? org.reply_count ?? 0;
    const quotes = pub.quote_count ?? 0;
    const bookmarks = pub.bookmark_count ?? 0;

    const totalEngagements = likes + retweets + replies + quotes + bookmarks;
    const urlClicks = nonPub.url_link_clicks ?? org.url_link_clicks ?? null;
    const userProfileClicks = nonPub.user_profile_clicks ?? org.user_profile_clicks ?? null;

    // Resolve media attachments
    const attachedMedia = [];
    if (tweet.attachments && Array.isArray(tweet.attachments.media_keys)) {
      tweet.attachments.media_keys.forEach((key) => {
        if (mediaMap.has(key)) {
          attachedMedia.push(mediaMap.get(key));
        }
      });
    }

    // Extract URLs from entities
    const urls = [];
    if (tweet.entities && Array.isArray(tweet.entities.urls)) {
      tweet.entities.urls.forEach((u) => {
        if (u.expanded_url) urls.push(u.expanded_url);
      });
    }

    return {
      id: tweet.id,
      text: tweet.text || '',
      createdAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
      conversationId: tweet.conversation_id || null,
      metrics: {
        impressions,
        likes,
        retweets,
        replies,
        quotes,
        bookmarks,
        totalEngagements,
        urlClicks,
        userProfileClicks,
      },
      public_metrics: tweet.public_metrics || {
        like_count: likes,
        retweet_count: retweets,
        reply_count: replies,
        quote_count: quotes,
        bookmark_count: bookmarks,
        impression_count: impressions,
      },
      media: attachedMedia,
      urls,
      hasMedia: attachedMedia.length > 0,
      hasLinks: urls.length > 0,
    };
  });

  return {
    tweets: normalizedTweets,
    data: normalizedTweets,
    meta: result.meta || {},
  };
};

/**
 * Masks a token for diagnostic logging without exposing the raw secret
 */
const redactToken = (token) => {
  if (!token || typeof token !== 'string') return '[REDACTED]';
  if (token.length <= 8) return '****';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
};

module.exports = {
  fetchXApi,
  getAuthenticatedUser,
  getUserTweets,
  redactToken,
};
