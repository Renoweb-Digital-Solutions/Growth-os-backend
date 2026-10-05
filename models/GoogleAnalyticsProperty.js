const mongoose = require('mongoose');

const googleAnalyticsPropertySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    googleAccountId: {
      type: String,
      default: '',
    },
    googleAccountName: {
      type: String,
      default: '',
    },
    propertyId: {
      type: String, // Clean numeric ID string e.g. "123456789"
      required: true,
    },
    propertyName: {
      type: String, // Full resource name e.g. "properties/123456789"
      required: true,
    },
    displayName: {
      type: String,
      required: true,
    },
    timeZone: {
      type: String,
      default: 'UTC',
    },
    currencyCode: {
      type: String,
      default: 'USD',
    },
    propertyType: {
      type: String,
      default: 'PROPERTY_TYPE_ORDINARY',
    },
    dataStreams: [
      {
        streamId: String,
        displayName: String,
        type: String, // WEB_DATA_STREAM, IOS_APP_DATA_STREAM, ANDROID_APP_DATA_STREAM
        measurementId: String,
      },
    ],
    isSelected: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Compound unique index ensuring a user does not have duplicate records for the same property ID
googleAnalyticsPropertySchema.index({ userId: 1, propertyId: 1 }, { unique: true });

module.exports = mongoose.model('GoogleAnalyticsProperty', googleAnalyticsPropertySchema);
