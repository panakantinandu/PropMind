const mongoose = require('mongoose');

const leaseSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    monthlyRent: { type: Number, required: true, min: 0 },
    securityDeposit: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'expired', 'terminated'], default: 'active', index: true },
}, { timestamps: true });

// Compound indexes to support common queries
leaseSchema.index({ propertyId: 1, status: 1 });
leaseSchema.index({ tenantId: 1, status: 1 });
leaseSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('Lease', leaseSchema, 'leases');
