// Reason: Orchestrates X (Twitter) Analytics data retrieval, lazy daily refresh, metric normalization, and historical comparison.
// How: Implements the required cost-control policy:
// 1. Checks Redis cache for today's snapshot (0 API calls on hit).
// 2. Checks MongoDB persistent storage on Redis miss (0 API calls on hit).
// 3. Performs single-flight, distributed-locked X API fetch only when refresh is due.
// 4. Normalizes public and organic metrics into dashboard-ready KPI categories.
// 5. Preserves previous successful snapshots when a refresh fails, returning them marked isStale: true.

const XIntegration = require('../models/XIntegration');
const XAnalyticsSnapshot = require('../models/XAnalyticsSnapshot');
const xAuthService = require('./xAuthService');
const xApiService = require('./xApiService');
const xRedisService = require('./xRedisService');

/**
 * Returns today's UTC calendar date string (YYYY-MM-DD)
 */
const getTodayUtcString = () => {
  return new Date().toISOString().split('T')[0];
};

const getUTCToday = getTodayUtcString;

/**
 * Formats a snapshot document into standard Growmentum dashboard response format
 */
const formatSnapshotResponse = (snapshot, previousSnapshot = null) => {
  const current = snapshot.accountMetrics || snapshot.audience || snapshot.account?.metrics || {};
  const prev = previousSnapshot?.accountMetrics || previousSnapshot?.audience || previousSnapshot?.account?.metrics || null;

  const followersDelta = prev ? (current.followersCount || 0) - (prev.followersCount || 0) : null;
  const followingDelta = prev ? (current.followingCount || 0) - (prev.followingCount || 0) : null;
  const tweetCountDelta = prev ? (current.tweetCount || 0) - (prev.tweetCount || 0) : null;

  const eng = snapshot.engagementMetrics || snapshot.engagement || {};
  const summary = snapshot.contentSummary || {};

  const totalImpressions = eng.totalImpressions ?? snapshot.reach?.totalImpressions ?? 0;
  const totalVideoViews = summary.videoViews ?? snapshot.reach?.totalVideoViews ?? 0;
  const totalLikes = eng.totalLikes ?? eng.likes ?? 0;
  const totalRetweets = eng.totalRetweets ?? eng.retweets ?? 0;
  const totalReplies = eng.totalReplies ?? eng.replies ?? 0;
  const totalQuotes = eng.totalQuotes ?? eng.quotes ?? 0;
  const totalBookmarks = eng.totalBookmarks ?? eng.bookmarks ?? 0;
  const totalEngagements = eng.totalEngagements ?? (totalLikes + totalRetweets + totalReplies + totalQuotes + totalBookmarks);

  return {
    snapshotDate: snapshot.snapshotDate,
    account: {
      xUserId: snapshot.xUserId,
      metrics: {
        followersCount: current.followersCount || 0,
        followingCount: current.followingCount || 0,
        tweetCount: current.tweetCount || 0,
        listedCount: current.listedCount || 0,
      },
      comparison: {
        followersDelta,
        followingDelta,
        tweetCountDelta,
      },
    },
    audience: {
      followersCount: current.followersCount || 0,
      followingCount: current.followingCount || 0,
      tweetCount: current.tweetCount || 0,
      listedCount: current.listedCount || 0,
    },
    reach: {
      totalImpressions,
      totalVideoViews,
    },
    engagement: {
      totalImpressions,
      totalLikes,
      totalRetweets,
      totalReplies,
      totalQuotes,
      totalBookmarks,
      totalEngagements,
      likes: totalLikes,
      retweets: totalRetweets,
      replies: totalReplies,
      quotes: totalQuotes,
      bookmarks: totalBookmarks,
      engagementRateByImpressions: Number((snapshot.engagementMetrics?.engagementRateByImpressions || 0).toFixed(4)),
      engagementRateByFollowers: Number((snapshot.engagementMetrics?.engagementRateByFollowers || 0).toFixed(4)),
      urlClicks: snapshot.engagementMetrics?.urlClicks ?? null,
      userProfileClicks: snapshot.engagementMetrics?.userProfileClicks ?? null,
    },
    contentSummary: {
      totalPostsEvaluated: snapshot.contentSummary?.totalPostsEvaluated || 0,
      postsWithMedia: snapshot.contentSummary?.postsWithMedia || 0,
      postsWithLinks: snapshot.contentSummary?.postsWithLinks || 0,
      videoViews: totalVideoViews,
      publishingFrequencyPerDay: Number((snapshot.contentSummary?.publishingFrequencyPerDay || 0).toFixed(2)),
    },
    topPosts: snapshot.topPosts || [],
    dailyActivity: (snapshot.dailyActivity || []).map((d) => ({
      ...d,
      postsCount: d.postsCount || d.postCount || 0,
    })),
    recentPosts: snapshot.recentPosts || [],
  };
};

