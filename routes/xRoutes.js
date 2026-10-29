// Reason: Route definitions for X (Twitter) integration and analytics.
// How: Exposes endpoints for OAuth 2.0 PKCE connection, callback, status, disconnection,
// analytics overview (with lazy daily refresh), recent posts, and cache diagnostic status.

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const xController = require('../controllers/xController');

// ============================================================================
// OAUTH & CONNECTION LIFECYCLE
// ============================================================================

// @route   GET /api/x/connect
// @desc    Initiate X (Twitter) OAuth 2.0 PKCE authorization flow
// @access  Private
router.get('/connect', protect, xController.connect);

// @route   GET /api/x/callback
// @desc    Handle X OAuth 2.0 PKCE callback and token exchange
// @access  Public
router.get('/callback', xController.callback);

// @route   GET /api/x/status
// @desc    Get X connection status and profile details for authenticated user
// @access  Private
router.get('/status', protect, xController.getStatus);

// @route   DELETE /api/x/disconnect
// @desc    Soft-disconnect X integration, revoke credentials, and invalidate cache
// @access  Private
router.delete('/disconnect', protect, xController.disconnect);

// ============================================================================
// ANALYTICS & CACHE
// ============================================================================

// @route   GET /api/x/analytics/overview
// @desc    Get own-account analytics overview (lazy daily refresh, Redis cached)
// @access  Private
router.get('/analytics/overview', protect, xController.getAnalyticsOverview);

// @route   GET /api/x/analytics/posts
// @desc    Get recent posts with public and organic engagement metrics
// @access  Private
router.get('/analytics/posts', protect, xController.getRecentPosts);

// @route   GET /api/x/cache/status
// @desc    Get current cache engine status and diagnostic metrics
// @access  Private
router.get('/cache/status', protect, xController.getCacheStatus);

module.exports = router;

