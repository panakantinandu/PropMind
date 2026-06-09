const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    tenantid: { type: String, required: true, unique: true },
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    tenantpassword: { type: String, required: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
    leaseStartDate: { type: Date },
    leaseEndDate: { type: Date },
    rentAmount: { type: Number },
    depositAmount: { type: Number },
    status: { type: String, default: 'active', enum: ['active', 'inactive', 'suspended', 'overdue', 'terminated'] },
    isDeleted: { type: Boolean, default: false },
    resetOTP: { type: String },
    resetOTPExpiry: { type: Date },
    passwordChangeOTP: { type: String },
    passwordChangeOTPExpiry: { type: Date },
    isVerified: { type: Boolean, default: false },
    signupOTP: { type: String },
    signupOTPExpiry: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema, 'tenants');
