const mongoose = require('mongoose');

const googleIntegrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    googleUserId: {
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
  },
  { timestamps: true }
);

module.exports = mongoose.model('GoogleIntegration', googleIntegrationSchema);
