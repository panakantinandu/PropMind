// shared/models/index.js
// Central export point for all Mongoose models used by both Tenant and Admin apps

module.exports = {
    Admin: require('./admin'),
    Tenant: require('./tenant'),
    Property: require('./property'),
    Application: require('./application'),
    Invoice: require('./invoice'),
    Payment: require('./payment'),
    Ticket: require('./ticket'),
    Area: require('./area'),
    Loan: require('./loan'),
    Lease: require('./lease'),
    Testimonial: require('./testimonial'),
    AuditLog: require('./auditLog'),
    LedgerEntry: require('./ledgerEntry'),
    Notification: require('./notification'),
    SupportTicket: require('./supportTicket'),
    StripeAccount: require('./stripeAccount'),
    AIInsight: require('./aiInsight'),
};
