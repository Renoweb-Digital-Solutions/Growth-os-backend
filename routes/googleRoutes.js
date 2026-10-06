const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const googleController = require('../controllers/googleController');
const googleInsightController = require('../controllers/googleInsightController');

// ============================================================================
// PHASE 1 — GOOGLE OAUTH CONNECTION & AUTHORIZATION ENDPOINTS
// ============================================================================

// @route   GET /api/google/connect
// @desc    Initiate Google OAuth 2.0 authorization flow
router.get('/connect', protect, googleController.connect);

// @route   GET /api/google/callback
// @desc    Handle Google OAuth authorization callback
router.get('/callback', googleController.callback);

// @route   GET /api/google/status
// @desc    Get Google Search Console connection status for authenticated user
router.get('/status', protect, googleController.getStatus);

// @route   DELETE /api/google/disconnect
// @desc    Disconnect Google Search Console integration for authenticated user
router.delete('/disconnect', protect, googleController.disconnect);

// ============================================================================
// PHASE 2 — SEARCH CONSOLE PROPERTIES & ANALYTICS ENDPOINTS
// ============================================================================

// @route   GET /api/google/properties
// @desc    List accessible Google Search Console properties/sites
router.get('/properties', protect, googleInsightController.getProperties);

// @route   GET /api/google/insights/overview
// @desc    Executive overview of Search Console metrics (Clicks, Impressions, CTR, Position, Trends, Comparison)
router.get('/insights/overview', protect, googleInsightController.getOverview);

// @route   GET /api/google/insights/performance/compare
// @desc    Performance comparison breakdown (current period vs previous_period, year_over_year, or custom range)
router.get('/insights/performance/compare', protect, googleInsightController.getPerformanceCompare);

// @route   GET /api/google/insights/performance
// @desc    Flexible dimension performance breakdown (queries, pages, countries, devices)
router.get('/insights/performance', protect, googleInsightController.getPerformance);

// @route   GET /api/google/insights/queries
// @desc    Search Analytics Query (Keyword) breakdown
router.get('/insights/queries', protect, googleInsightController.getQueries);

// @route   GET /api/google/insights/pages
// @desc    Search Analytics Landing Page breakdown
router.get('/insights/pages', protect, googleInsightController.getPages);

// @route   GET /api/google/insights/countries
// @desc    Search Analytics Country breakdown
router.get('/insights/countries', protect, googleInsightController.getCountries);

// @route   GET /api/google/insights/devices
// @desc    Search Analytics Device category breakdown (DESKTOP, MOBILE, TABLET)
router.get('/insights/devices', protect, googleInsightController.getDevices);

module.exports = router;
