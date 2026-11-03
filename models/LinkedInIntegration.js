// Reason: We need independent, persistent connection records for each LinkedIn developer app associated with a Growmentum user.
// How: Stores connection status, member identity (via OpenID Connect), scopes, and tokens with compound uniqueness on { userId, appType } ensuring strict app isolation and user scoping. Provides a toSafeObject method to guarantee tokens are never leaked to the client.

const mongoose = require('mongoose');

const linkedInIntegrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    appType: {
      type: String,
      enum: ['ads', 'community'],
      required: true,
      index: true,
    },
    linkedinMemberId: {
      type: String,
      default: null,
    },
    linkedinMemberName: {
      type: String,
      default: null,
    },
    linkedinMemberEmail: {
      type: String,
      default: null,
    },
    linkedinMemberPicture: {
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
    refreshTokenExpiresAt: {
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
    approvalStatus: {
      type: String,
      enum: ['approved', 'pending_approval', 'rejected', 'not_requested'],
      default: 'pending_approval',
    },
    selectedAssetId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound unique index ensuring each user can have at most one connection per LinkedIn app type
linkedInIntegrationSchema.index({ userId: 1, appType: 1 }, { unique: true });

/**
 * Returns a sanitized object representation safe for frontend consumption.
 * Explicitly omits accessToken, refreshToken, and any sensitive secrets.
 */
linkedInIntegrationSchema.methods.toSafeObject = function (extra = {}) {
  const isExpired = this.tokenExpiresAt && new Date() > new Date(this.tokenExpiresAt);
  const currentStatus = isExpired && !this.refreshToken ? 'expired' : this.status;

  return {
    id: this._id,
    userId: this.userId,
    appType: this.appType,
    appName: this.appType === 'ads' ? 'Growmentum' : 'Growmentum-community',
    connected: currentStatus === 'connected',
    status: currentStatus,
    approvalStatus: this.approvalStatus,
    member: {
      id: this.linkedinMemberId,
      name: this.linkedinMemberName,
      email: this.linkedinMemberEmail,
      picture: this.linkedinMemberPicture,
    },
    grantedScopes: this.grantedScopes || [],
    selectedAssetId: this.selectedAssetId,
    tokenExpiresAt: this.tokenExpiresAt,
    connectedAt: this.createdAt,
    updatedAt: this.updatedAt,
    ...extra,
  };
};

module.exports = mongoose.model('LinkedInIntegration', linkedInIntegrationSchema);
