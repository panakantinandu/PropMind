// Tenant-specific routes for tenant app
const express = require('express');
const router = express.Router();
const controller = require('./tenant.controller');

const { requireTenant } = require('../../../../../shared/middleware/auth.js');
const Tenant = require('../../../../../shared/models/tenant');
const Lease = require('../../../../../shared/models/lease');
const rateLimit = require('express-rate-limit');

const strictLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5, // Limit each IP to 5 requests per window
    message: 'Too many attempts, please try again after 10 minutes.'
});

const ensureMaintenanceAccess = async (req, res, next) => {
    try {
        if (!req.session.tenantId) {
            return res.redirect('/tenant/login/form');
        }

        const tenant = await Tenant.findById(req.session.tenantId).populate('propertyId').lean();
        const activeLease = await Lease.findOne({ tenantId: req.session.tenantId, status: 'active', isDeleted: false }).lean();
        const hasAccess = !!(activeLease || (tenant?.propertyId && ['occupied', 'leased'].includes(String(tenant.propertyId.status || '').toLowerCase())));

        if (!hasAccess) {
            req.session.maintenanceError = 'Maintenance requests become available after lease activation.';
            return res.redirect('/tenant/dashboard');
        }

        return next();
    } catch (err) {
        console.error('Maintenance access check failed:', err);
        return res.redirect('/tenant/dashboard');
    }
};

// Login routes
router.get('/login/form', (req, res) => {
    res.render('login', {
        layout: false,
        error: req.session.loginError,
        success: req.session.registerSuccess,
        cspNonce: res.locals.cspNonce
    });
    req.session.loginError = null;
    req.session.registerSuccess = null;
});

router.post('/login', controller.login);
router.get('/logout', controller.logout);

// Registration routes
router.get('/register/form', controller.registerForm);
router.post('/register', controller.register);
router.get('/register/verify', controller.verifySignupOtpForm);
router.post('/register/verify', strictLimiter, controller.verifySignupOtp);
router.post('/register/resend-otp', strictLimiter, controller.resendSignupOtp);

// Change Password
router.get('/change-password', requireTenant(), controller.changePasswordForm);
router.post('/change-password', requireTenant(), controller.changePassword);

// AJAX validation routes
router.post('/check-email', controller.checkEmail);
router.post('/check-tenantid', controller.checkTenantId);

// Forgot & Reset Password routes
router.get('/forgot-password', controller.forgotPasswordForm);
router.post('/forgot-password', strictLimiter, controller.sendResetOTP);
router.get('/reset-password', controller.resetPasswordForm);
router.post('/reset-password', strictLimiter, controller.resetPassword);

// Dashboard and tenant features (protected)
router.get('/dashboard', requireTenant(), controller.dashboard);
router.get('/profile', requireTenant(), controller.profile);
router.post('/profile/update', requireTenant(), controller.updateProfile);
router.post('/profile/send-password-otp', requireTenant(), controller.sendPasswordChangeOTP);
router.get('/payments', requireTenant(), controller.payments);
router.get('/invoices', requireTenant(), controller.invoices);
router.post('/invoices/:invoiceId/pay', requireTenant(), strictLimiter, controller.initiatePayment);
router.post('/pay-now', requireTenant(), strictLimiter, controller.payNow);
router.post('/pay-deposit', requireTenant(), strictLimiter, controller.payDeposit);
router.get('/payments/success', controller.paymentSuccess);
router.get('/payments/cancel', controller.paymentCancel);
router.get('/notifications', requireTenant(), controller.notifications);
router.get('/notifications/count', requireTenant(), controller.notificationsCount);
router.get('/notifications/recent', requireTenant(), controller.notificationsRecent);
router.post('/notifications/:id/read', requireTenant(), controller.markNotificationRead);
router.post('/notifications/read-all', requireTenant(), controller.markAllNotificationsRead);
router.get('/support', requireTenant(), controller.support);
router.post('/support/ask', requireTenant(), controller.aiSupportAsk);
// Support ticket endpoints
router.get('/support/tickets', requireTenant(), controller.listSupportTickets);
router.post('/support/tickets', requireTenant(), controller.createSupportTicket);
router.get('/support/tickets/:id', requireTenant(), controller.viewSupportTicket);
router.post('/support/tickets/:id/reply', requireTenant(), controller.replySupportTicket);
router.get('/maintenance', requireTenant(), controller.maintenance);
router.post('/maintenance/preview', requireTenant(), controller.previewMaintenanceAI);
router.post('/maintenance/request', requireTenant(), ensureMaintenanceAccess, controller.submitMaintenanceRequest);

// Property and Application routes
router.get('/properties', requireTenant(), controller.properties);
router.get('/properties/apply/:propertyId', requireTenant(), controller.applyPropertyForm);
router.post('/properties/apply/:propertyId', requireTenant(), controller.applyProperty);
router.get('/applications', requireTenant(), controller.applications);
router.get('/get-approved-application', requireTenant(), controller.getApprovedApplication);
router.post('/applications/:id/cancel', requireTenant(), controller.cancelApplication);

module.exports = router;
