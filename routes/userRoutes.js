const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.get('/me', protect, userController.getCurrentUser);
router.put('/onboarding', protect, userController.updateOnboardingStep);

module.exports = router;
