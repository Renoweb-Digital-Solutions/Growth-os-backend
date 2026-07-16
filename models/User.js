const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String }, // Optional if using OAuth
  authProvider: { type: String, enum: ['local', 'google', 'linkedin'], default: 'local' },
  role: { type: String, enum: ['client', 'agency_owner', 'sales_admin'], required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  resetPasswordOtp: { type: String },
  resetPasswordExpires: { type: Date },
  
  // Onboarding Fields
  onboardingStep: { type: Number, default: 0 },
  onboardingComplete: { type: Boolean, default: false },
  businessType: { type: String, enum: ['b2b', 'b2c'] },
  companyName: { type: String },
  industry: { type: String },
  companySize: { type: String },
  b2bClients: { type: String }, // Can be number or range like "1-10"
  companyWebsite: { type: String },
  position: { type: String },
  phoneNumber: { type: String },
  brandColor: { type: String },
  pricingTier: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
