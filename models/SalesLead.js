const mongoose = require('mongoose');

const salesLeadSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  contactEmail: { type: String, required: true },
  message: { type: String },
  status: { type: String, enum: ['new', 'contacted', 'closed'], default: 'new' }
}, { timestamps: true });

module.exports = mongoose.model('SalesLead', salesLeadSchema);
