const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const metaController = require('../controllers/metaController');
const metaDataController = require('../controllers/metaDataController');
const metaInsightController = require('../controllers/metaInsightController');

// ============================================================================
// PHASE 1 — META CONNECTION & AUTHORIZATION ENDPOINTS
// ============================================================================

// @route   GET /api/meta/connect
// @desc    Initiate Meta OAuth authorization flow
router.get('/connect', protect, metaController.connect);

// @route   GET /api/meta/callback
// @desc    Handle Meta OAuth authorization callback
router.get('/callback', metaController.callback);

// @route   GET /api/meta/status
// @desc    Get Meta connection status for authenticated user
router.get('/status', protect, metaController.getStatus);

// @route   DELETE /api/meta/disconnect
// @desc    Disconnect Meta integration for authenticated user
router.delete('/disconnect', protect, metaController.disconnect);

// ============================================================================
// PHASE 2 — META ASSET & DATA INTEGRATION ENDPOINTS
// ============================================================================

// @route   GET /api/meta/assets
// @desc    Discover all accessible Meta assets & capability flags
router.get('/assets', protect, metaDataController.getAssets);

// @route   GET /api/meta/pages
// @desc    List accessible Facebook Pages
router.get('/pages', protect, metaDataController.getPages);

// @route   GET /api/meta/pages/:pageId
// @desc    Get details for a specific Facebook Page
router.get('/pages/:pageId', protect, metaDataController.getPageById);

// @route   GET /api/meta/pages/:pageId/posts
// @desc    Get posts for a Facebook Page (paginated)
router.get('/pages/:pageId/posts', protect, metaDataController.getPagePosts);

// @route   GET /api/meta/pages/:pageId/insights
// @desc    Get performance insights for a Facebook Page
router.get('/pages/:pageId/insights', protect, metaDataController.getPageInsights);

// @route   GET /api/meta/instagram
// @desc    List connected Instagram Professional Accounts
router.get('/instagram', protect, metaDataController.getInstagramAccounts);

// @route   GET /api/meta/instagram/:instagramAccountId/media
// @desc    Get media posts for an Instagram Professional Account (paginated)
router.get('/instagram/:instagramAccountId/media', protect, metaDataController.getInstagramMedia);

// @route   GET /api/meta/instagram/:instagramAccountId/insights
// @desc    Get account insights for an Instagram Professional Account
router.get('/instagram/:instagramAccountId/insights', protect, metaDataController.getInstagramInsights);

// @route   GET /api/meta/ad-accounts
// @desc    List accessible Meta Ad Accounts
router.get('/ad-accounts', protect, metaDataController.getAdAccounts);

// @route   GET /api/meta/ad-accounts/:adAccountId/campaigns
// @desc    Get campaigns for an Ad Account (paginated)
router.get('/ad-accounts/:adAccountId/campaigns', protect, metaDataController.getCampaigns);

// @route   GET /api/meta/ad-accounts/:adAccountId/adsets
// @desc    Get Ad Sets for an Ad Account or Campaign (paginated)
router.get('/ad-accounts/:adAccountId/adsets', protect, metaDataController.getAdSets);

// @route   GET /api/meta/ad-accounts/:adAccountId/ads
// @desc    Get Ads for an Ad Account, Ad Set, or Campaign (paginated)
router.get('/ad-accounts/:adAccountId/ads', protect, metaDataController.getAds);

// @route   GET /api/meta/ad-accounts/:adAccountId/insights
// @desc    Get Ads Insights for an Ad Account (paginated)
router.get('/ad-accounts/:adAccountId/insights', protect, metaDataController.getAdsInsights);

// ============================================================================
// PHASE 3 — GROMENTUM INSIGHTS & DATA DELIVERY ENDPOINTS
// ============================================================================

// @route   GET /api/meta/insights/overview
// @desc    Executive overview across Social and Ads performance metrics
router.get('/insights/overview', protect, metaInsightController.getOverview);

// @route   GET /api/meta/insights/social
// @desc    Unified Social insights for Facebook Pages and Instagram Accounts
router.get('/insights/social', protect, metaInsightController.getSocialInsights);

// @route   GET /api/meta/insights/content
// @desc    Consolidated post & media content insights list
router.get('/insights/content', protect, metaInsightController.getContentInsights);

// @route   GET /api/meta/insights/ads
// @desc    Advertising Insights across Ad Accounts with derived metrics
router.get('/insights/ads', protect, metaInsightController.getAdsInsights);

// @route   GET /api/meta/insights/campaigns
// @desc    Campaign-level performance breakdown with currency subunit conversion
router.get('/insights/campaigns', protect, metaInsightController.getCampaignInsights);

// @route   GET /api/meta/insights/adsets
// @desc    AdSet-level performance breakdown with currency subunit conversion
router.get('/insights/adsets', protect, metaInsightController.getAdSetInsights);

// @route   GET /api/meta/insights/ads-level
// @desc    Ad-level performance breakdown with currency subunit conversion
router.get('/insights/ads-level', protect, metaInsightController.getAdInsights);

module.exports = router;
