const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');

// Reason: Handles the incremental saving of onboarding state
// How: Updates the logged-in user's profile with the fields sent from the frontend and increments the onboardingStep.
const updateOnboardingStep = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // Define allowed fields for onboarding updates to prevent arbitrary data injection
  const allowedFields = [
    'onboardingStep',
    'onboardingComplete',
    'businessType',
    'companyName',
    'industry',
    'companySize',
    'b2bClients',
    'companyWebsite',
    'position',
    'phoneNumber',
    'brandColor',
    'pricingTier'
  ];

  // Update only allowed fields that are present in the request body
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      user[field] = req.body[field];
    }
  });

  const updatedUser = await user.save();

  res.json({
    message: 'Onboarding step updated successfully',
    user: {
      id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      onboardingStep: updatedUser.onboardingStep,
      onboardingComplete: updatedUser.onboardingComplete,
      businessType: updatedUser.businessType,
      companyName: updatedUser.companyName,
      industry: updatedUser.industry,
      companySize: updatedUser.companySize,
      b2bClients: updatedUser.b2bClients,
      companyWebsite: updatedUser.companyWebsite,
      position: updatedUser.position,
      phoneNumber: updatedUser.phoneNumber,
      brandColor: updatedUser.brandColor,
      pricingTier: updatedUser.pricingTier
    }
  });
});

// Reason: Get current user to prepopulate onboarding
// How: Returns the authenticated user's profile
const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');
  
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  res.json({ user });
});

module.exports = {
  updateOnboardingStep,
  getCurrentUser
};
