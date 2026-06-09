// Admin Controller for Admin App
const Admin = require('../../../../../shared/models').Admin;
const Tenant = require('../../../../../shared/models').Tenant;
const Property = require('../../../../../shared/models').Property;
const Payment = require('../../../../../shared/models').Payment;
const Invoice = require('../../../../../shared/models').Invoice;
const Application = require('../../../../../shared/models').Application;
const Ticket = require('../../../../../shared/models').Ticket;
const Notification = require('../../../../../shared/models').Notification;
const SupportTicket = require('../../../../../shared/models').SupportTicket;
const Lease = require('../../../../../shared/models').Lease;
const { createAuditLog } = require('../../../../../services/auditService');
const notify = require('../../../../../utils/notify');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('../../../../../utils/emailService');
const { validatePassword } = require('../../../../../utils/validation');
const aiService = require('../../../../../services/ai/ai.service');
const supportService = require('../../../../../services/supportService');
const emitter = require('../../../../../shared/realtime/emitter');
const utils = require('../../../../../shared/utils');
// Simple in-memory rate limiter for support APIs (per-admin, reset window)
const _supportRate = new Map(); // adminId -> { count, resetAt }
const SUPPORT_RATE_LIMIT = 60; // requests per window
const SUPPORT_RATE_WINDOW_MS = 60 * 1000; // 1 minute


// Signup Form
exports.signupForm = (req, res) => {
    res.render('admin-signup', {
        layout: false,
        error: req.session.signupError,
        success: req.session.signupSuccess
    });
    req.session.signupError = null;
    req.session.signupSuccess = null;
};