/**
 * Ensures integration has a valid, unexpired access token (auto-refreshes if needed)
 */
const getValidAccessToken = async (integration) => {
  if (!integration || integration.status !== 'connected' || !integration.accessToken) {
    const err = new Error('X account is not connected');
    err.statusCode = 401;
    throw err;
  }

  // 5-minute safety buffer before tokenExpiresAt
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;
  const isExpiring = integration.tokenExpiresAt && new Date(integration.tokenExpiresAt.getTime() - bufferMs) <= now;

  if (isExpiring && integration.refreshToken) {
    try {
      console.log(`[X_AUTH] Auto-refreshing expired token for userId=${integration.userId}`);
      const refreshed = await xAuthService.refreshAccessToken(integration.refreshToken);

      integration.accessToken = refreshed.accessToken;
      integration.refreshToken = refreshed.refreshToken;
      if (refreshed.expiresIn) {
        integration.tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
      }
      integration.status = 'connected';
      await integration.save();
    } catch (refreshErr) {
      console.log(`[X_AUTH] Token refresh failed: ${refreshErr.message}`);
      integration.status = 'expired';
      await integration.save();
      const err = new Error('X authorization has expired. Please reconnect your X account');
      err.statusCode = 401;
      throw err;
    }
  }

  return integration.accessToken;
};

/**
 * Computes analytics and aggregates recent posts into daily bins and KPIs
 */
