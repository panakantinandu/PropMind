const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    amountPaid: { type: Number, required: true },
    paymentDate: { type: Date, default: Date.now },
    paymentMethod: { type: String, enum: ['cash', 'check', 'bank_transfer', 'upi', 'card', 'stripe'], default: 'cash' },
    transactionId: { type: String },
    stripePaymentIntentId: { type: String },
    stripeTransferId: { type: String },      // Stripe Connect transfer reference
    status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected', 'paid', 'failed', 'refunded'] },
    notes: { type: String },
    
    // Refund Workflow Fields
    refundReason: { type: String, enum: ['application_cancellation', 'property_unavailable', 'duplicate_payment', 'administrative_error', 'other'] },
    refundAmount: { type: Number },
    refundDate: { type: Date },
    refundIssuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    refundNotes: { type: String },
    
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema, 'payments');
