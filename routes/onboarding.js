const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboardingController');

// Lookup invite code
router.get('/invites/:token', onboardingController.getInvite);

// Create tenant (Self-serve or Invite-based)
router.post('/tenants', onboardingController.createTenant);

// Submit sales lead
router.post('/leads', onboardingController.submitLead);

module.exports = router;
