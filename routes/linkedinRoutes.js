// Reason: Centralized router module for LinkedIn integrations (Phase 1).
// How: Exposes RESTful endpoints for OAuth connection, authorization callbacks, connection statuses,
// soft disconnection, asset discovery, and user-scoped asset selection for both 'ads' and 'community' apps.

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const linkedinController = require('../controllers/linkedinController');

// ============================================================================
// GLOBAL & CONFIGURATION ENDPOINTS
// ============================================================================

// @route   GET /api/linkedin/config
// @desc    Get safe public configuration status of both LinkedIn apps (no secrets)
router.get('/config', protect, linkedinController.getConfig);

// @route   GET /api/linkedin/status
// @desc    Get connection status of both LinkedIn apps for authenticated user
router.get('/status', protect, linkedinController.getAllStatus);

// @route   GET /api/linkedin/callback
// @desc    Universal callback endpoint for LinkedIn OAuth code exchange (resolves app via state)
router.get('/callback', linkedinController.callback);

// ============================================================================
// PER-APP OAUTH & CONNECTION ENDPOINTS (:app = 'ads' | 'community')
// ============================================================================

// @route   GET /api/linkedin/:app/connect
// @desc    Initiate LinkedIn OAuth flow for specific app ('ads' or 'community')
router.get('/:app/connect', protect, linkedinController.connect);

// @route   GET /api/linkedin/:app/callback
// @desc    Handle LinkedIn OAuth callback for specific app
router.get('/:app/callback', linkedinController.callback);

// @route   GET /api/linkedin/:app/status
// @desc    Get detailed connection status for specific app
router.get('/:app/status', protect, linkedinController.getStatus);

// @route   DELETE /api/linkedin/:app/disconnect
// @desc    Disconnect specific LinkedIn app for authenticated user (soft disconnect)
router.delete('/:app/disconnect', protect, linkedinController.disconnect);

// ============================================================================
// PER-APP ASSET DISCOVERY & SELECTION ENDPOINTS
// ============================================================================

// @route   GET /api/linkedin/:app/assets
// @desc    List authorized assets (Ad Accounts or Company Pages) for specific app
router.get('/:app/assets', protect, linkedinController.getAssets);

// @route   POST /api/linkedin/:app/selected-asset
// @desc    Select active asset for specific app for authenticated user
router.post('/:app/selected-asset', protect, linkedinController.selectAsset);

// @route   GET /api/linkedin/:app/selected-asset
// @desc    Get currently selected asset for specific app for authenticated user
router.get('/:app/selected-asset', protect, linkedinController.getSelectedAsset);

module.exports = router;