// Admin AI summarization endpoint
exports.aiSummary = async (req, res) => {
    try {
        const adminId = req.session.adminId;
        if (!adminId) return res.status(401).json({ success: false, message: 'Not authenticated' });

        // Gather concise facts (numbers and short lists)
        const highRiskApplicants = await Application.countDocuments({ adminId, aiRiskLevel: 'HIGH', isDeleted: false });
        const unpaidInvoices = await Invoice.countDocuments({ adminId, isDeleted: false, $or: [{ status: 'unpaid' }, { status: 'overdue' }, { status: 'partial' }] });
        const overdueTenantIds = await Invoice.distinct('tenantId', { adminId, status: 'overdue', isDeleted: false });
        const overdueTenants = overdueTenantIds ? overdueTenantIds.filter(Boolean).length : 0;
        const expiringLeases = await Lease.countDocuments({ adminId, isDeleted: false, leaseEndDate: { $lte: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) } });
        const maintenanceEmergencies = await Ticket.countDocuments({ adminId, $or: [{ priority: 'urgent' }, { aiPriority: 'urgent' }], isDeleted: false });

        const paymentsAgg = await Payment.aggregate([
            { $match: { adminId, status: 'approved', isDeleted: false } },
            { $group: { _id: null, totalReceived: { $sum: '$amountPaid' } } }
        ]);
        const invoicesAgg = await Invoice.aggregate([
            { $match: { adminId, isDeleted: false } },
            { $group: { _id: null, totalBilled: { $sum: '$totalAmount' } } }
        ]);
        const totalReceived = paymentsAgg[0] ? Number(paymentsAgg[0].totalReceived) : 0;
        const totalBilled = invoicesAgg[0] ? Number(invoicesAgg[0].totalBilled) : 0;
        const collectionRate = totalBilled > 0 ? Math.round((totalReceived / totalBilled) * 100) : 0;

        const facts = {
            highRiskApplicants,
            overdueTenants,
            unpaidInvoices,
            expiringLeases,
            maintenanceEmergencies,
            totalReceived,
            totalBilled,
            collectionRate
        };

        // Build a constrained prompt: only summarize the facts, do not hallucinate.
        const system = `You are a concise analytics assistant. Given only the numeric facts provided, produce: (1) a short 3-bullet summary of the most important signals; (2) two practical recommended actions an operations team can take. Do NOT invent any facts or make claims beyond the provided numbers. If a value is missing, say 'data unavailable'. Respond in JSON with keys: summary (array of strings), recommendations (array of strings).`;
        const user = `Facts: ${JSON.stringify(facts)}`;

        let aiRespText = '';
        try {
            const aiRes = await aiService.createChatCompletion([
                { role: 'system', content: system },
                { role: 'user', content: user }
            ], { maxTokens: 300 });
            aiRespText = aiRes && aiRes.choices && aiRes.choices[0] && aiRes.choices[0].message ? aiRes.choices[0].message.content : '';
        } catch (err) {
            console.error('AI summarization error:', err.message || err);
            return res.status(500).json({ success: false, message: 'AI summarization failed', error: err.message || String(err) });
        }

        // Try to parse JSON response, otherwise return raw text
        let parsed = null;
        try {
            parsed = JSON.parse(aiRespText);
        } catch (e) {
            // Not JSON — return raw string under 'text'
        }

        return res.json({ success: true, facts, ai: parsed || { text: aiRespText } });
    } catch (err) {
        console.error('aiSummary error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Admin AI support ask endpoint
exports.aiSupportAsk = async (req, res) => {
    try {
        const adminId = req.session.adminId;
        console.log('[SUPPORT] admin aiSupportAsk HIT', { adminId, originalUrl: req.originalUrl });
        if (!adminId) return res.status(401).json({ success: false, message: 'Not authenticated' });
        const { question } = req.body || {};
        if (!question || typeof question !== 'string' || question.trim().length < 3) return res.status(400).json({ success: false, message: 'Please provide a clear question' });

        const result = await supportService.aiAssistAdmin(adminId, question);
        console.log('[SUPPORT] admin aiSupportAsk result', { adminId, parsed: result && result.parsed ? true : false, rawSample: result && result.raw ? (typeof result.raw === 'string' ? result.raw.substring(0,200) : '') : '' });
        return res.json({ success: true, result, parsed: result?.parsed, raw: result?.raw });
    } catch (err) {
        console.error('admin aiSupportAsk error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Support insight endpoint for quick action cards
exports.supportInsight = async (req, res) => {
    try {
        const adminId = req.session.adminId;
        if (!adminId) return res.status(401).json({ success: false, message: 'Not authenticated' });
        const action = String(req.params.action || '').toLowerCase();
        console.log('[SUPPORT] supportInsight HIT', { adminId, action, originalUrl: req.originalUrl });

        if (action === 'overdue_rent') {
            const overdueInvoices = await Invoice.find({ adminId, status: 'overdue', isDeleted: false }).limit(50).lean();
            const totalOverdue = overdueInvoices.reduce((s, i) => s + (Number(i.balanceDue || 0)), 0);
            return res.json({ success: true, action, totalOverdue, items: overdueInvoices.slice(0, 20) });
        }

        if (action === 'high_risk_applications' || action === 'high_risk') {
            const apps = await Application.find({ adminId, aiRiskLevel: 'HIGH', isDeleted: false }).limit(50).lean();
            return res.json({ success: true, action: 'high_risk', count: apps.length, items: apps.slice(0, 20) });
        }

            if (action === 'pending_maintenance') {
            const tickets = await Ticket.find({ adminId, isDeleted: false, $or: [{ status: 'open' }, { status: 'pending' }] }).limit(50).lean();
            return res.json({ success: true, action, count: tickets.length, items: tickets.slice(0, 20) });
        }

        if (action === 'lease_expirations') {
            const soon = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
            const leases = await Lease.find({ adminId, leaseEndDate: { $lte: soon }, isDeleted: false }).limit(50).lean();
            return res.json({ success: true, action, count: leases.length, items: leases.slice(0, 20) });
        }

        if (action === 'occupancy_insights') {
            const totalProperties = await Property.countDocuments({ adminId, isDeleted: false });
            const totalLeases = await Lease.countDocuments({ adminId, isDeleted: false });
            const occupancyRate = totalProperties > 0 ? Math.round((totalLeases / totalProperties) * 100) : 0;
            console.log('[SUPPORT] occupancy_insights result', { totalProperties, totalLeases, occupancyRate });
            return res.json({ success: true, action, totalProperties, totalLeases, occupancyRate });
        }

        return res.status(400).json({ success: false, message: 'Unknown insight action' });
    } catch (err) {
        console.error('supportInsight error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
 
 // Support data API: returns JSON payloads for operations categories
 exports.supportData = async (req, res) => {
     try {
         const adminId = req.session.adminId;
         if (!adminId) return res.status(401).json({ success: false, message: 'Not authenticated' });

        // Rate limiting (very small, in-memory). Suitable for small deployments; replace with Redis for production.
        const nowTs = Date.now();
        let state = _supportRate.get(String(adminId));
        if (!state || state.resetAt <= nowTs) {
            state = { count: 0, resetAt: nowTs + SUPPORT_RATE_WINDOW_MS };
        }
        state.count += 1;
        _supportRate.set(String(adminId), state);
        if (state.count > SUPPORT_RATE_LIMIT) return res.status(429).json({ success: false, message: 'Rate limit exceeded' });

        const allowed = ['payments','applications','maintenance','leases','revenue','tenants'];
        const category = String(req.params.category || '').toLowerCase();
        console.log('[SUPPORT] supportData HIT', { adminId, category: req.params.category, query: req.query });
        if (!allowed.includes(category)) return res.status(400).json({ success: false, message: 'Unknown category' });

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const skip = (page - 1) * limit;

        const now = new Date();

        if (category === 'payments') {
            // Some environments may coerce query operators unexpectedly; use $or to be robust
            const match = { adminId, isDeleted: false, $or: [{ status: 'unpaid' }, { status: 'partial' }, { status: 'overdue' }] };
            console.log('[SUPPORT] payments match (using $or)', match);
            const total = await Invoice.countDocuments(match);
            const invoices = await Invoice.find(match).select('tenantId status totalAmount paidAmount balance dueDate createdAt').sort({ dueDate: 1 }).skip(skip).limit(limit).lean();
            const totalOutstanding = invoices.reduce((s, i) => s + (Number(i.balance != null ? i.balance : (Number(i.totalAmount || 0) - Number(i.paidAmount || 0))) || 0), 0);
            console.log('[SUPPORT] payments result', { total, returned: invoices.length, sample: invoices.slice(0,3) });
            res.set('X-Total-Count', String(total)).set('X-Page', String(page)).set('X-Per-Page', String(limit));
            return res.json({ success: true, category: 'payments', total, page, perPage: limit, totalOutstanding, items: invoices });
        }

        if (category === 'applications') {
            const matchPending = { adminId, status: 'pending', isDeleted: false };
            const totalPending = await Application.countDocuments(matchPending);
            const pending = await Application.find(matchPending).select('applicantName applicantEmail aiRiskLevel propertyId createdAt').sort({ createdAt: -1 }).skip(skip).limit(limit).populate('propertyId','_id propertyname address').lean();
            const matchHigh = { adminId, aiRiskLevel: 'HIGH', isDeleted: false };
            const totalHigh = await Application.countDocuments(matchHigh);
            const highRisk = await Application.find(matchHigh).select('applicantName applicantEmail aiRiskLevel propertyId createdAt').sort({ createdAt: -1 }).limit(50).lean();
            // Ask AI for short recommendations but don't block response on AI
            let ai = null;
            try { ai = await supportService.aiAssistAdmin(adminId, 'Provide short recommendations for handling pending applications and high-risk applicants'); } catch(e){ console.error('aiAssistAdmin failed', e); }
            console.log('[SUPPORT] applications result', { totalPending, totalHigh, returned: pending.length });
            res.set('X-Total-Pending', String(totalPending)).set('X-Total-HighRisk', String(totalHigh));
            return res.json({ success: true, category: 'applications', totalPending, totalHigh, page, perPage: limit, pending, highRisk, ai: ai && (ai.parsed || ai.raw) });
        }

        if (category === 'maintenance') {
            // Use $or for status matching to avoid operator coercion issues
            const matchOpen = { adminId, isDeleted: false, $or: [{ status: 'open' }, { status: 'pending' }, { status: 'in_progress' }] };
            const totalOpen = await Ticket.countDocuments(matchOpen);
            const open = await Ticket.find(matchOpen).select('subject status priority createdAt tenantId propertyId').sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
            const matchUrgent = { adminId, isDeleted: false, $or: [{ priority: 'urgent' }, { aiPriority: 'urgent' }] };
            const totalUrgent = await Ticket.countDocuments(matchUrgent);
            const urgent = await Ticket.find(matchUrgent).select('subject status priority createdAt tenantId propertyId').limit(50).lean();
            // average response time using recent resolved tickets (sample)
            const resolved = await Ticket.find({ adminId, isDeleted: false, status: 'resolved' }).select('createdAt updatedAt').limit(200).lean();
            let totalHours = 0; let count = 0;
            resolved.forEach(t => {
                if (t.createdAt && t.updatedAt) {
                    const hours = (new Date(t.updatedAt) - new Date(t.createdAt)) / (1000 * 60 * 60);
                    if (isFinite(hours) && hours >= 0) { totalHours += hours; count += 1; }
                }
            });
            const avgResponseHours = count ? Math.round((totalHours / count) * 100) / 100 : null;
            console.log('[SUPPORT] maintenance result', { totalOpen, totalUrgent, returnedOpen: open.length });
            res.set('X-Total-Open', String(totalOpen)).set('X-Total-Urgent', String(totalUrgent));
            return res.json({ success: true, category: 'maintenance', totalOpen, totalUrgent, page, perPage: limit, avgResponseHours, open, urgent });
        }

        if (category === 'leases') {
            const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
            const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
            const match30 = { adminId, isDeleted: false, leaseEndDate: { $lte: in30, $gte: now } };
            const match60 = { adminId, isDeleted: false, leaseEndDate: { $lte: in60, $gte: in30 } };
            const match90 = { adminId, isDeleted: false, leaseEndDate: { $lte: in90, $gte: in60 } };
            const [count30, count60, count90] = await Promise.all([
                Lease.countDocuments(match30), Lease.countDocuments(match60), Lease.countDocuments(match90)
            ]);
            const leases30 = await Lease.find(match30).select('tenantId propertyId leaseEndDate leaseStartDate status').limit(limit).skip(skip).lean();
            console.log('[SUPPORT] leases result', { counts: { in30: count30, in60: count60, in90: count90 }, returned: leases30.length });
            res.set('X-Expiring-30', String(count30)).set('X-Expiring-60', String(count60)).set('X-Expiring-90', String(count90));
            return res.json({ success: true, category: 'leases', counts: { in30: count30, in60: count60, in90: count90 }, page, perPage: limit, leases30 });
        }

        if (category === 'revenue') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const paymentsAgg = await Payment.aggregate([{ $match: { adminId, status: 'approved', isDeleted: false, createdAt: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$amountPaid' } } }]);
            const monthlyRevenue = paymentsAgg[0] ? Number(paymentsAgg[0].total) : 0;
            const totalProperties = await Property.countDocuments({ adminId, isDeleted: false });
            const totalLeases = await Lease.countDocuments({ adminId, isDeleted: false, status: 'active' });
            const occupancyRate = totalProperties > 0 ? Math.round((totalLeases / totalProperties) * 100) : 0;
            const paymentsAllAgg = await Payment.aggregate([{ $match: { adminId, status: 'approved', isDeleted: false } }, { $group: { _id: null, totalReceived: { $sum: '$amountPaid' } } }]);
            const invoicesAgg = await Invoice.aggregate([{ $match: { adminId, isDeleted: false } }, { $group: { _id: null, totalBilled: { $sum: '$totalAmount' } } }]);
            const totalReceived = paymentsAllAgg[0] ? Number(paymentsAllAgg[0].totalReceived) : 0;
            const totalBilled = invoicesAgg[0] ? Number(invoicesAgg[0].totalBilled) : 0;
            const collectionRate = totalBilled > 0 ? Math.round((totalReceived / totalBilled) * 100) : 0;
            return res.json({ success: true, category: 'revenue', monthlyRevenue, occupancyRate, collectionRate });
        }

        if (category === 'tenants') {
            const activeTenants = await Tenant.countDocuments({ adminId, isDeleted: false });
            const overdueTenantIds = await Invoice.distinct('tenantId', { adminId, status: 'overdue', isDeleted: false });
            const overdueTenants = overdueTenantIds ? overdueTenantIds.filter(Boolean).length : 0;
            const lateAgg = await Invoice.aggregate([{ $match: { adminId, isDeleted: false, status: { $in: ['overdue','partial','unpaid'] } } }, { $group: { _id: '$tenantId', count: { $sum: 1 } } }, { $match: { count: { $gte: 2 } } }, { $count: 'repeat' }]);
            const repeatLatePayers = lateAgg[0] ? lateAgg[0].repeat : 0;
            console.log('[SUPPORT] tenants result', { activeTenants, overdueTenants, repeatLatePayers });
            return res.json({ success: true, category: 'tenants', activeTenants, overdueTenants, repeatLatePayers });
        }
    } catch (err) {
        console.error('supportData error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
 };

// Signup
exports.signup = async (req, res) => {
    const { username, email, password, confirmPassword } = req.body;

    // Validate confirm password match
    if (!confirmPassword || password !== confirmPassword) {
        req.session.signupError = 'Passwords do not match';
        return res.redirect('/admin/signup/form');
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
        req.session.signupError = passwordValidation.message;
        return res.redirect('/admin/signup/form');
    }

    try {
        let admin = await Admin.findOne({ 
            $or: [
                { username: username.toLowerCase() },
                { email: email.toLowerCase() }
            ]
        });

        const otp = crypto.randomInt(100000, 999999).toString();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        if (admin) {
            if (admin.isVerified) {
                req.session.signupError = 'Username or email already exists and is verified. Please login.';
                return res.redirect('/admin/signup/form');
            } else {
                // If the account exists but isn't verified, just update the OTP and proceed
                admin.signupOTP = otp;
                admin.signupOTPExpiry = otpExpiry;
                // Also update the password if they typed a new one
                admin.password = password; 
            }
        } else {
            admin = new Admin({
                username: username.toLowerCase(),
                email: email.toLowerCase(),
                password,
                role: 'admin',
                isActive: true,
                isDeleted: false,
                isVerified: false,
                signupOTP: otp,
                signupOTPExpiry: otpExpiry
            });
        }

        await admin.save();

        // Send OTP email
        try {
            if (emailService.isResendAvailable()) {
                await emailService.sendSignupOtpEmail(admin.email, otp, admin.username);
                console.log(`[Admin Signup] ✅ [RESEND] Signup OTP sent to ${admin.email}`);
            } else {
                await notify.sendMail({
                    to: admin.email,
                    subject: 'Verify your LeaseHub Admin Account',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
                                <h1 style="color: white; margin: 0; text-align: center;">Welcome to LeaseHub Admin!</h1>
                            </div>
                            <div style="background: #f5f5f5; padding: 30px; border-radius: 0 0 10px 10px;">
                                <p>Hi <strong>${admin.username}</strong>,</p>
                                <p>Thank you for signing up for LeaseHub Admin. To complete your registration and activate your account, please verify your email address.</p>
                                <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 25px 0;">
                                    <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">Your verification OTP is:</p>
                                    <h2 style="color: #667eea; font-size: 36px; letter-spacing: 8px; margin: 10px 0;">${otp}</h2>
                                    <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">Valid for 10 minutes</p>
                                </div>
                                <p style="color: #666;">Enter this OTP on the verification page to activate your account.</p>
                            </div>
                        </div>
                    `,
                    text: `Your admin signup OTP is: ${otp}. Valid for 10 minutes.`
                });
                console.log(`[Admin Signup] ✅ [SMTP] Signup OTP sent to ${admin.email}`);
            }
            req.session.signupSuccess = 'OTP sent to your email. Please check your inbox.';
        } catch (emailErr) {
            console.error('Failed to send OTP email:', emailErr);
            req.session.signupError = 'Account created, but failed to send OTP email. Please resend OTP.';
        }

        req.session.verifyEmail = admin.email;
        req.session.save((err) => {
            if (err) console.error('Session save error during signup:', err);
            res.redirect('/admin/signup/verify');
        });
    } catch (err) {
        console.error('Signup error:', err);
        req.session.signupError = 'An error occurred during signup: ' + err.message;
        res.redirect('/admin/signup/form');
    }
};

// Verify OTP Form
exports.verifySignupOtpForm = (req, res) => {
    if (!req.session.verifyEmail) {
        return res.redirect('/admin/signup/form');
    }
    res.render('admin-verify-otp', {
        layout: false,
        email: req.session.verifyEmail,
        error: req.session.verifyError,
        success: req.session.signupSuccess || req.session.verifySuccess
    });
    req.session.verifyError = null;
    req.session.verifySuccess = null;
    req.session.signupSuccess = null;
};

// Verify OTP
exports.verifySignupOtp = async (req, res) => {
    const { email, otp } = req.body;
    
    try {
        const admin = await Admin.findOne({ email: email.toLowerCase() });
        
        if (!admin) {
            req.session.verifyError = 'Account not found.';
            return res.redirect('/admin/signup/verify');
        }
        
        if (admin.isVerified) {
            req.session.loginSuccess = 'Account already verified. Please login.';
            return res.redirect('/admin/login/form');
        }
        
        if (admin.signupOTP !== otp) {
            req.session.verifyEmail = email;
            req.session.verifyError = 'Invalid OTP. Please try again.';
            return res.redirect('/admin/signup/verify');
        }
        
        if (new Date() > admin.signupOTPExpiry) {
            req.session.verifyEmail = email;
            req.session.verifyError = 'OTP has expired. Please request a new one.';
            return res.redirect('/admin/signup/verify');
        }
        
        admin.isVerified = true;
        admin.signupOTP = undefined;
        admin.signupOTPExpiry = undefined;
        await admin.save();
        
        // Set up session for immediate login
        req.session.regenerate((regenErr) => {
            if (regenErr) {
                console.error('Session regenerate error:', regenErr);
                req.session.loginError = 'Email verified successfully, but an error occurred during login. Please login manually.';
                return res.redirect('/admin/login/form');
            }

            // Set session
            req.session.loggedIn = true;
            req.session.userType = 'admin';
            req.session.adminId = admin._id;
            req.session.adminName = admin.username;
            req.session.adminRole = admin.role;
            
            // Pass a success flash for the dashboard
            req.session.dashboardSuccess = 'Account created and verified successfully!';
            req.session.justSignedUp = true;
            
            req.session.save((saveErr) => {
                if (saveErr) console.error('Session save error:', saveErr);
                return res.redirect('/admin/dashboard');
            });
        });
    } catch (err) {
        console.error('Verify OTP error:', err);
        req.session.verifyEmail = email;
        req.session.verifyError = 'An error occurred during verification.';
        res.redirect('/admin/signup/verify');
    }
};



// Resend OTP
exports.resendSignupOtp = async (req, res) => {
    const email = req.body.email || req.session.verifyEmail;
    
    if (!email) {
        return res.redirect('/admin/signup/form');
    }
    
    try {
        const admin = await Admin.findOne({ email: email.toLowerCase() });
        
        if (!admin) {
            req.session.verifyError = 'Account not found.';
            return res.redirect('/admin/signup/verify');
        }
        
        if (admin.isVerified) {
            return res.redirect('/admin/login/form');
        }
        
        const otp = crypto.randomInt(100000, 999999).toString();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
        
        admin.signupOTP = otp;
        admin.signupOTPExpiry = otpExpiry;
        await admin.save();
        
        if (emailService.isResendAvailable()) {
            await emailService.sendSignupOtpEmail(admin.email, otp, admin.username);
            console.log(`[Admin Resend OTP] ✅ [RESEND] Signup OTP sent to ${admin.email}`);
        } else {
            await notify.sendMail({
                to: admin.email,
                subject: 'Verify your LeaseHub Admin Account',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
                            <h1 style="color: white; margin: 0; text-align: center;">Welcome to LeaseHub Admin!</h1>
                        </div>
                        <div style="background: #f5f5f5; padding: 30px; border-radius: 0 0 10px 10px;">
                            <p>Hi <strong>${admin.username}</strong>,</p>
                            <p>Thank you for signing up for LeaseHub Admin. To complete your registration and activate your account, please verify your email address.</p>
                            <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 25px 0;">
                                <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">Your verification OTP is:</p>
                                <h2 style="color: #667eea; font-size: 36px; letter-spacing: 8px; margin: 10px 0;">${otp}</h2>
                                <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">Valid for 10 minutes</p>
                            </div>
                            <p style="color: #666;">Enter this OTP on the verification page to activate your account.</p>
                        </div>
                    </div>
                `,
                text: `Your admin signup OTP is: ${otp}. Valid for 10 minutes.`
            });
            console.log(`[Admin Resend OTP] ✅ [SMTP] Signup OTP sent to ${admin.email}`);
        }
        
        req.session.verifyEmail = admin.email;
        req.session.verifySuccess = 'A new OTP has been sent to your email. Please check your inbox.';
        req.session.save((err) => {
            if (err) console.error('Session save error during resend OTP:', err);
            res.redirect('/admin/signup/verify');
        });
    } catch (err) {
        console.error('Resend OTP error:', err);
        req.session.verifyEmail = email;
        req.session.verifyError = 'Failed to resend OTP.';
        res.redirect('/admin/signup/verify');
    }
};

exports.forgotPasswordForm = (req, res) => {
    res.render('admin-forgot-password', {
        layout: false,
        error: req.session.forgotError,
        success: req.session.forgotSuccess
    });
    req.session.forgotError = null;
    req.session.forgotSuccess = null;
};

exports.sendForgotPasswordOtp = async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
        req.session.forgotError = 'Please enter your admin email.';
        return res.redirect('/admin/forgot-password');
    }
    try {
        const admin = await Admin.findOne({ email });
        if (!admin) {
            req.session.forgotError = 'No admin account found for that email.';
            return res.redirect('/admin/forgot-password');
        }
        const otp = crypto.randomInt(100000, 999999).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000);
        admin.resetOTP = otp;
        admin.resetOTPExpiry = expiry;
        await admin.save();
        await emailService.sendResetOtpEmail(admin.email, otp, admin.username);
        await createAuditLog({ req, userId: admin._id, userType: 'admin', action: 'admin.forgot_password_requested', entity: 'Admin', entityId: admin._id, changes: { email } });
        req.session.forgotEmail = email;
        req.session.forgotSuccess = 'OTP sent. Enter the code below to reset your password.';
        res.redirect('/admin/reset-password');
    } catch (err) {
        console.error('Forgot password error:', err);
        req.session.forgotError = 'Failed to send reset OTP.';
        res.redirect('/admin/forgot-password');
    }
};

exports.resetPasswordForm = (req, res) => {
    res.render('admin-reset-password', {
        layout: false,
        email: req.session.forgotEmail || '',
        error: req.session.resetError,
        success: req.session.resetSuccess
    });
    req.session.resetError = null;
    req.session.resetSuccess = null;
};

exports.resetPassword = async (req, res) => {
    const { email, otp, password, confirmPassword } = req.body;
    try {
        if (password !== confirmPassword) {
            req.session.resetError = 'Passwords do not match.';
            return res.redirect('/admin/reset-password');
        }
        const validation = validatePassword(password);
        if (!validation.isValid) {
            req.session.resetError = validation.message;
            return res.redirect('/admin/reset-password');
        }
        const admin = await Admin.findOne({ email: String(email || '').toLowerCase() });
        if (!admin || admin.resetOTP !== otp || !admin.resetOTPExpiry || new Date() > admin.resetOTPExpiry) {
            req.session.resetError = 'Invalid or expired OTP.';
            return res.redirect('/admin/reset-password');
        }
        admin.password = password;
        admin.resetOTP = undefined;
        admin.resetOTPExpiry = undefined;
        await admin.save();
        await createAuditLog({ req, userId: admin._id, userType: 'admin', action: 'admin.password_reset', entity: 'Admin', entityId: admin._id, changes: { email } });
        req.session.resetSuccess = 'Password reset successfully. You can sign in now.';
        res.redirect('/admin/login/form');
    } catch (err) {
        console.error('Reset password error:', err);
        req.session.resetError = 'Failed to reset password.';
        res.redirect('/admin/reset-password');
    }
};

// Change Password Form
exports.changePasswordForm = (req, res) => {
    res.render('admin-change-password', {
        layout: false,
        title: 'Change Password',
        adminName: req.session.adminName,
        success: req.session.changePasswordSuccess,
        error: req.session.changePasswordError
    });
    req.session.changePasswordSuccess = null;
    req.session.changePasswordError = null;
};

// Change Password
exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    try {
        if (newPassword !== confirmPassword) {
            req.session.changePasswordError = 'New password and confirmation do not match.';
            return res.redirect('/admin/change-password');
        }
        
        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.isValid) {
            req.session.changePasswordError = passwordValidation.message;
            return res.redirect('/admin/change-password');
        }
        
        const admin = await Admin.findOne({ _id: req.session.adminId });
        
        const isMatch = await bcrypt.compare(currentPassword, admin.password);
        if (!isMatch) {
            req.session.changePasswordError = 'Current password is incorrect.';
            return res.redirect('/admin/change-password');
        }
        
        const isSameAsOld = await bcrypt.compare(newPassword, admin.password);
        if (isSameAsOld) {
            req.session.changePasswordError = 'New password cannot be the same as the old password.';
            return res.redirect('/admin/change-password');
        }
        
        admin.password = newPassword;
        await admin.save();
        
        req.session.changePasswordSuccess = 'Password updated successfully.';
        res.redirect('/admin/change-password');
    } catch (err) {
        console.error('Change password error:', err);
        req.session.changePasswordError = 'An error occurred while changing password.';
        res.redirect('/admin/change-password');
    }
};


// Login
exports.login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const admin = await Admin.findOne({ 
            username: username.toLowerCase(),
            isActive: true,
            isDeleted: false
        });

        console.log('[LOGIN DEBUG] admin found:', !!admin);
        console.log('[LOGIN DEBUG] isVerified:', admin?.isVerified, '| isActive:', admin?.isActive);
        console.log('[LOGIN] attempt for', username && username.toLowerCase(), 'found admin:', !!admin, 'adminId:', admin && admin._id, 'pwdHashLen:', admin && admin.password && admin.password.length);

        if (!admin) {
            req.session.loginError = 'Invalid credentials';
            return res.redirect('/admin/login/form');
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, admin.password);
        console.log('[LOGIN] password match:', isMatch);
        if (!isMatch) {
            req.session.loginError = 'Invalid credentials';
            return res.redirect('/admin/login/form');
        }

        req.session.regenerate((regenErr) => {
            if (regenErr) {
                console.error('Session regenerate error:', regenErr);
                req.session.loginError = 'An error occurred during login';
                return res.redirect('/admin/login/form');
            }

            // Set session
            req.session.loggedIn = true;
            req.session.userType = 'admin';
            req.session.adminId = admin._id;
            req.session.adminName = admin.username;
            req.session.adminRole = admin.role;

            // ✅ Save FIRST, then redirect
            req.session.save((saveErr) => {
                if (saveErr) {
                    console.error('Session save error:', saveErr);
                    req.session.loginError = 'An error occurred during login';
                    return res.redirect('/admin/login/form');
                }
                return res.redirect('/admin/dashboard');
            });
        });
    } catch (err) {
        console.error('Login error:', err);
        req.session.loginError = 'An error occurred during login';
        res.redirect('/admin/login/form');
    }
};

// Logout
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/');
    });
};

// Dashboard
exports.dashboard = async (req, res) => {
    try {
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
        const isSuperAdmin = String(req.session.adminRole || '').toLowerCase() === 'superadmin';
        const adminScope = isSuperAdmin ? {} : { adminId: req.session.adminId };
        
        // Basic Stats
        const totalTenants = await Tenant.countDocuments({ ...adminScope, isDeleted: false });
        const totalProperties = await Property.countDocuments({ ...adminScope, isDeleted: false });
        const occupiedProperties = await Property.countDocuments({ ...adminScope, status: 'occupied', isDeleted: false });
        const availableProperties = await Property.countDocuments({ ...adminScope, status: 'available', isDeleted: false });
        const activeLeases = await Lease.countDocuments({ ...adminScope, status: 'active', isDeleted: false });
        const pendingApplications = await Application.countDocuments({ ...adminScope, status: 'pending', isDeleted: false });

        // Critical Alerts
        const overdueInvoices = await Invoice.countDocuments({ ...adminScope,
            status: 'overdue',
            isDeleted: false
        });

        // Rent control metrics
        const nowStartOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // All open rent invoices (monthly rent or legacy rent) that are unpaid/partial/overdue
        const openRentInvoices = await Invoice.find({ ...adminScope,
            isDeleted: false,
            $and: [
                { $or: [ { type: 'monthly_rent' }, { type: 'rent' } ] },
                { $or: [ { status: 'unpaid' }, { status: 'partial' }, { status: 'overdue' } ] }
            ]
        }).lean();

        let totalOutstandingRent = 0;
        const tenantLateDays = new Map(); // tenantId -> { lateInvoices, totalLateDays }

        openRentInvoices.forEach(inv => {
            const totalAmount = Number(inv.totalAmount) || 0;
            const paidAmount = Number(inv.paidAmount) || 0;
            const balance = typeof inv.balance === 'number'
                ? Number(inv.balance)
                : Math.max(0, totalAmount - paidAmount);

            totalOutstandingRent += balance;

            if (inv.dueDate) {
                const due = new Date(inv.dueDate);
                if (!isNaN(due.getTime()) && nowStartOfDay > due) {
                    const diffDays = Math.floor((nowStartOfDay - due) / (1000 * 60 * 60 * 24));
                    const tenantKey = String(inv.tenantId);
                    if (!tenantLateDays.has(tenantKey)) {
                        tenantLateDays.set(tenantKey, { lateInvoices: 0, totalLateDays: 0 });
                    }
                    const agg = tenantLateDays.get(tenantKey);
                    agg.lateInvoices += 1;
                    agg.totalLateDays += diffDays;
                }
            }
        });

        // Tenants overdue > 5 days (at least one invoice more than 5 days late)
        let tenantsOverdue5Plus = 0;
        tenantLateDays.forEach(value => {
            if (value.totalLateDays > 5) {
                tenantsOverdue5Plus += 1;
            }
        });

        // Repeat late payers: tenants with 2+ late invoices
        let repeatLatePayers = 0;
        tenantLateDays.forEach(value => {
            if (value.lateInvoices >= 2) {
                repeatLatePayers += 1;
            }
        });

        // Leases expiring within 30 days
        const expiringLeases = await Tenant.countDocuments({ ...adminScope,
            leaseEndDate: { $lte: thirtyDaysFromNow, $gte: now },
            isDeleted: false
        });

        // Pending maintenance tickets
        const pendingMaintenance = await Ticket.countDocuments({ ...adminScope,
            isDeleted: false,
            $or: [ { status: 'open' }, { status: 'pending' } ]
        }).catch(() => 0);

        // Upcoming Rent Due (Next 7 Days)
        const upcomingDues = await Tenant.find({ ...adminScope,
            isDeleted: false
        })
        .populate('propertyId', 'propertyname rent rentDueDay')
        .lean();

        // Filter and format upcoming dues
        const upcomingDuesFormatted = upcomingDues
            .filter(tenant => {
                if (!tenant.propertyId) return false;
                const dueDay = tenant.propertyId.rentDueDay || 5;
                const nextDueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
                if (nextDueDate < now) {
                    nextDueDate.setMonth(nextDueDate.getMonth() + 1);
                }
                return nextDueDate <= sevenDaysFromNow;
            })
            .map(tenant => {
                const dueDay = tenant.propertyId.rentDueDay || 5;
                const nextDueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
                if (nextDueDate < now) {
                    nextDueDate.setMonth(nextDueDate.getMonth() + 1);
                }
                return {
                    tenantId: String(tenant._id),
                    tenantName: `${tenant.firstname} ${tenant.lastname}`,
                    propertyName: tenant.propertyId.propertyname,
                    dueDate: nextDueDate.toLocaleDateString('en-IN'),
                    amount: tenant.propertyId.rent
                };
            });

        // Get recent payments
        const recentPayments = await Payment.find({ ...adminScope, isDeleted: false })
            .populate('tenantId', 'firstname lastname')
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        // Get pending invoices with overdue calculation (includes booking deposits)
        const pendingInvoices = await Invoice.find({ ...adminScope, 
            isDeleted: false,
            $or: [
                { status: 'unpaid' },
                { status: 'overdue' }
            ]
        })
            .populate('tenantId', 'firstname lastname')
            .populate('propertyId', 'propertyname rent')
            .sort({ dueDate: 1 })
            .limit(10)
            .lean();

        // Calculate days overdue
        pendingInvoices.forEach(invoice => {
            if (invoice.dueDate && new Date(invoice.dueDate) < now) {
                const diffTime = Math.abs(now - new Date(invoice.dueDate));
                invoice.daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }
        });

        // Simple late payment prediction based on history
        const predictions = await Payment.aggregate([
            { $match: { ...adminScope, 
                    isDeleted: false,
                    status: 'approved'
                }
            },
            {
                $group: {
                    _id: '$tenantId',
                    avgDaysLate: { $avg: '$daysLate' },
                    lateCount: {
                        $sum: {
                            $cond: [{ $gt: ['$daysLate', 0] }, 1, 0]
                        }
                    },
                    totalPayments: { $sum: 1 }
                }
            },
            {
                $match: {
                    lateCount: { $gte: 2 }
                }
            },
            {
                $limit: 5
            }
        ]);

        const predictionsFormatted = await Promise.all(
            predictions.map(async (pred) => {
                const tenant = await Tenant.findById(pred._id).populate('propertyId', 'propertyname').lean();
                if (!tenant) return null;
                const riskLevel = Math.min(Math.round((pred.lateCount / pred.totalPayments) * 100), 100);
                return {
                    tenantName: `${tenant.firstname} ${tenant.lastname}`,
                    propertyName: tenant.propertyId?.propertyname || 'N/A',
                    riskLevel
                };
            })
        );

        const totalApplications = await Application.countDocuments({ ...adminScope, isDeleted: false });

        const aiInsights = await Application.aggregate([
            { $match: { ...adminScope, isDeleted: false } },
            {
                $group: {
                    _id: '$aiRiskLevel',
                    count: { $sum: 1 },
                    avgConfidence: { $avg: '$aiConfidenceScore' }
                }
            }
        ]);

        const aiRiskCounts = { low: 0, medium: 0, high: 0 };
        let pendingAiCount = 0;
        let confidenceSum = 0;
        let confidenceCount = 0;

        aiInsights.forEach(item => {
            const level = String(item._id || '').trim().toLowerCase();
            const count = Number(item.count || 0);
            const avgScore = Number(item.avgConfidence || 0);

            if (level === 'low') aiRiskCounts.low = count;
            else if (level === 'medium') aiRiskCounts.medium = count;
            else if (level === 'high') aiRiskCounts.high = count;
            else pendingAiCount += count;

            if (count > 0 && !Number.isNaN(avgScore)) {
                confidenceSum += avgScore * count;
                confidenceCount += count;
            }
        });

        const avgConfidence = confidenceCount ? Math.round(confidenceSum / confidenceCount) : 0;
        const totalAiRecords = aiRiskCounts.low + aiRiskCounts.medium + aiRiskCounts.high + pendingAiCount;
        const hasAiData = totalAiRecords > 0;

        const recommendationAgg = await Application.aggregate([
            { $match: { ...adminScope, isDeleted: false } },
            { $group: { _id: '$aiRecommendation', count: { $sum: 1 } } }
        ]);
        const approvalCount = recommendationAgg.reduce((sum, item) => {
            const recommendation = String(item._id || '').trim().toUpperCase();
            return sum + (recommendation === 'APPROVE' ? Number(item.count || 0) : 0);
        }, 0);

        const maintenanceCategoryBreakdown = await Ticket.aggregate([
            { $match: { ...adminScope, isDeleted: false } },
            { $group: { _id: '$aiCategory', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        const notifications = await Notification.find({ ...adminScope, userType: 'admin' })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        // --- AI Assistant & KPI aggregations ---
        // High risk applicants
        const highRiskApplicants = await Application.countDocuments({ ...adminScope, aiRiskLevel: 'HIGH', isDeleted: false });

        // Tenants with overdue invoices (distinct)
        const overdueTenantIds = await Invoice.distinct('tenantId', { ...adminScope, status: 'overdue', isDeleted: false });
        const overdueTenants = overdueTenantIds ? overdueTenantIds.filter(Boolean).length : 0;

        // Unpaid invoices count
        const unpaidInvoices = await Invoice.countDocuments({ ...adminScope, isDeleted: false, $or: [{ status: 'unpaid' }, { status: 'overdue' }, { status: 'partial' }] });

        // Maintenance emergencies (urgent)
        const maintenanceEmergencies = await Ticket.countDocuments({ ...adminScope, $or: [{ priority: 'urgent' }, { aiPriority: 'urgent' }], isDeleted: false });

        // Highest revenue properties (top 5)
        const revenueByProperty = await Payment.aggregate([
            { $match: { ...adminScope, status: 'approved', isDeleted: false } },
            { $group: { _id: '$propertyId', total: { $sum: '$amountPaid' } } },
            { $sort: { total: -1 } },
            { $limit: 5 }
        ]);
        let topProperties = await Promise.all(revenueByProperty.map(async r => {
            const prop = await Property.findById(r._id).lean();
            return { property: prop ? prop.propertyname : 'Unknown', revenue: r.total, source: 'payment' };
        }));

        if (!topProperties.length) {
            const fallbackProperties = await Property.find({ ...adminScope, isDeleted: false }).sort({ rent: -1 }).limit(5).lean();
            topProperties = fallbackProperties.map(prop => ({
                property: prop.propertyname || 'Unnamed property',
                revenue: Number(prop.rent) || 0,
                source: 'potential'
            }));
        }

        // Occupancy & collection metrics
        const occupancyRate = totalProperties > 0 ? Math.round((occupiedProperties / totalProperties) * 100) : 0;

        const paymentsAgg = await Payment.aggregate([
            { $match: { ...adminScope, status: 'approved', isDeleted: false } },
            { $group: { _id: null, totalReceived: { $sum: '$amountPaid' } } }
        ]);
        const invoicesAgg = await Invoice.aggregate([
            { $match: { ...adminScope, isDeleted: false } },
            { $group: { _id: null, totalBilled: { $sum: '$totalAmount' } } }
        ]);
        const totalReceived = paymentsAgg[0] ? Number(paymentsAgg[0].totalReceived) : 0;
        const totalBilled = invoicesAgg[0] ? Number(invoicesAgg[0].totalBilled) : 0;
        const collectionRate = totalBilled > 0 ? Math.round((totalReceived / totalBilled) * 100) : 0;

        // Vacant properties
        const vacantProperties = availableProperties;

        // KPIs
        const totalRevenue = totalReceived;
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyPayments = await Payment.aggregate([
            { $match: { ...adminScope, status: 'approved', isDeleted: false, createdAt: { $gte: startOfMonth } } },
            { $group: { _id: null, total: { $sum: '$amountPaid' } } }
        ]);
        const monthlyRevenue = monthlyPayments[0] ? Number(monthlyPayments[0].total) : 0;

        // Lease renewal rate: leases with same tenant having multiple leases (simple proxy)
        const renewalAgg = await Lease.aggregate([
            { $match: { ...adminScope, isDeleted: false } },
            { $group: { _id: '$tenantId', count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $count: 'renewals' }
        ]);
        const renewalCount = renewalAgg[0] ? renewalAgg[0].renewals : 0;
        const leaseCount = await Lease.countDocuments({ ...adminScope, isDeleted: false });
        const leaseRenewalRate = leaseCount > 0 ? Math.round((renewalCount / leaseCount) * 100) : 0;

        // Maintenance SLA: percent resolved within 72 hours
        const resolvedTickets = await Ticket.find({ ...adminScope, status: 'resolved', isDeleted: false }).lean();
        let resolvedWithin = 0;
        for (const t of resolvedTickets) {
            if (t.createdAt && t.updatedAt) {
                const hours = (new Date(t.updatedAt) - new Date(t.createdAt)) / (1000 * 60 * 60);
                if (hours <= 72) resolvedWithin += 1;
            }
        }
        const maintenanceSLA = resolvedTickets.length > 0 ? Math.round((resolvedWithin / resolvedTickets.length) * 100) : 0;

        // Average AI risk numeric
        const riskLevelMap = { LOW: 1, MEDIUM: 2, HIGH: 3 };
        const avgAiRiskObj = await Application.aggregate([
            { $match: { ...adminScope, isDeleted: false, aiRiskLevel: { $in: ['LOW','MEDIUM','HIGH'] } } },
            { $group: { _id: '$aiRiskLevel', count: { $sum: 1 } } }
        ]);
        let avgAiRisk = 0;
        let totalRiskCount = 0;
        avgAiRiskObj.forEach(item => { totalRiskCount += item.count; avgAiRisk += (riskLevelMap[item._id] || 0) * item.count; });
        avgAiRisk = totalRiskCount > 0 ? (avgAiRisk / totalRiskCount) : 0;

        // AI insights messages
        const insights = [];
        if (totalTenants > 0) insights.push(`Portfolio currently monitors ${totalTenants} tenant(s) and ${totalProperties} property(ies).`);
        if (highRiskApplicants > 0) insights.push(`${highRiskApplicants} high-risk applicant(s) need review before approval.`);
        if (overdueTenants > 0) insights.push(`${overdueTenants} tenant(s) have overdue balances that need follow-up.`);
        if (expiringLeases > 0) insights.push(`${expiringLeases} lease(s) are due to expire in the next 30 days.`);
        if (maintenanceEmergencies > 0) insights.push(`${maintenanceEmergencies} urgent maintenance ticket(s) require immediate attention.`);
        if (topProperties.length) insights.push(`Top revenue opportunities are led by ${topProperties[0].property} with ${utils.currency.symbol}${topProperties[0].revenue}.`);
        if (!insights.length) insights.push('Your lease portfolio is healthy right now. No urgent AI alerts were found.');

        const dashboardSuccess = req.session.dashboardSuccess;
        delete req.session.dashboardSuccess;

        res.render('admin-dashboard', {
            layout: false,
            adminName: req.session.adminName,
            dashboardSuccess,
            currentDate: now.toLocaleDateString('en-IN', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            }),
            stats: {
                totalTenants,
                totalProperties,
                occupiedProperties,
                availableProperties,
                activeLeases,
                pendingApplications
            },
            aiAssistant: {
                highRiskApplicants,
                overdueTenants,
                unpaidInvoices,
                maintenanceEmergencies,
                topProperties,
                insights
            },
            aiInsights: {
                lowRiskCount: aiRiskCounts.low,
                mediumRiskCount: aiRiskCounts.medium,
                highRiskCount: aiRiskCounts.high,
                pendingAiCount,
                avgConfidence,
                hasAiData,
                maintenanceCategories: maintenanceCategoryBreakdown,
                approvalRecommendationRate: totalApplications ? Math.round((approvalCount / Math.max(totalApplications, 1)) * 100) : 0
            },
            kpis: {
                totalRevenue,
                monthlyRevenue,
                occupancyRate,
                collectionRate,
                vacantProperties,
                leaseRenewalRate,
                maintenanceSLA,
                avgAiRisk: Math.round(avgAiRisk * 100) / 100
            },
            alerts: {
                overduePayments: overdueInvoices,
                expiringLeases,
                pendingMaintenance,
                tenantsOverdue5Plus,
                totalOutstandingRent,
                repeatLatePayers
            },
            upcomingDues: upcomingDuesFormatted,
            recentPayments,
            pendingInvoices,
            predictions: predictionsFormatted.filter(p => p !== null)
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send('Error loading dashboard: ' + err.message);
    }
};

// Detailed list of overdue and open rent invoices
exports.overdueRent = async (req, res) => {
    try {
        const now = new Date();
        const nowStartOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const rentInvoices = await Invoice.find({ adminId: req.session.adminId,
            isDeleted: false,
            $and: [
                { $or: [ { type: 'monthly_rent' }, { type: 'rent' } ] },
                { $or: [ { status: 'unpaid' }, { status: 'partial' }, { status: 'overdue' } ] }
            ]
        })
            .populate('tenantId', 'firstname lastname')
            .populate('propertyId', 'propertyname')
            .sort({ dueDate: 1 })
            .lean();

        // Late fee invoices associated with the same tenants/properties/months.
        // To keep this robust and avoid ObjectId $in casting issues, we simply
        // load all open late_fee invoices and filter/aggregate them in memory
        // keyed by tenant/property/month.
        const lateFeeInvoices = await Invoice.find({ adminId: req.session.adminId,
            isDeleted: false,
            type: 'late_fee',
            $or: [
                { status: 'unpaid' },
                { status: 'partial' },
                { status: 'overdue' }
            ]
        }).lean();

        const lateFeeMap = new Map(); // key: tenantId|propertyId|month -> lateFeeOutstanding
        let totalRentOutstanding = 0;
        let totalLateFeeOutstanding = 0;
        let tenantsOverdue5Plus = 0;
        const tenantOverdueSet = new Set();

        rentInvoices.forEach(inv => {
            const totalAmount = Number(inv.totalAmount) || 0;
            const paidAmount = Number(inv.paidAmount) || 0;
            const balance = typeof inv.balance === 'number'
                ? Number(inv.balance)
                : Math.max(0, totalAmount - paidAmount);

            inv.outstanding = balance;
            totalRentOutstanding += balance;

            if (inv.dueDate) {
                const due = new Date(inv.dueDate);
                if (!isNaN(due.getTime()) && nowStartOfDay > due) {
                    const diffDays = Math.floor((nowStartOfDay - due) / (1000 * 60 * 60 * 24));
                    inv.daysOverdue = diffDays;

                    if (diffDays > 5 && inv.tenantId) {
                        const key = String(inv.tenantId._id);
                        if (!tenantOverdueSet.has(key)) {
                            tenantOverdueSet.add(key);
                            tenantsOverdue5Plus += 1;
                        }
                    }
                }
            }
        });

        // Build late fee map keyed by tenant/property/month
        for (const lf of lateFeeInvoices) {
            const key = `${lf.tenantId?.toString() || ''}|${lf.propertyId?.toString() || ''}|${lf.month || ''}`;
            const lfTotal = Number(lf.totalAmount) || 0;
            const lfPaid = Number(lf.paidAmount) || 0;
            const lfBalance = lf.balance != null
                ? Number(lf.balance)
                : Math.max(0, lfTotal - lfPaid);

            const prev = lateFeeMap.get(key) || 0;
            const sum = prev + lfBalance;
            lateFeeMap.set(key, sum);
            totalLateFeeOutstanding += lfBalance;
        }

        // Attach per-row late fee outstanding
        rentInvoices.forEach(inv => {
            const key = `${inv.tenantId?._id?.toString() || inv.tenantId?.toString() || ''}|${inv.propertyId?._id?.toString() || inv.propertyId?.toString() || ''}|${inv.month || ''}`;
            inv.lateFeeOutstanding = lateFeeMap.get(key) || 0;
        });

        res.render('admin-rent-overdue', {
            layout: false,
            adminName: req.session.adminName,
            invoices: rentInvoices,
            totals: {
                rentOutstanding: totalRentOutstanding,
                lateFeeOutstanding: totalLateFeeOutstanding,
                totalOutstanding: totalRentOutstanding + totalLateFeeOutstanding,
                tenantsOverdue5Plus
            }
        });
    } catch (err) {
        console.error('Overdue rent view error:', err);
        res.status(500).send('Error loading overdue rent view: ' + err.message);
    }
};

// Tenants List
exports.tenants = async (req, res) => {
    try {
        const tenants = await Tenant.find({ adminId: req.session.adminId, isDeleted: false })
            .populate('propertyId', 'propertyname propertyaddress')
            .sort({ createdAt: -1 })
            .lean();

        res.render('admin-tenants', {
            layout: false,
            adminName: req.session.adminName,
            tenants
        });
    } catch (err) {
        console.error('Tenants error:', err);
        res.status(500).send('Error loading tenants');
    }
};

// View single tenant
exports.viewTenant = async (req, res) => {
    try {
        const tenant = await Tenant.findOne({ _id: req.params.id, adminId: req.session.adminId })
            .populate('propertyId', 'propertyname')
            .lean();

        if (!tenant) {
            return res.redirect('/admin/tenants');
        }

        res.render('admin-tenant-view', {
            layout: false,
            adminName: req.session.adminName,
            tenant
        });
    } catch (err) {
        console.error('View tenant error:', err);
        res.redirect('/admin/tenants');
    }
};

// Edit tenant form
exports.editTenantForm = async (req, res) => {
    try {
        const tenant = await Tenant.findOne({ _id: req.params.id, adminId: req.session.adminId })
            .populate('propertyId', 'propertyname')
            .lean();

        if (!tenant) {
            return res.redirect('/admin/tenants');
        }

        res.render('admin-tenant-edit', {
            layout: false,
            adminName: req.session.adminName,
            tenant
        });
    } catch (err) {
        console.error('Edit tenant form error:', err);
        res.redirect('/admin/tenants');
    }
};

// Update tenant
exports.updateTenant = async (req, res) => {
    try {
        const tenant = await Tenant.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!tenant) {
            return res.redirect('/admin/tenants');
        }

        const before = {
            firstname: tenant.firstname,
            lastname: tenant.lastname,
            email: tenant.email,
            phone: tenant.phone,
            status: tenant.status
        };

        tenant.firstname = req.body.firstname;
        tenant.lastname = req.body.lastname;
        tenant.email = req.body.email.toLowerCase();
        tenant.phone = req.body.phone;
        tenant.status = req.body.status || tenant.status;

        await tenant.save();

        await createAuditLog({
            req,
            userId: req.session.adminId,
            userType: 'admin',
            action: 'update_tenant',
            entity: 'Tenant',
            entityId: tenant._id,
            changes: { before, after: {
                firstname: tenant.firstname,
                lastname: tenant.lastname,
                email: tenant.email,
                phone: tenant.phone,
                status: tenant.status
            }}
        });

        req.session.success = 'Tenant updated successfully!';
        res.redirect('/admin/tenants');
    } catch (err) {
        console.error('Update tenant error:', err);
        req.session.error = 'Failed to update tenant';
        res.redirect('/admin/tenants');
    }
};

// Properties List
exports.properties = async (req, res) => {
    try {
        const properties = await Property.find({ adminId: req.session.adminId, isDeleted: false })
            .populate('tenantId', 'firstname lastname')
            .sort({ createdAt: -1 })
            .lean();

        res.render('admin-properties', {
            layout: false,
            adminName: req.session.adminName,
            properties,
            success: req.session.success,
            error: req.session.error
        });

        delete req.session.success;
        delete req.session.error;
    } catch (err) {
        console.error('Properties error:', err);
        res.status(500).send('Error loading properties');
    }
};

// View single property
exports.viewProperty = async (req, res) => {
    try {
        const property = await Property.findOne({ _id: req.params.id, adminId: req.session.adminId })
            .populate('tenantId', 'firstname lastname email')
            .lean();

        if (!property) {
            return res.redirect('/admin/properties');
        }

        res.render('admin-property-view', {
            layout: false,
            adminName: req.session.adminName,
            property
        });
    } catch (err) {
        console.error('View property error:', err);
        res.redirect('/admin/properties');
    }
};

// Edit property form
exports.editPropertyForm = async (req, res) => {
    try {
        const property = await Property.findOne({ _id: req.params.id, adminId: req.session.adminId }).lean();
        if (!property) {
            return res.redirect('/admin/properties');
        }

        res.render('admin-property-edit', {
            layout: false,
            adminName: req.session.adminName,
            property
        });
    } catch (err) {
        console.error('Edit property form error:', err);
        res.redirect('/admin/properties');
    }
};

// Update property
exports.updateProperty = async (req, res) => {
    try {
        const property = await Property.findOne({ _id: req.params.id, adminId: req.session.adminId });
        if (!property) {
            return res.redirect('/admin/properties');
        }

        const before = {
            propertyname: property.propertyname,
            rent: property.rent,
            status: property.status
        };

        // Handle existing images
        let existingImages = [];
        if (req.body.existingImages) {
            existingImages = Array.isArray(req.body.existingImages) 
                ? req.body.existingImages 
                : [req.body.existingImages];
        }

        // Handle newly uploaded images
        const newImages = req.files ? req.files.map(file => file.filename) : [];

        // Combine existing and new images
        const allImages = [...existingImages, ...newImages];

        property.propertyname = req.body.propertyname;
        property.propertyaddress = req.body.propertyaddress;
        property.city = req.body.city;
        property.state = req.body.state;
        property.pincode = req.body.pincode;
        property.rent = Number(req.body.rent) || property.rent;
        property.bookingDeposit = Number(req.body.bookingDeposit) || property.bookingDeposit;
        property.deposit = Number(req.body.deposit) || property.deposit;
        property.status = req.body.status || property.status;
        property.images = allImages;

        await property.save();

        await createAuditLog({
            req,
            userId: req.session.adminId,
            userType: 'admin',
            action: 'update_property',
            entity: 'Property',
            entityId: property._id,
            changes: { before, after: {
                propertyname: property.propertyname,
                rent: property.rent,
                status: property.status
            }}
        });

        req.session.success = 'Property updated successfully!';
        res.redirect('/admin/properties');
    } catch (err) {
        console.error('Update property error:', err);
        req.session.error = 'Failed to update property';
        res.redirect('/admin/properties');
    }
};

// Payments List (driven by invoices so admin can see deposit status)
exports.payments = async (req, res) => {
    try {
        const filter = req.query.filter; // currently not used for DB filter to avoid casting issues

        const invoices = await Invoice.find({ adminId: req.session.adminId, isDeleted: false })
            .populate('tenantId', 'firstname lastname')
            .populate('propertyId', 'propertyname rent')
            .sort({ createdAt: -1 })
            .lean();

        res.render('admin-payments', {
            layout: false,
            adminName: req.session.adminName,
            invoices,
            filter
        });
    } catch (err) {
        console.error('Payments error:', err);
        res.status(500).send('Error loading payments');
    }
};

// Create Invoice Form
exports.createInvoiceForm = async (req, res) => {
    try {
        const tenants = await Tenant.find({ adminId: req.session.adminId, isDeleted: false })
            .select('firstname lastname email tenantId')
            .lean();

        const properties = await Property.find({ adminId: req.session.adminId, isDeleted: false })
            .select('propertyname')
            .lean();

        res.render('admin-add-invoice', {
            layout: false,
            adminName: req.session.adminName,
            tenants,
            properties
        });
    } catch (err) {
        console.error('Create invoice form error:', err);
        res.status(500).send('Error loading invoice form');
    }
};

// Create Invoice
exports.createInvoice = async (req, res) => {
    try {
        const { tenantId, propertyId, month, rentAmount, maintenanceCharges, waterCharges, electricityCharges, otherCharges, totalAmount, dueDate } = req.body;

        if (!tenantId || !propertyId || !month || !rentAmount || !dueDate || !totalAmount) {
            return res.status(400).json({ 
                success: false, 
                message: 'Tenant, Property, Month, Rent Amount, Total Amount, and Due Date are required' 
            });
        }

        // Create invoice
        const invoice = new Invoice({ adminId: req.session.adminId,
            tenantId,
            propertyId,
            month,
            rentAmount: parseFloat(rentAmount),
            maintenanceCharges: parseFloat(maintenanceCharges) || 0,
            waterCharges: parseFloat(waterCharges) || 0,
            electricityCharges: parseFloat(electricityCharges) || 0,
            otherCharges: parseFloat(otherCharges) || 0,
            totalAmount: parseFloat(totalAmount),
            dueDate: new Date(dueDate),
            status: 'unpaid'
        });

        await invoice.save();

        // Notify tenant about the new invoice
        try {
            const tenant = await Tenant.findById(tenantId).lean();
            const property = await Property.findById(propertyId).lean();

            if (tenant) {
                await Notification.create({
                    userType: 'tenant',
                    tenantId,
                    title: 'New invoice generated',
                    message: `A new invoice for ${property?.propertyname || 'your property'} has been generated for ₹${totalAmount}.`,
                    type: 'invoice_generated',
                    metadata: {
                        invoiceId: invoice._id,
                        propertyId,
                        month
                    }
                });
            }

            if (tenant?.email) {
                await notify.sendMail({
                    to: tenant.email,
                    subject: `New invoice generated for ${property?.propertyname || 'your property'}`,
                    text: `A new invoice of ₹${totalAmount} has been generated for ${property?.propertyname || 'your property'} and is due on ${new Date(dueDate).toLocaleDateString('en-IN')}.`,
                    html: `<p>Hi ${tenant?.firstname || 'Tenant'},</p>
                           <p>A new invoice for <strong>${property?.propertyname || 'your property'}</strong> has been generated.</p>
                           <p><strong>Amount:</strong> ₹${totalAmount}</p>
                           <p><strong>Due date:</strong> ${new Date(dueDate).toLocaleDateString('en-IN')}</p>
                           <p>You can view this invoice in your tenant portal.</p>`
                });
            }
        } catch (notifyErr) {
            console.error('Failed to notify tenant about invoice creation:', notifyErr.message || notifyErr);
        }

        // Create ledger entry
        await LedgerEntry.create({
            tenantId,
            type: 'debit',
            amount: parseFloat(totalAmount),
            description: `Invoice created for ${month} - Rent: $${rentAmount}`,
            reference: `invoice_${invoice._id}`,
            balance: 0
        });

        res.json({ 
            success: true, 
            message: 'Invoice created successfully',
            invoiceId: invoice._id
        });
    } catch (err) {
        console.error('Create invoice error:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error creating invoice: ' + err.message 
        });
    }
};

// Reports
exports.reports = async (req, res) => {
    try {
        res.render('admin-reports', {
            layout: false,
            adminName: req.session.adminName
        });
    } catch (err) {
        console.error('Reports error:', err);
        res.status(500).send('Error loading reports');
    }
};

// Show Add Property Form
exports.addPropertyForm = async (req, res) => {
    try {
        res.render('admin-add-property', {
            layout: false,
            adminName: req.session.adminName,
            error: req.session.error,
            success: req.session.success
        });
        delete req.session.error;
        delete req.session.success;
    } catch (err) {
        console.error('Add property form error:', err);
        res.status(500).send('Error loading form');
    }
};

// Add Property
exports.addProperty = async (req, res) => {
    
    try {
        const rent = Number(req.body.rent) || 0;
        const deposit = Number(req.body.deposit) || 0;
        const maintenanceFee = Number(req.body.maintenanceFee) || 0;

        // If bookingDeposit not provided, default to ~20% of upfront cost
        let bookingDeposit = Number(req.body.bookingDeposit);
        if (!bookingDeposit || bookingDeposit <= 0) {
            const totalUpfront = rent + deposit + maintenanceFee;
            bookingDeposit = totalUpfront > 0 ? Math.round(totalUpfront * 0.2) : 0;
        }

        // Handle uploaded images
        const images = req.files ? req.files.map(file => file.filename) : [];

        const propertyData = {
            adminId: req.session.adminId,
            propertyname: req.body.propertyname,
            propertytype: req.body.propertytype,
            propertyaddress: req.body.propertyaddress,
            city: req.body.city,
            state: req.body.state,
            pincode: req.body.pincode,
            bedrooms: req.body.bedrooms,
            bathrooms: req.body.bathrooms,
            squareFeet: req.body.squareFeet,
            furnishing: req.body.furnishing || 'unfurnished',
            rent,
            bookingDeposit,
            deposit,
            maintenanceFee,
            rentDueDay: req.body.rentDueDay || 5,
            lateFeePerDay: req.body.lateFeePerDay || 100,
            status: req.body.status || 'available',
            parking: req.body.parking,
            amenities: req.body.amenities ? req.body.amenities.split(',').map(a => a.trim()) : [],
            description: req.body.description,
            images: images,
            isActive: true,
            isDeleted: false
        };

        const property = new Property(propertyData);
        await property.save();

        req.session.success = 'Property added successfully!';
        res.redirect('/admin/properties');
    } catch (err) {
        console.error('Add property error:', err);
        req.session.error = 'Failed to add property: ' + err.message;
        res.redirect('/admin/properties/add');
    }
};

// Show Add Tenant Form
exports.addTenantForm = async (req, res) => {
    try {
        const properties = await Property.find({ adminId: req.session.adminId, 
            status: 'available',
            isDeleted: false
        }).lean();

        res.render('admin-add-tenant', {
            layout: false,
            adminName: req.session.adminName,
            properties,
            error: req.session.error,
            success: req.session.success
        });
        delete req.session.error;
        delete req.session.success;
    } catch (err) {
        console.error('Add tenant form error:', err);
        res.status(500).send('Error loading form');
    }
};

// Add Tenant
exports.addTenant = async (req, res) => {
    try {
        const tenantData = {
            tenantid: req.body.tenantid,
            firstname: req.body.firstname,
            lastname: req.body.lastname,
            email: req.body.email,
            phone: req.body.phone,
            password: req.body.password, // Will be hashed by model pre-save hook
            dob: req.body.dob,
            occupation: req.body.occupation,
            idProofType: req.body.idProofType,
            idProofNumber: req.body.idProofNumber,
            propertyId: req.body.propertyId || null,
            leaseStartDate: req.body.leaseStartDate,
            leaseEndDate: req.body.leaseEndDate,
            emergencyContact: {
                name: req.body.emergencyContactName,
                phone: req.body.emergencyContactPhone
            },
            status: 'active',
            isActive: true,
            isDeleted: false
        };

        const tenant = new Tenant(tenantData);
        await tenant.save();

        // Update property status if assigned
        if (req.body.propertyId) {
            await Property.findOneAndUpdate({ _id: req.body.propertyId, adminId: req.session.adminId }, {
                status: 'occupied',
                tenantId: tenant._id
            });
        }

        req.session.success = 'Tenant added successfully!';
        res.redirect('/admin/tenants');
    } catch (err) {
        console.error('Add tenant error:', err);
        req.session.error = 'Failed to add tenant: ' + err.message;
        res.redirect('/admin/tenants/add');
    }
};

// Send Reminder to Tenant
exports.sendReminder = async (req, res) => {
    try {
        const tenantId = req.params.tenantId;
        const isSuperAdmin = String(req.session.adminRole || '').toLowerCase() === 'superadmin';
        const adminScope = isSuperAdmin ? {} : { adminId: req.session.adminId };
        const tenant = await Tenant.findOne({ _id: tenantId, ...adminScope })
            .populate('propertyId', 'propertyname rent')
            .lean();

        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        const propertyName = tenant.propertyId?.propertyname || 'your property';
        const rentAmount = Number(tenant.propertyId?.rent || 0);

        try {
            await Notification.create({
                userType: 'tenant',
                tenantId: tenant._id,
                title: 'Payment reminder',
                message: `A rent reminder was sent for ${propertyName}. Please review your outstanding balance of ${utils.currency.symbol}${rentAmount}.`,
                type: 'rent_reminder',
                metadata: { tenantId: String(tenant._id), propertyName, rentAmount }
            });
        } catch (notifyErr) {
            console.error('Failed to create reminder notification:', notifyErr.message || notifyErr);
        }

        try {
            if (tenant.email) {
                await notify.sendMail({
                    to: tenant.email,
                    subject: 'LeaseHub rent reminder',
                    text: `Hi ${tenant.firstname || 'Tenant'}, this is a reminder that rent for ${propertyName} is due soon. Please review your outstanding balance of ${utils.currency.symbol}${rentAmount}.`,
                    html: `<p>Hi ${tenant.firstname || 'Tenant'},</p><p>This is a friendly reminder that rent for <strong>${propertyName}</strong> is due soon.</p><p>Outstanding balance: <strong>${utils.currency.symbol}${rentAmount}</strong></p><p>Thank you for using LeaseHub.</p>`
                });
            }
        } catch (mailErr) {
            console.error('Failed to send reminder email:', mailErr.message || mailErr);
        }

        console.log(`Reminder sent to ${tenant.email} for property ${propertyName}`);

        res.json({
            success: true,
            message: `Reminder sent to ${tenant.firstname} ${tenant.lastname}`
        });
    } catch (err) {
        console.error('Send reminder error:', err);
        res.status(500).json({ error: 'Failed to send reminder' });
    }
};

// View Maintenance Requests
exports.maintenance = async (req, res) => {
    try {
        let tickets = await Ticket.find({ adminId: req.session.adminId, isDeleted: false })
            .populate('tenantId', 'firstname lastname email')
            .populate({
                path: 'tenantId',
                populate: {
                    path: 'propertyId',
                    select: 'propertyname'
                }
            })
            .sort({ createdAt: -1 })
            .lean();

        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        tickets.sort((a, b) => {
            const pa = priorityOrder[a.aiPriority || a.priority] ?? 4;
            const pb = priorityOrder[b.aiPriority || b.priority] ?? 4;
            if (pa !== pb) return pa - pb;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        // Calculate ticket counts
        const openCount = tickets.filter(t => t.status === 'open').length;
        const inProgressCount = tickets.filter(t => t.status === 'in-progress').length;
        const resolvedCount = tickets.filter(t => t.status === 'resolved').length;

        res.render('admin-maintenance', {
            tickets,
            openCount,
            inProgressCount,
            resolvedCount,
            totalCount: tickets.length,
            maintenanceSuccess: req.session.maintenanceSuccess,
            maintenanceError: req.session.maintenanceError
        });

        // Clear flash messages
        req.session.maintenanceSuccess = null;
        req.session.maintenanceError = null;
    } catch (err) {
        console.error('Maintenance fetch error:', err);
        res.render('admin-maintenance', {
            tickets: [],
            openCount: 0,
            inProgressCount: 0,
            resolvedCount: 0,
            totalCount: 0,
            maintenanceError: 'Failed to load maintenance requests'
        });
    }
};

// Update Maintenance Request Status
exports.updateMaintenanceStatus = async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { status } = req.body;

        if (!['open', 'in-progress', 'resolved'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const ticket = await Ticket.findOneAndUpdate({ _id: ticketId, adminId: req.session.adminId }, { status },
            { new: true }
        ).populate('tenantId', 'firstname lastname email');

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        // Notify tenant about ticket status update
        try {
            await Notification.create({
                userType: 'tenant',
                tenantId: ticket.tenantId?._id,
                title: 'Maintenance ticket updated',
                message: `Your maintenance request "${ticket.title}" is now ${status}.`,
                type: 'maintenance_status_updated',
                metadata: {
                    ticketId: ticket._id,
                    status
                }
            });
        } catch (notifyErr) {
            console.error('Failed to create tenant notification for ticket status:', notifyErr.message);
        }

        // If admin included an optional comment, save it and notify tenant
        const adminComment = req.body.comment || req.body.adminComment || null;
        if (adminComment && String(adminComment).trim().length > 0) {
            try {
                // Append comment to resolutionNotes for audit trail
                const noteEntry = `Admin ${req.session.adminName || req.session.adminId || 'admin'}: ${String(adminComment).trim()} -- ${new Date().toISOString()}\n`;
                await Ticket.updateOne({ _id: ticket._id }, { $set: { resolutionNotes: (ticket.resolutionNotes || '') + noteEntry } });

                await Notification.create({
                    userType: 'tenant',
                    tenantId: ticket.tenantId?._id,
                    title: 'Message from support',
                    message: String(adminComment).trim(),
                    type: 'ticket_admin_reply',
                    metadata: { ticketId: ticket._id }
                });
            } catch (cErr) {
                console.error('Failed to save admin comment or notify tenant:', cErr.message || cErr);
            }
        }

        try {
            if (ticket.tenantId?.email) {
                await notify.sendMail({
                    to: ticket.tenantId.email,
                    subject: `Maintenance request status updated: ${ticket.title}`,
                    text: `Your maintenance request "${ticket.title}" has been updated to ${status}.`,
                    html: `<p>Hi ${ticket.tenantId.firstname || 'Tenant'},</p>
                           <p>Your maintenance request titled <strong>${ticket.title}</strong> has been updated to <strong>${status}</strong>.</p>
                           <p>View your maintenance tickets at <a href="${process.env.APP_URL || 'http://localhost:3000'}/tenant/maintenance">Tenant Maintenance</a>.</p>`
                });
            }
        } catch (emailErr) {
            console.error('Failed to send tenant maintenance update email:', emailErr.message || emailErr);
        }

        console.log(`Ticket #${ticket._id} status updated to: ${status}`);
        console.log(`Tenant: ${ticket.tenantId?.firstname} ${ticket.tenantId?.lastname} (${ticket.tenantId?.email})`);

        req.session.maintenanceSuccess = `Ticket status updated to ${status}`;
        res.json({ 
            success: true, 
            message: `Ticket status updated to ${status}`,
            ticket 
        });
    } catch (err) {
        console.error('Update maintenance status error:', err);
        res.status(500).json({ error: 'Failed to update ticket status' });
    }
};

// View Applications
exports.applications = async (req, res) => {
    try {
        const filter = req.query.filter;
        const riskFilter = req.query.risk || '';
        const sort = req.query.sort || 'createdAt';
        const adminId = req.session.adminId;

        const query = { adminId, isDeleted: false };
        if (filter === 'pending') query.status = 'pending';
        if (filter === 'approved') query.status = 'approved';
        if (filter === 'rejected') query.status = 'rejected';
        if (riskFilter === 'low') query.aiRiskLevel = 'LOW';
        if (riskFilter === 'medium') query.aiRiskLevel = 'MEDIUM';
        if (riskFilter === 'high') query.aiRiskLevel = 'HIGH';

        const sortMap = {
            highestRisk: { aiRiskLevel: -1, aiConfidenceScore: -1 },
            lowestRisk: { aiRiskLevel: 1, aiConfidenceScore: -1 },
            highestConfidence: { aiConfidenceScore: -1, createdAt: -1 },
            lowestConfidence: { aiConfidenceScore: 1, createdAt: -1 },
            highestIncome: { monthlyIncome: -1, createdAt: -1 },
            createdAt: { createdAt: -1 }
        };

        const applications = await Application.find(query)
            .populate('propertyId')
            .populate('tenantId', 'firstname lastname email phone')
            .sort(sortMap[sort] || sortMap.createdAt)
            .lean();

        const counts = {
            total: await Application.countDocuments({ adminId, isDeleted: false }),
            pending: await Application.countDocuments({ adminId, status: 'pending', isDeleted: false }),
            approved: await Application.countDocuments({ adminId, status: 'approved', isDeleted: false }),
            rejected: await Application.countDocuments({ adminId, status: 'rejected', isDeleted: false }),
            low: await Application.countDocuments({ adminId, aiRiskLevel: 'LOW', isDeleted: false }),
            medium: await Application.countDocuments({ adminId, aiRiskLevel: 'MEDIUM', isDeleted: false }),
            high: await Application.countDocuments({ adminId, aiRiskLevel: 'HIGH', isDeleted: false })
        };
        
        const successMessage = req.session.applicationSuccess;
        const errorMessage = req.session.applicationError;
        delete req.session.applicationSuccess;
        delete req.session.applicationError;
        
        res.render('admin-applications', {
            layout: false,
            adminName: req.session.adminName,
            applications,
            counts,
            filter,
            riskFilter,
            sort,
            successMessage,
            errorMessage,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error('Applications error:', err);
        res.status(500).send('Error loading applications');
    }
};

// Approve/Reject Application
exports.applicationDecision = async (req, res) => {
    try {
        const applicationId = req.params.id;
        const decision = req.body.decision; // 'approve' or 'reject'
        const adminComments = req.body.adminComments;
        const adminId = req.session.adminId;
        
        const application = await Application.findOne({
            _id: applicationId,
            adminId: adminId
        })
            .populate('propertyId')
            .populate('tenantId');
        
        if (!application) {
            req.session.applicationError = 'Application not found or unauthorized access';
            return res.redirect('/admin/applications');
        }
        
        // Check if property data exists
        if (!application.propertyId) {
            req.session.applicationError = 'Property information is missing or has been deleted.';
            return res.redirect('/admin/applications');
        }
        
        if (application.status !== 'pending') {
            req.session.applicationError = 'This application has already been processed.';
            return res.redirect('/admin/applications');
        }
        
        if (decision === 'approve') {
            // APPROVAL ENGINE - create/associate tenant account, then issue booking deposit invoice

            // Check if tenant already exists with this email
            let tenant = await Tenant.findOne({ email: application.applicantEmail, isDeleted: false });

            if (!tenant) {
                // Create new tenant account automatically (without assigning property yet)
                const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('../../../../../utils/emailService');
const { validatePassword } = require('../../../../../utils/validation');

                const temporaryPassword = Math.random().toString(36).slice(-8); // Generate random password
                const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

                // Extract first and last name from applicantName
                const nameParts = application.applicantName.trim().split(' ');
                const firstname = nameParts[0];
                const lastname = nameParts.slice(1).join(' ') || firstname;

                // Generate unique tenant ID
                const tenantCount = await Tenant.countDocuments();
                const tenantid = `TEN${String(tenantCount + 1).padStart(5, '0')}`;

                tenant = new Tenant({ adminId: req.session.adminId,
                    tenantid,
                    firstname,
                    lastname,
                    email: application.applicantEmail,
                    phone: application.phone,
                    tenantpassword: hashedPassword,
                    occupation: application.occupation,
                    status: 'active',
                    isActive: true,
                    isDeleted: false
                });

                await tenant.save();

                console.log(`✅ Auto-created tenant account: ${tenant.email} | Tenant ID: ${tenantid} | Temporary Password: ${temporaryPassword}`);

                // In production, send email with credentials
                // await sendEmail(tenant.email, 'Welcome to LeaseHub', `Your account has been created. Tenant ID: ${tenantid}, Temp Password: ${temporaryPassword}`);
            } else {
                console.log(`✅ Using existing tenant account for approval: ${tenant.email}`);
            }

            // Ensure the tenant is explicitly linked to this property and approved application
            const tenantUpdates = {
                applicationId: application._id,
                propertyId: application.propertyId._id
            };

            if (!tenant.adminId) {
                tenantUpdates.adminId = req.session.adminId;
            }

            await Tenant.findByIdAndUpdate(tenant._id, tenantUpdates, { new: true });

            // Update property assignment immediately so the approved tenant is attached to the property
            await Property.findByIdAndUpdate(application.propertyId._id, {
                tenantId: tenant._id,
                status: 'reserved'
            });

            // Update application: mark as approved and set expiry for booking deposit
            const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours from now
            application.status = 'approved';
            application.tenantId = tenant._id;
            application.adminComments = adminComments || 'Your application has been approved! Please pay the booking deposit within 48 hours to reserve the property.';
            application.approvedBy = req.session.adminId;
            application.approvedAt = new Date();
            application.expiresAt = expiresAt;
            await application.save();

            // Generate booking deposit invoice
            const now = new Date();
            const dueDate = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 hours from now
            const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

            // Ensure booking deposit is at least 20% of monthly rent
            const monthlyRent = Number(application.propertyId.rent) || 0;
            let bookingDeposit = Number(application.propertyId.bookingDeposit);
            if (!bookingDeposit || bookingDeposit <= 0) {
                bookingDeposit = Math.round(monthlyRent * 0.2);
            }

            const invoice = new Invoice({ adminId: req.session.adminId,
                type: 'booking_deposit',
                tenantId: tenant._id,
                propertyId: application.propertyId._id,
                month,
                rentAmount: bookingDeposit,
                maintenanceCharges: 0,
                waterCharges: 0,
                electricityCharges: 0,
                otherCharges: 0,
                totalAmount: bookingDeposit,
                dueDate,
                status: 'unpaid',
                paidAmount: 0,
                isDeleted: false
            });

            await invoice.save();

            console.log(`✅ Generated booking deposit invoice: ${invoice._id} | Amount: ₹${invoice.totalAmount}`);

            // Notify tenant about approval and booking deposit requirement
            try {
                await Notification.create({
                    userType: 'tenant',
                    tenantId: tenant._id,
                    title: 'Application approved - Booking deposit required',
                    message: `Your application for ${application.propertyId.propertyname} has been approved. Pay the booking deposit of ₹${bookingDeposit} within 48 hours to reserve the property.`,
                    type: 'booking_deposit_required',
                    metadata: {
                        applicationId: application._id,
                        propertyId: application.propertyId._id,
                        invoiceId: invoice._id,
                        expiresAt
                    }
                });
            } catch (notifyErr) {
                console.error('Failed to create tenant notification for booking deposit:', notifyErr.message);
            }

            try {
                await notify.sendMail({
                    to: tenant.email,
                    subject: `Application approved for ${application.propertyId.propertyname}`,
                    text: `Your application has been approved. Please pay the booking deposit of ₹${bookingDeposit} within 48 hours to reserve the property.`,
                    html: `<p>Hi ${tenant.firstname || 'Tenant'},</p>
                           <p>Your rental application for <strong>${application.propertyId.propertyname}</strong> has been approved.</p>
                           <p>Please pay the booking deposit of <strong>₹${bookingDeposit}</strong> within 48 hours to reserve the property.</p>
                           <p>You can view the application status at <a href="${process.env.APP_URL || 'http://localhost:3000'}/tenant/applications">My Applications</a>.</p>`
                });
            } catch (emailErr) {
                console.error('Failed to send tenant approval email:', emailErr.message || emailErr);
            }
            
            // Auto-reject all other PENDING applications for the same tenant
            // Status: 'rejected', Reason: 'Tenant already approved for another property'
            const otherApps = await Application.updateMany(
                {
                    $or: [
                        { applicantEmail: application.applicantEmail },
                        { applicantId: application.applicantId }
                    ],
                    _id: { $nin: [application._id] },
                    status: 'pending',
                    isDeleted: false
                },
                {
                    status: 'rejected',
                    adminComments: 'Tenant already approved for another property'
                }
            );

            if (otherApps.modifiedCount > 0) {
                console.log(`✅ Auto-rejected ${otherApps.modifiedCount} other pending application(s) by this tenant`);
            }
            
            req.session.applicationSuccess = `Application approved successfully! Tenant account created and property assigned. First invoice generated. ${otherApps.modifiedCount > 0 ? `(${otherApps.modifiedCount} other pending application(s) by this tenant were auto-rejected)` : ''}`;
            
        } else if (decision === 'reject') {
            // Reject application
            application.status = 'rejected';
            application.adminComments = adminComments || 'Application did not meet requirements';
            application.reviewedBy = req.session.adminId;
            application.reviewedAt = new Date();
            await application.save();

            try {
                await Notification.create({
                    userType: 'tenant',
                    tenantId: application.tenantId || undefined,
                    title: 'Application rejected',
                    message: `Your application for ${application.propertyId.propertyname} has been rejected.`,
                    type: 'application_rejected',
                    metadata: {
                        applicationId: application._id,
                        propertyId: application.propertyId._id
                    }
                });
            } catch (notifyErr) {
                console.error('Failed to create tenant notification for rejection:', notifyErr.message);
            }

            try {
                await notify.sendMail({
                    to: application.applicantEmail,
                    subject: `Your application for ${application.propertyId.propertyname} was rejected`,
                    text: `We’re sorry. Your application for ${application.propertyId.propertyname} has been rejected.`,
                    html: `<p>Hi ${application.applicantName || 'Applicant'},</p>
                           <p>We’re sorry to inform you that your application for <strong>${application.propertyId.propertyname}</strong> has been rejected.</p>
                           <p>Reason: ${application.adminComments}</p>
                           <p>If you have questions, please contact the admin team.</p>`
                });
            } catch (emailErr) {
                console.error('Failed to send tenant rejection email:', emailErr.message || emailErr);
            }
            
            console.log(`❌ Application REJECTED. Reason: ${application.adminComments}`);
            req.session.applicationSuccess = 'Application rejected successfully!';
        }
        
        res.redirect('/admin/applications');
    } catch (err) {
        console.error('Application decision error:', err);
        console.error('Error details:', err.message);
        console.error('Error stack:', err.stack);
        req.session.applicationError = `Error: ${err.message}`;
        res.redirect('/admin/applications');
    }
};

// Admin-initiated cancellation of an application/reservation
exports.applicationCancel = async (req, res) => {
    try {
        const applicationId = req.params.id;
        const reason = req.body.reason;

        const application = await Application.findById(applicationId)
            .populate('propertyId')
            .populate('tenantId');

        if (!application) {
            req.session.applicationError = 'Application not found';
            return res.redirect('/admin/applications');
        }

        const property = application.propertyId;

        // Do not allow cancellation after occupancy is marked
        if (property && property.status === 'occupied') {
            req.session.applicationError = 'Cannot cancel an application after the tenant has moved in.';
            return res.redirect('/admin/applications');
        }

        if (application.status === 'cancelled') {
            req.session.applicationSuccess = 'Application is already cancelled.';
            return res.redirect('/admin/applications');
        }

        const beforeStatus = application.status;
        const propertyBeforeStatus = property ? property.status : undefined;

        application.status = 'cancelled';
        application.adminComments = reason || 'Cancelled by admin';
        application.reviewedBy = req.session.adminId;
        application.reviewedAt = new Date();
        await application.save();

        if (property) {
            property.status = 'available';
            if (property.tenantId && application.tenantId && String(property.tenantId) === String(application.tenantId._id)) {
                property.tenantId = null;
            }
            await property.save();
        }

        // Find tenant for notification: prefer linked tenant, fall back to email lookup
        let tenant = application.tenantId;
        if (!tenant && application.applicantEmail) {
            tenant = await Tenant.findOne({ adminId: req.session.adminId, email: application.applicantEmail.toLowerCase(), isDeleted: false });
        }

        if (tenant) {
            try {
                await Notification.create({
                    userType: 'tenant',
                    tenantId: tenant._id,
                    title: 'Application cancelled',
                    message: `Your application for ${application.propertyId?.propertyname || 'this property'} was cancelled by the admin.`,
                    type: 'application_cancelled',
                    metadata: {
                        applicationId: application._id,
                        propertyId: application.propertyId
                    }
                });
            } catch (notifyErr) {
                console.error('Failed to create tenant notification for cancellation:', notifyErr.message);
            }
        }

        try {
            const recipientEmail = tenant?.email || application.applicantEmail;
            const applicantName = tenant?.firstname || application.applicantName || 'Applicant';
            if (recipientEmail) {
                await notify.sendMail({
                    to: recipientEmail,
                    subject: `Your application has been cancelled`,
                    text: `Your application for ${application.propertyId?.propertyname || 'the property'} has been cancelled by the admin.`,
                    html: `<p>Hi ${applicantName},</p>
                           <p>Your application for <strong>${application.propertyId?.propertyname || 'the property'}</strong> has been cancelled by the admin.</p>
                           <p>Reason: ${reason || 'Cancelled by admin'}</p>
                           <p>If you have questions, please contact the administrator.</p>`
                });
            }
        } catch (emailErr) {
            console.error('Failed to send application cancellation email:', emailErr.message || emailErr);
        }

        await createAuditLog({
            req,
            userId: req.session.adminId,
            userType: 'admin',
            action: 'cancel_application',
            entity: 'Application',
            entityId: application._id,
            changes: {
                status: { before: beforeStatus, after: 'cancelled' },
                ...(property ? { propertyStatus: { before: propertyBeforeStatus, after: property.status } } : {})
            }
        });

        req.session.applicationSuccess = 'Application cancelled successfully.';
        res.redirect('/admin/applications');
    } catch (err) {
        console.error('Application cancel error:', err);
        req.session.applicationError = 'Error cancelling application: ' + err.message;
        res.redirect('/admin/applications');
    }
};

exports.notificationsCount = async (req, res) => {
    try {
        const count = await Notification.countDocuments({ adminId: req.session.adminId, userType: 'admin', isRead: false, isDeleted: { $ne: true } });
        res.json({ count });
    } catch (err) {
        res.status(500).json({ error: 'Unable to read notifications' });
    }
};

exports.markNotificationRead = async (req, res) => {
    console.log('[NOTIF] markNotificationRead', req.originalUrl, 'sessionID:', req.sessionID, 'adminId:', req.session && req.session.adminId);
    try {
        await Notification.updateOne({ _id: req.params.id, adminId: req.session.adminId, userType: 'admin' }, { $set: { isRead: true, readAt: new Date() } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
};

exports.markAllNotificationsRead = async (req, res) => {
    console.log('[NOTIF] markAllNotificationsRead', req.originalUrl, 'sessionID:', req.sessionID, 'adminId:', req.session && req.session.adminId);
    try {
        await Notification.updateMany({ adminId: req.session.adminId, userType: 'admin', isRead: false }, { $set: { isRead: true, readAt: new Date() } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to mark notifications as read' });
    }
};

exports.supportCenter = async (req, res) => {
    try {
        const notifications = await Notification.find({ adminId: req.session.adminId, userType: 'admin', isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(6).lean();
        res.render('admin-support', { adminName: req.session.adminName, notifications, adminId: req.session.adminId, timestamp: Date.now(), cspNonce: res.locals.cspNonce });
    } catch (err) {
        res.status(500).send('Error loading support center');
    }
};

// Admin Notifications page
exports.notifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ adminId: req.session.adminId, userType: 'admin', isDeleted: { $ne: true } })
            .sort({ createdAt: -1 })
            .lean();

        const unreadCount = notifications.filter(n => !n.isRead).length;
        res.render('admin-notifications', {
            adminName: req.session.adminName,
            notifications,
            unreadCount
        });
    } catch (err) {
        console.error('Admin notifications error:', err);
        res.status(500).send('Error loading notifications');
    }
};

// Recent notifications JSON for admin dropdown
exports.notificationsRecent = async (req, res) => {
    try {
        let notifications = await Notification.find({ adminId: req.session.adminId, userType: 'admin', isDeleted: { $ne: true } })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        // Ensure metadata.url exists for dropdown links (fallback heuristics)
        const computeUrl = (n) => {
            const meta = n.metadata || {};
            if (meta.url) return meta.url;
            try {
                if (n.type === 'invoice_due' || meta.invoiceId) return '/admin/invoices';
                if (n.type === 'payment_processed' || meta.paymentId) return '/admin/payments';
                if (meta.ticketId) return `/admin/maintenance#ticket-${meta.ticketId}`;
            } catch (e) {}
            return undefined;
        };
        notifications = notifications.map(n => ({ ...n, metadata: Object.assign({}, n.metadata || {}, { url: (n.metadata && n.metadata.url) || computeUrl(n) }) }));
        res.json({ success: true, notifications });
    } catch (err) {
        console.error('admin notificationsRecent error:', err);
        res.status(500).json({ success: false, message: 'Failed to load notifications' });
    }
};

exports.deleteNotification = async (req, res) => {
    console.log('[NOTIF] deleteNotification', req.originalUrl, 'sessionID:', req.sessionID, 'adminId:', req.session && req.session.adminId, 'notifId:', req.params.id);
    try {
        const id = req.params.id;
        await Notification.updateOne({ _id: id, adminId: req.session.adminId, userType: 'admin' }, { $set: { isDeleted: true } });
        res.json({ success: true });
    } catch (err) {
        console.error('deleteNotification', err);
        res.status(500).json({ success: false });
    }
};

// --- Admin Support Ticket APIs ---
exports.listSupportTickets = async (req, res) => {
    try {
        const adminId = req.session.adminId;
        // admins may want to filter by status; support basic query
        const q = {};
        if (req.query.status) q.status = req.query.status;
        console.log('[SUPPORT] listSupportTickets hit', { adminId, query: q });
        const tickets = await SupportTicket.find(q).sort({ createdAt: -1 }).limit(100).lean();
        console.log('[SUPPORT] listSupportTickets result', { returned: tickets.length, sample: tickets.slice(0,3) });
        res.json({ success: true, tickets });
    } catch (err) { console.error('listSupportTickets', err); res.status(500).json({ success: false }); }
};

exports.viewSupportTicket = async (req, res) => {
    try {
        const id = req.params.id;
        const ticket = await SupportTicket.findById(id).lean();
        if (!ticket) return res.status(404).json({ success: false });
        res.json({ success: true, ticket });
    } catch (err) { console.error('viewSupportTicket', err); res.status(500).json({ success: false }); }
};

exports.replySupportTicketAdmin = async (req, res) => {
    try {
        const adminId = req.session.adminId;
        const id = req.params.id;
        const { message, close } = req.body;
        if (!message) return res.status(400).json({ success: false });
        const ticket = await SupportTicket.findById(id);
        if (!ticket) return res.status(404).json({ success: false });
        ticket.replies = ticket.replies || [];
        ticket.replies.push({ authorType: 'admin', authorId: adminId, message });
        ticket.status = close ? 'closed' : 'waiting_tenant';
        ticket.lastAdminId = adminId;
        await ticket.save();
        try { await Notification.create({ userType: 'tenant', tenantId: ticket.tenantId, title: 'Support ticket updated', message: `Admin replied to: ${ticket.subject}`, type: 'support_ticket_admin_replied', metadata: { ticketId: ticket._id } }); } catch(e){ console.error('notify tenant failed', e); }
        try { emitter.emit('support:ticket:admin-replied', { ticketId: ticket._id, tenantId: ticket.tenantId, message }); } catch(e){}
        res.json({ success: true });
    } catch (err) { console.error('replySupportTicketAdmin', err); res.status(500).json({ success: false }); }
};

// Re-run AI Analysis on an application
exports.rerunAiAnalysis = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);
        if (!application) {
            req.session.applicationError = 'Application not found.';
            return res.redirect('/admin/applications');
        }

        const property = await Property.findById(application.propertyId);
        if (!property) {
            req.session.applicationError = 'Could not find property for this application.';
            return res.redirect('/admin/applications');
        }

        let tenant = null;
        if (application.tenantId) {
            tenant = await Tenant.findById(application.tenantId);
        } else if (application.applicantEmail) {
            tenant = await Tenant.findOne({ email: application.applicantEmail.toLowerCase(), isDeleted: false });
        }

        console.log('[AI-RERUN] Application Loaded', { applicationId: application._id, applicantEmail: application.applicantEmail || null });
        console.log('[AI-RERUN] Property Loaded', { propertyId: property._id, rent: property.rent || null });
        if (tenant) {
            console.log('[AI-RERUN] Tenant Loaded', { tenantId: tenant._id, email: tenant.email || null });
        } else {
            console.log('[AI-RERUN] Tenant Missing - Using Application Data');
        }

        // Reset AI fields to PENDING while reprocessing
        application.aiRiskLevel = 'PENDING';
        application.aiRecommendation = 'PENDING';
        application.aiConfidenceScore = 0;
        application.aiExplanation = 'AI re-analysis in progress...';
        application.aiGeneratedAt = null;
        await application.save();

        // Import and invoke tenant service's AI scoring method
        const tenantService = require('../../../../tenant-app/src/modules/tenant/tenant.service');
        tenantService.startBackgroundAiScoring(application, property, tenant);

        req.session.applicationSuccess = 'AI analysis re-triggered. Refresh in a few seconds to see updated results.';
        res.redirect('/admin/applications');
    } catch (err) {
        console.error('Rerun AI analysis error:', err);
        req.session.applicationError = 'Error re-running AI analysis: ' + err.message;
        res.redirect('/admin/applications');
    }
};
