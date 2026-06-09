const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    type: { type: String, enum: ['debit', 'credit'], required: true },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    referenceType: { type: String, enum: ['invoice', 'payment', 'adjustment', 'refund'] },
    referenceId: { type: mongoose.Schema.Types.ObjectId },
    balance: { type: Number },
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema, 'ledgerentries');
