const mongoose = require('mongoose');
const emitter = require('../realtime/emitter');

const notificationSchema = new mongoose.Schema({
  userType: { type: String, enum: ['admin', 'tenant'], required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String }, // e.g. invoice_due, application_approved
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  metadata: { type: Object },
}, { timestamps: true });

notificationSchema.post('save', async (doc) => {
  try {
    const io = emitter.get();
    if (!io) return;

    // Ensure metadata.url is populated for common types
    const buildUrl = (d) => {
      const meta = d.metadata || {};
      const root = process.env.APP_BASE_URL || '';
      try {
        if (d.type && meta) {
          // Ticket notifications
          if ((d.type === 'maintenance_status_updated' || d.type === 'support_ai_created' || d.type === 'ticket_admin_reply' || meta.ticketId)) {
            const tid = meta.ticketId || meta.ticket;
            if (tid) return `/tenant/maintenance#ticket-${tid}`;
            return '/tenant/maintenance';
          }
          // Invoice related
          if (d.type === 'invoice_due' || meta.invoiceId) {
            return '/tenant/invoices';
          }
          // Payment
          if (d.type === 'payment_received' || meta.paymentId) {
            return '/tenant/payments';
          }
          // Application
          if (d.type === 'application_approved' || meta.applicationId) {
            return '/tenant/applications';
          }
          // Admin links
          if (d.userType === 'admin') {
            if (meta.ticketId) return `/admin/maintenance#ticket-${meta.ticketId}`;
            if (meta.invoiceId) return `/admin/invoices`;
          }
        }
      } catch (e) {
        // ignore and fallback to undefined
      }
      return meta.url || undefined;
    };

    const payload = {
      id: doc._id,
      title: doc.title,
      message: doc.message,
      type: doc.type,
      isRead: doc.isRead,
      createdAt: doc.createdAt,
      metadata: Object.assign({}, doc.metadata || {}, { url: buildUrl(doc) })
    };

    if (doc.userType === 'admin') {
      if (doc.adminId) {
        io.to(`admin:${doc.adminId.toString()}`).emit('notification:new', { userType: 'admin', adminId: doc.adminId.toString(), notification: payload });
      } else {
        // Broadcast to all connected admins as a fallback when no specific adminId provided
        io.emit('notification:new', { userType: 'admin', notification: payload });
      }
    }
    if (doc.userType === 'tenant' && doc.tenantId) {
      io.to(`tenant:${doc.tenantId.toString()}`).emit('notification:new', { userType: 'tenant', tenantId: doc.tenantId.toString(), notification: payload });
    }
  } catch (err) {
    console.error('Notification realtime emit error:', err.message || err);
  }
});

module.exports = mongoose.model('Notification', notificationSchema, 'notifications');
