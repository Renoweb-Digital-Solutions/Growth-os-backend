// Reason: We need a persistent, user-specific record of authorized LinkedIn assets (Ad Accounts for the Ads app, Company Pages/Organizations for the Community app).
// How: Stores assets per authenticated user and per app type with compound uniqueness on { userId, appType, assetId } ensuring multi-tenant isolation and per-user asset selection.

const mongoose = require('mongoose');

const linkedInAssetSchema = new mongoose.Schema(
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
    assetId: {
      type: String, // Numeric or clean ID string e.g. "501234567" or "12345678"
      required: true,
    },
    assetUrn: {
      type: String, // Full URN e.g. "urn:li:sponsoredAccount:501234567" or "urn:li:organization:12345678"
      required: true,
    },
    assetType: {
      type: String,
      enum: ['ad_account', 'organization'],
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    vanityName: {
      type: String,
      default: null,
    },
    logoUrl: {
      type: String,
      default: null,
    },
    organizationUrn: {
      type: String,
      default: null,
    },
    currency: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      default: 'ACTIVE',
    },
    isSelected: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Compound unique index ensuring a user does not have duplicate records for the same asset within an app
linkedInAssetSchema.index({ userId: 1, appType: 1, assetId: 1 }, { unique: true });

module.exports = mongoose.model('LinkedInAsset', linkedInAssetSchema);
