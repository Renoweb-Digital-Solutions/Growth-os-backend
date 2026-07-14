const mongoose = require('mongoose');

const pendingTenantSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  companyName: { type: String, required: true },
  description: { type: String },
  brandColors: { type: [String], validate: [arr => arr.length === 3, 'Exactly 3 brand colors required'] },
  planTier: { type: String, required: true },
  contactEmail: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  redeemed: { type: Boolean, default: false },
  createdBySales: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('PendingTenant', pendingTenantSchema);
