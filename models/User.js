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
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
