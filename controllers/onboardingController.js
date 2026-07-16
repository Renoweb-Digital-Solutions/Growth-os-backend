const PendingTenant = require('../models/PendingTenant');
const Tenant = require('../models/Tenant');
const SalesLead = require('../models/SalesLead');
const asyncHandler = require('../utils/asyncHandler');

// Reason: Allows users with an invite token to retrieve the associated invite details during onboarding.
// How: Queries the PendingTenant collection for a token that hasn't been redeemed and hasn't expired yet.
const getInvite = asyncHandler(async (req, res) => {
  const invite = await PendingTenant.findOne({ 
    token: req.params.token,
    redeemed: false,
    expiresAt: { $gt: new Date() }
  });
  
  if (!invite) {
    res.status(404);
    throw new Error('Invalid or expired invite code');
  }
  
  res.json({ invite });
});

// Reason: Creates a new tenant account, supporting both self-serve flows and invite-based flows.
// How: Instantiates a Tenant model with the incoming data. If an invite token was provided, it also marks that PendingTenant as redeemed to prevent reuse.
const createTenant = asyncHandler(async (req, res) => {
  const { companyName, description, brandColors, planTier, createdVia, ownerUserId, inviteToken } = req.body;
  
  const tenant = new Tenant({
    companyName,
    description,
    brandColors,
    planTier,
    createdVia,
    ownerUserId,
    status: 'trial'
  });
  
  await tenant.save();
  
  if (inviteToken) {
    await PendingTenant.findOneAndUpdate(
      { token: inviteToken },
      { redeemed: true }
    );
  }
  
  res.status(201).json({ message: 'Tenant created successfully', tenant });
});

// Reason: Captures basic contact information for potential clients who want to get in touch.
// How: Creates a new SalesLead document with the provided data and defaults the status to 'new'.
const submitLead = asyncHandler(async (req, res) => {
  const { companyName, contactEmail, message } = req.body;
  
  const lead = new SalesLead({
    companyName,
    contactEmail,
    message,
    status: 'new'
  });
  
  await lead.save();
  
  res.status(201).json({ message: 'Sales lead submitted successfully', lead });
});

module.exports = {
  getInvite,
  createTenant,
  submitLead
};
