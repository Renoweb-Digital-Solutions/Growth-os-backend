const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Standard Authentication endpoints
router.post('/register', authController.register);
router.post('/login', authController.login);

// Password Reset endpoints
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-otp', authController.verifyOtp);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
