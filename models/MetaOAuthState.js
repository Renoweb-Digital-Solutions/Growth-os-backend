const mongoose = require('mongoose');

const metaOAuthStateSchema = new mongoose.Schema({
  state: {
    type: String,
    required: true,
    unique: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600, // MongoDB TTL index to clean up state document after 10 minutes
  },
});

module.exports = mongoose.model('MetaOAuthState', metaOAuthStateSchema);
