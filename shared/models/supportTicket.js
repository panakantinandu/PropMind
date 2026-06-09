const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    subject: { type: String, required: true },
    category: { type: String, default: 'general' },
    message: { type: String, required: true },
    status: { type: String, enum: ['open','waiting_admin','waiting_tenant','closed'], default: 'open' },
    priority: { type: String, enum: ['low','medium','high','urgent'], default: 'medium' },
    replies: [{ authorType: String, authorId: mongoose.Schema.Types.ObjectId, message: String, createdAt: { type: Date, default: Date.now } }],
    isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema, 'supportTickets');
