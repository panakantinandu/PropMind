const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'admin', enum: ['admin', 'superadmin'] },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    signupOTP: { type: String },
    signupOTPExpiry: { type: Date },
    resetOTP: { type: String },
    resetOTPExpiry: { type: Date },
    // Stripe Connect
    stripeAccountId: { type: String, default: null },
    stripeAccountStatus: { type: String, enum: ['pending', 'active', 'restricted', null], default: null },
}, { timestamps: true });

// Hash password before saving
adminSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

module.exports = mongoose.model('Admin', adminSchema, 'admins');
