// Reason: Persistent historical storage for daily X (Twitter) analytics snapshots.
// How: Stores account-level metrics, engagement metrics, top/recent posts, and derived statistics for a specific UTC calendar date.
// Ensures idempotent writes with compound index { connectionId: 1, snapshotDate: 1 } and tracks data freshness / partial failure status.

const mongoose = require('mongoose');

const xAnalyticsSnapshotSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'XIntegration',
      required: true,
      index: true,
    },
    xUserId: {
      type: String,
      required: true,
      index: true,
    },
    snapshotDate: {
      type: String, // Format: YYYY-MM-DD (UTC)
      required: true,
      index: true,
    },
    accountMetrics: {
      followersCount: { type: Number, default: 0 },
      followingCount: { type: Number, default: 0 },
      tweetCount: { type: Number, default: 0 },
      listedCount: { type: Number, default: 0 },
    },
    engagementMetrics: {
      totalImpressions: { type: Number, default: 0 },
      totalLikes: { type: Number, default: 0 },
      totalRetweets: { type: Number, default: 0 },
      totalReplies: { type: Number, default: 0 },
      totalQuotes: { type: Number, default: 0 },
      totalBookmarks: { type: Number, default: 0 },
      totalEngagements: { type: Number, default: 0 },
      engagementRateByImpressions: { type: Number, default: 0 },
      engagementRateByFollowers: { type: Number, default: 0 },
      urlClicks: { type: Number, default: null },
      userProfileClicks: { type: Number, default: null },
    },
    contentSummary: {
      totalPostsEvaluated: { type: Number, default: 0 },
      postsWithMedia: { type: Number, default: 0 },
      postsWithLinks: { type: Number, default: 0 },
      videoViews: { type: Number, default: 0 },
      publishingFrequencyPerDay: { type: Number, default: 0 },
    },
    topPosts: [
      {
        id: String,
        text: String,
        createdAt: Date,
        impressions: Number,
        likes: Number,
        retweets: Number,
        replies: Number,
        quotes: Number,
        bookmarks: Number,
        totalEngagements: Number,
        engagementRate: Number,
        hasMedia: Boolean,
        hasLinks: Boolean,
      },
    ],
    recentPosts: [
      {
        id: String,
        text: String,
        createdAt: Date,
        conversationId: String,
        metrics: {
          impressions: Number,
          likes: Number,
          retweets: Number,
          replies: Number,
          quotes: Number,
          bookmarks: Number,
          totalEngagements: Number,
          urlClicks: Number,
          userProfileClicks: Number,
        },
        media: [
          {
            mediaKey: String,
            type: String,
            url: String,
            previewImageUrl: String,
            durationMs: Number,
            viewCount: Number,
          },
        ],
        urls: [String],
      },
    ],
    dailyActivity: [
      {
        date: String, // YYYY-MM-DD
        postCount: Number,
        impressions: Number,
        likes: Number,
        retweets: Number,
        replies: Number,
        engagements: Number,
      },
    ],
    status: {
      type: String,
      enum: ['success', 'partial', 'failed'],
      default: 'success',
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
    error: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound unique index ensuring idempotency: one snapshot per connection per UTC date
xAnalyticsSnapshotSchema.index({ connectionId: 1, snapshotDate: 1 }, { unique: true });

module.exports = mongoose.model('XAnalyticsSnapshot', xAnalyticsSnapshotSchema);

