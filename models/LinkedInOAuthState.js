// Reason: We need cryptographically secure, single-use, expiring OAuth state parameters for LinkedIn OAuth flows.
// How: Stores state tokens in MongoDB with an explicit TTL index (10 minutes), tied to both the Growmentum user and the specific LinkedIn app ('ads' vs 'community') to prevent CSRF, replay, and cross-app state mix-ups.

const mongoose = require('mongoose');

const linkedInOAuthStateSchema = new mongoose.Schema({
  state: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
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
  redirectUri: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600, // MongoDB TTL index to automatically purge state document after 10 minutes
  },
});

module.exports = mongoose.model('LinkedInOAuthState', linkedInOAuthStateSchema);