const computeAnalyticsFromXData = (accountData, tweetsData, snapshotDate) => {
  const tweets = tweetsData.tweets || [];
  const accountMetrics = accountData.publicMetrics || {};

  let totalImpressions = 0;
  let totalLikes = 0;
  let totalRetweets = 0;
  let totalReplies = 0;
  let totalQuotes = 0;
  let totalBookmarks = 0;
  let totalUrlClicks = 0;
  let hasUrlClicks = false;
  let totalProfileClicks = 0;
  let hasProfileClicks = false;

  let postsWithMedia = 0;
  let postsWithLinks = 0;
  let totalVideoViews = 0;

  const dailyMap = new Map();

  tweets.forEach((tweet) => {
    const m = tweet.metrics || {};
    totalImpressions += m.impressions || 0;
    totalLikes += m.likes || 0;
    totalRetweets += m.retweets || 0;
    totalReplies += m.replies || 0;
    totalQuotes += m.quotes || 0;
    totalBookmarks += m.bookmarks || 0;

    if (typeof m.urlClicks === 'number') {
      totalUrlClicks += m.urlClicks;
      hasUrlClicks = true;
    }
    if (typeof m.userProfileClicks === 'number') {
      totalProfileClicks += m.userProfileClicks;
      hasProfileClicks = true;
    }

    if (tweet.hasMedia) {
      postsWithMedia++;
      (tweet.media || []).forEach((med) => {
        if (typeof med.viewCount === 'number') {
          totalVideoViews += med.viewCount;
        }
      });
    }

    if (tweet.hasLinks) {
      postsWithLinks++;
    }

    // Daily bin aggregation
    const dateStr = tweet.createdAt ? new Date(tweet.createdAt).toISOString().split('T')[0] : snapshotDate;
    if (!dailyMap.has(dateStr)) {
      dailyMap.set(dateStr, {
        date: dateStr,
        postCount: 0,
        impressions: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        engagements: 0,
      });
    }

    const bin = dailyMap.get(dateStr);
    bin.postCount++;
    bin.impressions += m.impressions || 0;
    bin.likes += m.likes || 0;
    bin.retweets += m.retweets || 0;
    bin.replies += m.replies || 0;
    bin.engagements += m.totalEngagements || 0;
  });

  const totalEngagements = totalLikes + totalRetweets + totalReplies + totalQuotes + totalBookmarks;
  const followersCount = accountMetrics.followersCount || 0;

  const engagementRateByImpressions = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
  const engagementRateByFollowers = followersCount > 0 ? (totalEngagements / followersCount) * 100 : 0;

  // Calculate publishing frequency (posts per day over observed date range, default 30 days)
  const publishingFrequencyPerDay = tweets.length > 0 ? tweets.length / 30 : 0;

  // Identify top performing posts ranked by total engagements
  const sortedPosts = [...tweets].sort((a, b) => (b.metrics?.totalEngagements || 0) - (a.metrics?.totalEngagements || 0));
  const topPosts = sortedPosts.slice(0, 5).map((p) => ({
    id: p.id,
    text: p.text,
    createdAt: p.createdAt,
    impressions: p.metrics?.impressions || 0,
    likes: p.metrics?.likes || 0,
    retweets: p.metrics?.retweets || 0,
    replies: p.metrics?.replies || 0,
    quotes: p.metrics?.quotes || 0,
    bookmarks: p.metrics?.bookmarks || 0,
    totalEngagements: p.metrics?.totalEngagements || 0,
    engagementRate: p.metrics?.impressions > 0 ? Number(((p.metrics.totalEngagements / p.metrics.impressions) * 100).toFixed(4)) : 0,
    hasMedia: p.hasMedia,
    hasLinks: p.hasLinks,
  }));

  // Daily activity sorted chronologically
  const dailyActivity = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    accountMetrics: {
      followersCount,
      followingCount: accountMetrics.followingCount || 0,
      tweetCount: accountMetrics.tweetCount || 0,
      listedCount: accountMetrics.listedCount || 0,
    },
    engagementMetrics: {
      totalImpressions,
      totalLikes,
      totalRetweets,
      totalReplies,
      totalQuotes,
      totalBookmarks,
      totalEngagements,
      engagementRateByImpressions,
      engagementRateByFollowers,
      urlClicks: hasUrlClicks ? totalUrlClicks : null,
      userProfileClicks: hasProfileClicks ? totalProfileClicks : null,
    },
    contentSummary: {
      totalPostsEvaluated: tweets.length,
      postsWithMedia,
      postsWithLinks,
      videoViews: totalVideoViews,
      publishingFrequencyPerDay,
    },
    topPosts,
    recentPosts: tweets.slice(0, 20),
    dailyActivity,
  };
};

/**
 * Main analytics retriever implementing the Lazy Daily Refresh Policy
 */
