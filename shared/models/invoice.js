const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    // Type of invoice: regular rent vs booking deposit, late fee, etc.
    // 'monthly_rent' is for system-generated rent, 'booking_deposit' for reservation,
    // and 'late_fee' for standalone late fee entries linked to rent.
    type: { type: String, enum: ['rent', 'monthly_rent', 'booking_deposit', 'late_fee', 'other'], default: 'rent' },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    month: { type: String, required: true },
    rentAmount: { type: Number, required: true },
    maintenanceCharges: { type: Number, default: 0 },
    waterCharges: { type: Number, default: 0 },
    electricityCharges: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    status: { type: String, default: 'unpaid', enum: ['unpaid', 'partial', 'paid', 'overdue'] },
    paidAmount: { type: Number, default: 0 },
    // Running balance including late fees; if missing, treat as totalAmount - paidAmount
    balance: { type: Number, default: 0 },
    // Total late fees applied so far (for audit and to avoid double-charging)
    lateFeesAccrued: { type: Number, default: 0 },
    // Last rent reminder metadata to avoid duplicate emails
    lastReminderType: { type: String, enum: ['friendly', 'due_today', 'overdue_1', 'warning_7', 'alert_15', 'default_30'], default: undefined },
    lastReminderAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Invoice', invoiceSchema, 'invoices');
