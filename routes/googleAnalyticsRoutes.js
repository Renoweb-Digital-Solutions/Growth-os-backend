const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const googleAnalyticsController = require('../controllers/googleAnalyticsController');

// ============================================================================
// GOOGLE ANALYTICS 4 (GA4) PROPERTY DISCOVERY & SELECTION ROUTES
// ============================================================================

// @route   GET /api/google/analytics/properties
// @desc    List and discover accessible Google Analytics 4 properties
// @access  Private (Protected by Gromentum JWT)
router.get('/properties', protect, googleAnalyticsController.getProperties);

// @route   POST /api/google/analytics/property
// @desc    Select active GA4 property for authenticated user
// @access  Private (Protected by Gromentum JWT)
router.post('/property', protect, googleAnalyticsController.selectProperty);

// @route   GET /api/google/analytics/status
// @desc    Get Google Analytics 4 integration and scope status for authenticated user
// @access  Private (Protected by Gromentum JWT)
router.get('/status', protect, googleAnalyticsController.getStatus);

// ============================================================================
// GOOGLE ANALYTICS 4 (GA4) INSIGHTS & REPORTING ROUTES (PHASE 2)
// ============================================================================

// @route   GET /api/google/analytics/insights/overview
// @desc    Executive overview of GA4 metrics (Active Users, Sessions, Engagement, Revenue, Trends, Comparison)
// @access  Private (Protected by Gromentum JWT)
router.get('/insights/overview', protect, googleAnalyticsController.getOverview);

// ============================================================================
// GOOGLE ANALYTICS 4 (GA4) ACQUISITION REPORTING ROUTES (PHASE 3)
// ============================================================================

// @route   GET /api/google/analytics/insights/acquisition
// @desc    Session-level Traffic Acquisition report (Channels, Sources, Mediums, Campaigns)
// @access  Private (Protected by Gromentum JWT)
router.get('/insights/acquisition', protect, googleAnalyticsController.getTrafficAcquisition);

// @route   GET /api/google/analytics/insights/user-acquisition
// @desc    First-user Acquisition report (First-User Channels, Sources, Mediums, Campaigns)
// @route   GET /api/google/analytics/insights/suggested-cards
// @route   GET /api/google/analytics/insights/suggested-cards/:cardKey
// @desc    GA4 Suggested-for-You Card Data APIs supporting per-card independent date ranges
// @access  Private (Protected by Gromentum JWT)
router.get('/insights/suggested-cards', protect, googleAnalyticsController.getSuggestedCards);
router.get('/insights/suggested-cards/:cardKey', protect, googleAnalyticsController.getSuggestedCards);

// @route   GET /api/google/analytics/insights/realtime
// @desc    GA4 Realtime Data API for "Active users in last 30 minutes" card
// @access  Private (Protected by Gromentum JWT)
router.get('/insights/realtime', protect, googleAnalyticsController.getRealtime);

module.exports = router;


