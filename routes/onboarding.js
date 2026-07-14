const express = require('express');
const router = express.Router();
const PendingTenant = require('../models/PendingTenant');
const Tenant = require('../models/Tenant');
const SalesLead = require('../models/SalesLead');

// Lookup invite code
router.get('/invites/:token', async (req, res) => {
  try {
    const invite = await PendingTenant.findOne({ 
      token: req.params.token,
      redeemed: false,
      expiresAt: { $gt: new Date() }
    });
    
    if (!invite) {
      return res.status(404).json({ message: 'Invalid or expired invite code' });
    }
    
    res.json({ invite });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Create tenant (Self-serve or Invite-based)
router.post('/tenants', async (req, res) => {
  try {
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
    
    // If it was from an invite, mark it as redeemed
    if (inviteToken) {
      await PendingTenant.findOneAndUpdate(
        { token: inviteToken },
        { redeemed: true }
      );
    }
    
    res.status(201).json({ message: 'Tenant created successfully', tenant });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Submit sales lead
router.post('/leads', async (req, res) => {
  try {
    const { companyName, contactEmail, message } = req.body;
    
    const lead = new SalesLead({
      companyName,
      contactEmail,
      message,
      status: 'new'
    });
    
    await lead.save();
    
    res.status(201).json({ message: 'Sales lead submitted successfully', lead });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
