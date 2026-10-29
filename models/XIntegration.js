// Reason: Independent, persistent connection record for a customer's own connected X (Twitter) account.
// How: Stores connection status, X user profile info, OAuth 2.0 access & refresh tokens, and granted scopes.
// Provides a toSafeObject method to guarantee tokens and secrets are never leaked to the client or logs.

const mongoose = require('mongoose');

const xIntegrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    xUserId: {
      type: String,
      required: true,
      index: true,
    },
    username: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
    profileImageUrl: {
      type: String,
      default: null,
    },
    description: {
      type: String,
      default: null,
    },
    accessToken: {
      type: String,
      default: null,
    },
    refreshToken: {
      type: String,
      default: null,
    },
    tokenExpiresAt: {
      type: Date,
      default: null,
    },
    grantedScopes: [
      {
        type: String,
      },
    ],
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'expired'],
      default: 'connected',
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

/**
 * Returns a sanitized object representation safe for frontend consumption.
 * Explicitly strips accessToken, refreshToken, and any sensitive internals.
 */
xIntegrationSchema.methods.toSafeObject = function () {
  const isExpired = this.tokenExpiresAt && new Date() > new Date(this.tokenExpiresAt);
  const currentStatus = isExpired && !this.refreshToken ? 'expired' : this.status;

  return {
    id: this._id,
    userId: this.userId,
    connected: currentStatus === 'connected',
    status: currentStatus,
    account: {
      xUserId: this.xUserId,
      username: this.username,
      name: this.name,
      profileImageUrl: this.profileImageUrl,
      description: this.description,
    },
    grantedScopes: this.grantedScopes || [],
    tokenExpiresAt: this.tokenExpiresAt,
    lastSyncedAt: this.lastSyncedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('XIntegration', xIntegrationSchema);

