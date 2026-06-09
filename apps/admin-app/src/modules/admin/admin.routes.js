// Admin-specific routes for admin app
const express = require('express');
const router = express.Router();
const controller = require('./admin.controller');
const reportsController = require('./adminReports.controller');
const stripeConnectController = require('./stripeConnect.controller');

const { requireAdmin } = require('../../../../../shared/middleware/auth.js');
const rateLimit = require('express-rate-limit');

const strictLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5, // Limit each IP to 5 requests per window
    message: 'Too many attempts, please try again after 10 minutes.'
});

// Login routes
router.get('/login', (req, res) => res.redirect('/admin/login/form'));
router.get('/login/form', (req, res) => {
    res.render('admin-login', { 
        layout: false,
        error: req.session.loginError 
    });
    req.session.loginError = null;
});

router.post('/login', controller.login);
router.get('/logout', controller.logout);

// Signup routes
router.get('/signup/form', controller.signupForm);
router.post('/signup', strictLimiter, controller.signup);
router.get('/signup/verify', controller.verifySignupOtpForm);
router.post('/signup/verify', strictLimiter, controller.verifySignupOtp);
router.post('/signup/resend-otp', strictLimiter, controller.resendSignupOtp);

// Forgot / Reset Password
router.get('/forgot-password', controller.forgotPasswordForm);
router.post('/forgot-password', strictLimiter, controller.sendForgotPasswordOtp);
router.get('/reset-password', controller.resetPasswordForm);
router.post('/reset-password', strictLimiter, controller.resetPassword);

// Change Password
router.get('/change-password', requireAdmin(), controller.changePasswordForm);
router.post('/change-password', requireAdmin(), controller.changePassword);

// Dashboard and admin features (protected)
router.get('/dashboard', requireAdmin(), controller.dashboard);
router.get('/home', requireAdmin(), (req, res) => res.redirect('/admin/dashboard'));
router.get('/home/addproperty', requireAdmin(), (req, res) => res.redirect('/admin/properties/add'));
router.get('/addproperty', requireAdmin(), (req, res) => res.redirect('/admin/properties/add'));
router.get('/tenants', requireAdmin(), controller.tenants);
router.get('/tenants/add', requireAdmin(), controller.addTenantForm);
router.post('/tenants/add', requireAdmin(), controller.addTenant);
router.get('/tenants/:id', requireAdmin(), controller.viewTenant);
router.get('/tenants/:id/edit', requireAdmin(), controller.editTenantForm);
router.post('/tenants/:id', requireAdmin(), controller.updateTenant);
router.get('/properties', requireAdmin(), controller.properties);
router.get('/properties/add', requireAdmin(), controller.addPropertyForm);
router.post('/properties/add', requireAdmin(), (req, res, next) => {
    const upload = req.app.locals.upload;
    upload.array('propertyImages', 10)(req, res, (err) => {
        if (err) {
            req.session.error = err.message || 'Error uploading images';
            return res.redirect('/admin/properties/add');
        }
        next();
    });
}, controller.addProperty);
router.get('/properties/:id', requireAdmin(), controller.viewProperty);
router.get('/properties/:id/edit', requireAdmin(), controller.editPropertyForm);
router.post('/properties/:id', requireAdmin(), (req, res, next) => {
    const upload = req.app.locals.upload;
    upload.array('propertyImages', 10)(req, res, (err) => {
        if (err) {
            req.session.error = err.message || 'Error uploading images';
            return res.redirect('/admin/properties/' + req.params.id + '/edit');
        }
        next();
    });
}, controller.updateProperty);
router.get('/payments', requireAdmin(), controller.payments);
router.get('/rent/overdue', requireAdmin(), controller.overdueRent);
router.get('/invoices/create', requireAdmin(), controller.createInvoiceForm);
router.post('/invoices/create', requireAdmin(), controller.createInvoice);
router.get('/applications', requireAdmin(), controller.applications);
router.post('/applications/:id/decision', requireAdmin(), controller.applicationDecision);
router.post('/applications/:id/cancel', requireAdmin(), controller.applicationCancel);
router.post('/applications/:id/rerun-ai', requireAdmin(), controller.rerunAiAnalysis);
router.get('/reports', requireAdmin(), reportsController.getReports);
router.post('/send-reminder/:tenantId', requireAdmin(), controller.sendReminder);
router.get('/maintenance', requireAdmin(), controller.maintenance);
router.post('/maintenance/:ticketId/status', requireAdmin(), controller.updateMaintenanceStatus);
router.get('/notifications', requireAdmin(), controller.notifications);
router.get('/notifications/count', requireAdmin(), controller.notificationsCount);
router.post('/notifications/:id/read', requireAdmin(), controller.markNotificationRead);
router.post('/notifications/read-all', requireAdmin(), controller.markAllNotificationsRead);
router.post('/notifications/:id/delete', requireAdmin(), controller.deleteNotification);
router.get('/support', requireAdmin(), controller.supportCenter);
router.post('/support/ask', requireAdmin(), controller.aiSupportAsk);
router.get('/support/tickets', requireAdmin(), controller.listSupportTickets);
router.get('/support/tickets/:id', requireAdmin(), controller.viewSupportTicket);
router.post('/support/tickets/:id/reply', requireAdmin(), controller.replySupportTicketAdmin);
// Support insights for quick cards (AJAX)
router.get('/support/insight/:action', requireAdmin(), controller.supportInsight);
// Support data API for operations categories (AJAX)
router.get('/support/data/:category', requireAdmin(), controller.supportData);
router.get('/notifications/recent', requireAdmin(), controller.notificationsRecent);
// AI summarization endpoint (returns concise summary based on DB facts)
router.get('/ai-summary', requireAdmin(), controller.aiSummary);

// Settings & Stripe Connect
router.get('/settings', requireAdmin(), stripeConnectController.settingsPage);
router.get('/stripe/connect', requireAdmin(), stripeConnectController.connectAccount);
router.get('/stripe/return', requireAdmin(), stripeConnectController.connectReturn);
router.get('/stripe/refresh', requireAdmin(), stripeConnectController.connectRefresh);
router.get('/stripe/status', requireAdmin(), stripeConnectController.connectStatus);

module.exports = router;
