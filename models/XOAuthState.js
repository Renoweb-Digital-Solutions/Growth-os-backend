// Reason: Cryptographically secure, single-use, expiring OAuth 2.0 PKCE state parameters for X.
// How: Stores state tokens and code_verifiers in MongoDB with a 10-minute TTL index, tied to the authenticated Growmentum user.

const mongoose = require('mongoose');

const xOAuthStateSchema = new mongoose.Schema({
  state: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  codeVerifier: {
    type: String,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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

module.exports = mongoose.model('XOAuthState', xOAuthStateSchema);

