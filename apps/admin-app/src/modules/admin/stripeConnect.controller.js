'use strict';
/**
 * stripeConnect.controller.js
 * Handles Stripe Connect Express account onboarding for LeaseHub admins.
 *
 * Flow:
 *   1. Admin clicks "Connect Payment Account"  → GET /admin/stripe/connect
 *   2. Controller creates (or reuses) a Stripe Express account and generates
 *      an AccountLink.  Admin is redirected to Stripe's hosted onboarding.
 *   3. On success  → Stripe redirects to GET /admin/stripe/return
 *   4. On expiry   → Stripe redirects to GET /admin/stripe/refresh  (re-generate link)
 */

const Admin  = require('../../../../../shared/models/admin.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Returns the base URL of the admin app (used for Stripe redirect URLs).
 */
function getAdminBaseUrl(req) {
    return process.env.BASE_URL || "http://localhost:4000";
}

/**
 * Retrieve the latest account details from Stripe and sync status to DB.
 */
async function syncStripeStatus(admin) {
    if (!admin.stripeAccountId) return;
    try {
        const account = await stripe.accounts.retrieve(admin.stripeAccountId);
        const newStatus = account.charges_enabled ? 'active'
            : account.details_submitted   ? 'restricted'
            : 'pending';
        if (admin.stripeAccountStatus !== newStatus) {
            admin.stripeAccountStatus = newStatus;
            await admin.save();
        }
    } catch (err) {
        console.error('[StripeConnect] Failed to sync account status:', err.message);
    }
}

// -----------------------------------------------------------------------
// Controllers
// -----------------------------------------------------------------------

/**
 * GET /admin/stripe/connect
 * Create (or reuse) a Stripe Express account and redirect to onboarding.
 */
exports.connectAccount = async (req, res) => {
    try {
        const admin = await Admin.findById(req.session.adminId);
        if (!admin) return res.redirect('/admin/login/form');

        const baseUrl = getAdminBaseUrl(req);

        // Reuse existing account if already created
        let accountId = admin.stripeAccountId;

        if (!accountId) {
            const account = await stripe.accounts.create({
                type:    'express',
                email:   admin.email,
                capabilities: {
                    card_payments: { requested: true },
                    transfers:     { requested: true }
                },
                business_type: 'individual',
                metadata: { adminId: admin._id.toString() }
            });
            accountId = account.id;
            admin.stripeAccountId    = accountId;
            admin.stripeAccountStatus = 'pending';
            await admin.save();
            console.log(`[StripeConnect] Created Stripe Express account ${accountId} for admin ${admin._id}`);
        } else {
            // Sync current status before re-generating link
            await syncStripeStatus(admin);
        }

        // Generate a fresh onboarding link (links expire after ~5 minutes)
        const accountLink = await stripe.accountLinks.create({
            account:     accountId,
            refresh_url: `${baseUrl}/admin/stripe/refresh`,
            return_url:  `${baseUrl}/admin/stripe/return`,
            type:        'account_onboarding'
        });

        return res.redirect(accountLink.url);
    } catch (err) {
        console.error('Stripe Connect Error:', err);
        req.session.settingsError = err.message || 'Failed to start Stripe onboarding. Please try again.';
        return res.redirect('/admin/settings');
    }
};

/**
 * GET /admin/stripe/return
 * Stripe redirects here after the admin completes (or skips) onboarding.
 * We sync the account status and show the admin a confirmation.
 */
exports.connectReturn = async (req, res) => {
    try {
        const admin = await Admin.findById(req.session.adminId);
        if (!admin) return res.redirect('/admin/login/form');

        await syncStripeStatus(admin);

        req.session.settingsSuccess = admin.stripeAccountStatus === 'active'
            ? '✅ Payment account connected successfully! Tenants can now pay you directly.'
            : '⚠️ Your Stripe account is pending review. You may need to complete additional verification steps.';

        return res.redirect('/admin/settings');
    } catch (err) {
        console.error('[StripeConnect] connectReturn error:', err);
        return res.redirect('/admin/settings');
    }
};

/**
 * GET /admin/stripe/refresh
 * Stripe redirects here if the onboarding link expired.
 * We generate a fresh link and redirect the admin back.
 */
exports.connectRefresh = async (req, res) => {
    try {
        const admin = await Admin.findById(req.session.adminId);
        if (!admin || !admin.stripeAccountId) {
            return res.redirect('/admin/stripe/connect');
        }

        const baseUrl = getAdminBaseUrl(req);

        const accountLink = await stripe.accountLinks.create({
            account:     admin.stripeAccountId,
            refresh_url: `${baseUrl}/admin/stripe/refresh`,
            return_url:  `${baseUrl}/admin/stripe/return`,
            type:        'account_onboarding'
        });

        return res.redirect(accountLink.url);
    } catch (err) {
        console.error('[StripeConnect] connectRefresh error:', err);
        req.session.settingsError = 'Failed to refresh Stripe onboarding link.';
        return res.redirect('/admin/settings');
    }
};

/**
 * GET /admin/stripe/status  (JSON)
 * Returns the current Stripe Connect status for the logged-in admin.
 * Used by the dashboard to show the "Connect" button state without a page reload.
 */
exports.connectStatus = async (req, res) => {
    try {
        const admin = await Admin.findById(req.session.adminId).lean();
        if (!admin) return res.status(401).json({ error: 'Not authenticated' });

        return res.json({
            connected:    !!admin.stripeAccountId,
            status:       admin.stripeAccountStatus || 'not_connected',
            accountId:    admin.stripeAccountId || null
        });
    } catch (err) {
        console.error('[StripeConnect] connectStatus error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * GET /admin/settings  (simple settings page)
 * Shows Stripe connection status and a connect button.
 */
exports.settingsPage = async (req, res) => {
    try {
        const admin = await Admin.findById(req.session.adminId).lean();
        if (!admin) return res.redirect('/admin/login/form');

        const success = req.session.settingsSuccess;
        const error   = req.session.settingsError;
        delete req.session.settingsSuccess;
        delete req.session.settingsError;

        return res.render('admin-settings', {
            layout:    false,
            adminName: req.session.adminName,
            admin,
            stripeConnected:  !!admin.stripeAccountId,
            stripeStatus:     admin.stripeAccountStatus || 'not_connected',
            success,
            error
        });
    } catch (err) {
        console.error('[Admin] settingsPage error:', err);
        return res.status(500).send('Error loading settings');
    }
};
