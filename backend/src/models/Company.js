const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  ukCompanyNumber: { type: String, default: '' },
  contactEmail: { type: String, default: '' },
  transferPhone: { type: String, default: '+442080009999' },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Company', companySchema);
