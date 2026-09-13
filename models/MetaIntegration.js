const mongoose = require('mongoose');

const metaIntegrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    metaUserId: {
      type: String,
      required: true,
    },
    accessToken: {
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

module.exports = mongoose.model('MetaIntegration', metaIntegrationSchema);