const getAnalyticsOverview = async (userOrIntegration) => {
  let integration;
  if (userOrIntegration && typeof userOrIntegration === 'object' && userOrIntegration.userId) {
    integration = userOrIntegration;
  } else {
    integration = await XIntegration.findOne({ userId: userOrIntegration });
  }

  if (!integration || integration.status !== 'connected') {
    const err = new Error('No connected X account found for this user');
    err.statusCode = 404;
    throw err;
  }

  const todayUtc = getTodayUtcString();

  // --------------------------------------------------------------------------
  // STEP 1: Check Redis Cache (0 API calls on hit)
  // --------------------------------------------------------------------------
  const cachedData = await xRedisService.getSnapshot(integration._id, todayUtc);
  if (cachedData) {
    return {
      success: true,
      data: cachedData,
      meta: {
        source: 'redis_cache',
        cacheHit: true,
        isStale: false,
        snapshotDate: todayUtc,
        connectionId: integration._id,
        xUserId: integration.xUserId,
        cacheEngine: xRedisService.getCacheStatus().engine,
        fetchedAt: cachedData.fetchedAt || new Date().toISOString(),
      },
    };
  }

  // --------------------------------------------------------------------------
  // STEP 2: Check MongoDB Persistent Storage (0 API calls on hit)
  // --------------------------------------------------------------------------
  const dbSnapshot = await XAnalyticsSnapshot.findOne({
    connectionId: integration._id,
    snapshotDate: todayUtc,
    status: 'success',
  });

  if (dbSnapshot) {
    // Previous day snapshot for comparison deltas
    const prevSnapshot = await XAnalyticsSnapshot.findOne({
      connectionId: integration._id,
      snapshotDate: { $lt: todayUtc },
      status: 'success',
    }).sort({ snapshotDate: -1 });

    const formatted = formatSnapshotResponse(dbSnapshot, prevSnapshot);
    formatted.fetchedAt = dbSnapshot.fetchedAt;

    // Repopulate Redis cache
    await xRedisService.setSnapshot(integration._id, todayUtc, formatted);

    return {
      success: true,
      data: formatted,
      meta: {
        source: 'database_snapshot',
        cacheHit: false,
        isStale: false,
        snapshotDate: todayUtc,
        connectionId: integration._id,
        xUserId: integration.xUserId,
        cacheEngine: xRedisService.getCacheStatus().engine,
        fetchedAt: dbSnapshot.fetchedAt,
      },
    };
  }

  // --------------------------------------------------------------------------
  // STEP 3: Refresh Due — Execute Coordinated Single-Flight Fetch with Distributed Lock
  // --------------------------------------------------------------------------
  return await xRedisService.executeSingleFlight(integration._id, async () => {
    // Acquire distributed lock to prevent concurrent refresh stampedes
    const lockToken = await xRedisService.acquireLock(integration._id);

    if (!lockToken) {
      // Lock held by another process: check DB again or serve previous snapshot marked stale
      const currentDb = await XAnalyticsSnapshot.findOne({
        connectionId: integration._id,
        snapshotDate: todayUtc,
        status: 'success',
      });
      if (currentDb) {
        const formatted = formatSnapshotResponse(currentDb);
        return {
          success: true,
          data: formatted,
          meta: { source: 'database_snapshot', isStale: false, snapshotDate: todayUtc },
        };
      }

      // Serve previous snapshot if available
      const prev = await XAnalyticsSnapshot.findOne({
        connectionId: integration._id,
        status: 'success',
      }).sort({ snapshotDate: -1 });

      if (prev) {
        const formatted = formatSnapshotResponse(prev);
        formatted.isStale = true;
        formatted.staleReason = 'Refresh currently in progress by concurrent request';
        return {
          success: true,
          data: formatted,
          meta: {
            source: 'stale_snapshot',
            cacheHit: false,
            isStale: true,
            servedStaleFallback: true,
            staleReason: 'Refresh currently in progress by concurrent request',
            lastSuccessfulRefresh: prev.fetchedAt,
          },
        };
      }
    }

    try {
      // Re-verify token validity
      const accessToken = await xAuthService.getValidAccessToken(integration);

      // Fetch fresh data from X API v2
      const [accountData, tweetsData] = await Promise.all([
        xApiService.getAuthenticatedUser(accessToken),
        xApiService.getUserTweets(integration.xUserId, accessToken, { maxResults: 100 }),
      ]);

      // Normalize metrics and compute derived insights
      const analyticsData = computeAnalyticsFromXData(accountData, tweetsData, todayUtc);

      // Idempotently persist snapshot to MongoDB
      const savedSnapshot = await XAnalyticsSnapshot.findOneAndUpdate(
        {
          connectionId: integration._id,
          snapshotDate: todayUtc,
        },
        {
          userId: integration.userId,
          connectionId: integration._id,
          xUserId: integration.xUserId,
          snapshotDate: todayUtc,
          ...analyticsData,
          status: 'success',
          fetchedAt: new Date(),
          error: null,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Update integration profile fields if changed
      integration.name = accountData.name;
      integration.username = accountData.username;
      integration.profileImageUrl = accountData.profileImageUrl;
      integration.description = accountData.description;
      integration.lastSyncedAt = new Date();
      await integration.save();

      // Find previous day snapshot for comparison deltas
      const previousSnapshot = await XAnalyticsSnapshot.findOne({
        connectionId: integration._id,
        snapshotDate: { $lt: todayUtc },
        status: 'success',
      }).sort({ snapshotDate: -1 });

      const formattedResponse = formatSnapshotResponse(savedSnapshot, previousSnapshot);
      formattedResponse.fetchedAt = savedSnapshot.fetchedAt;

      // Populate Redis cache
      await xRedisService.setSnapshot(integration._id, todayUtc, formattedResponse);

      return {
        success: true,
        data: formattedResponse,
        meta: {
          source: 'x_api_fresh',
          isStale: false,
          snapshotDate: todayUtc,
          connectionId: integration._id,
          xUserId: integration.xUserId,
          cacheEngine: xRedisService.getCacheStatus().engine,
          fetchedAt: savedSnapshot.fetchedAt,
        },
      };
    } catch (refreshError) {
      console.log(`[X_ANALYTICS] Refresh failed for connectionId=${integration._id}: ${refreshError.message}`);

      // Graceful degradation: find most recent previous successful snapshot
      const previousSnapshot = await XAnalyticsSnapshot.findOne({
        connectionId: integration._id,
        status: 'success',
      }).sort({ snapshotDate: -1 });

      if (previousSnapshot) {
        const formatted = formatSnapshotResponse(previousSnapshot);
        formatted.isStale = true;
        formatted.staleReason = refreshError.message;
        return {
          success: true,
          data: formatted,
          meta: {
            source: 'stale_snapshot',
            cacheHit: false,
            isStale: true,
            servedStaleFallback: true,
            staleReason: refreshError.message,
            lastSuccessfulRefresh: previousSnapshot.fetchedAt,
            partialFailure: true,
            cacheEngine: xRedisService.getCacheStatus().engine,
          },
        };
      }

      // No previous snapshot exists: rethrow error
      throw refreshError;
    } finally {
      if (lockToken) {
        await xRedisService.releaseLock(integration._id, lockToken);
      }
    }
  });
};

/**
 * Returns recent posts analytics list
 */
const getRecentPosts = async (userId, options = {}) => {
  const overviewResult = await getAnalyticsOverview(userId);
  const posts = overviewResult.data?.recentPosts || [];

  return {
    success: true,
    data: {
      posts,
      count: posts.length,
    },
    meta: overviewResult.meta,
  };
};

/**
 * Helper to normalize and derive snapshot data directly from given user and tweets structures
 */
const normalizeSnapshotData = ({ user, tweets, priorSnapshot = null, snapshotDate = getTodayUtcString() }) => {
  const rawUser = user || {};
  const pubUser = rawUser.publicMetrics || rawUser.public_metrics || rawUser;
  const normalizedAccount = {
    publicMetrics: {
      followersCount: pubUser.followersCount ?? pubUser.followers_count ?? 0,
      followingCount: pubUser.followingCount ?? pubUser.following_count ?? 0,
      tweetCount: pubUser.tweetCount ?? pubUser.tweet_count ?? 0,
      listedCount: pubUser.listedCount ?? pubUser.listed_count ?? 0,
    },
  };

  const rawTweets = Array.isArray(tweets) ? tweets : (tweets?.tweets || tweets?.data || []);
  const normalizedTweetsList = rawTweets.map((t) => {
    const pub = t.public_metrics || t.metrics || {};
    const likes = pub.like_count ?? pub.likes ?? 0;
    const retweets = pub.retweet_count ?? pub.retweets ?? 0;
    const replies = pub.reply_count ?? pub.replies ?? 0;
    const quotes = pub.quote_count ?? pub.quotes ?? 0;
    const bookmarks = pub.bookmark_count ?? pub.bookmarks ?? 0;
    const impressions = pub.impression_count ?? pub.impressions ?? 0;
    const totalEngagements = likes + retweets + replies + quotes + bookmarks;

    const mediaList = (t.media || []).map((m) => ({
      ...m,
      viewCount: m.viewCount ?? m.public_metrics?.view_count ?? 0,
    }));

    return {
      id: t.id,
      text: t.text || '',
      createdAt: t.created_at || t.createdAt,
      metrics: {
        impressions,
        likes,
        retweets,
        replies,
        quotes,
        bookmarks,
        totalEngagements,
        urlClicks: t.metrics?.urlClicks ?? null,
        userProfileClicks: t.metrics?.userProfileClicks ?? null,
      },
      media: mediaList,
      hasMedia: mediaList.length > 0,
      hasLinks: Boolean(t.hasLinks || (t.entities && t.entities.urls?.length)),
    };
  });

  const computed = computeAnalyticsFromXData(normalizedAccount, { tweets: normalizedTweetsList }, snapshotDate);
  const formatted = formatSnapshotResponse(computed, priorSnapshot);
  return formatted;
};

module.exports = {
  getTodayUtcString,
  getUTCToday,
  getValidAccessToken,
  computeAnalyticsFromXData,
  normalizeSnapshotData,
  formatSnapshotResponse,
  getAnalyticsOverview,
  getAccountAnalyticsOverview: getAnalyticsOverview,
  getRecentPosts,
};
