const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  description: { type: String },
  brandColors: { type: [String], validate: [arr => arr.length === 3, 'Exactly 3 brand colors required'] },
  planTier: { type: String, enum: ['tier1', 'tier2', 'enterprise_pending'], required: true },
  status: { type: String, enum: ['trial', 'active'], default: 'trial' },
  createdVia: { type: String, enum: ['invite_code', 'self_serve'], required: true },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
