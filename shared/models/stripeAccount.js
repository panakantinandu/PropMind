const mongoose = require('mongoose');

const stripeAccountSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, unique: true, index: true },
    stripeAccountId: { type: String, required: true, unique: true, sparse: true },
    onboardingComplete: { type: Boolean, default: false },
    chargesEnabled: { type: Boolean, default: false },
    payoutsEnabled: { type: Boolean, default: false },
    connectedAt: { type: Date },
}, { timestamps: true });

// Indexes
stripeAccountSchema.index({ stripeAccountId: 1 }, { unique: true, sparse: true });
stripeAccountSchema.index({ adminId: 1 }, { unique: true });

module.exports = mongoose.model('StripeAccount', stripeAccountSchema, 'stripeaccounts');
