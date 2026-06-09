/**
 * Billing Job Processors
 * 
 * Handles: Monthly rent generation, late fee application,
 * payment reminders, and application auto-cancellation.
 * 
 * These processors are registered with queueService and run either
 * via BullMQ (Redis) or inline (fallback).
 */
const { Tenant, Invoice, Application, Property, Notification } = require('../../shared/models');
const logger = require('../../utils/logger');

function sanitizeDateFilter(obj, keys = []) {
    if (!obj || typeof obj !== 'object') return obj;
    const copy = { ...obj };
    for (const key of keys) {
        if (!copy[key]) continue;
        const v = copy[key];
        if (v && typeof v === 'object') {
            // Convert common operators to Date if they're not already
            [' $lt', '$lte', '$gt', '$gte'].forEach((op) => {}); // noop to keep consistent spacing in patch
            [' $lt','$lt','$lte','$gt','$gte'].forEach((op) => {
                const opKey = op.trim();
                if (v[opKey] && !(v[opKey] instanceof Date)) {
                    try {
                        copy[key] = { ...copy[key], [opKey]: new Date(v[opKey]) };
                    } catch (e) {
                        // leave as-is; we'll log later
                    }
                }
            });
        } else if (v && !(v instanceof Date)) {
            try { copy[key] = new Date(v); } catch (e) {}
        }
    }
    return copy;
}

/**
 * Generate monthly rent invoices for all active tenants
 */
async function processMonthlyRent(job) {
    logger.info('[BillingJob] Running monthly rent generation...');
    const now = new Date();
    const currentMonthString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // const activeTenants = await Tenant.find({
    //     status: 'active',
    //     isDeleted: false
    // }).populate('propertyId');

    // Pass adminId from job data, or process all admins separately
    const query = { status: 'active', isDeleted: false };
    if (job?.data?.adminId) query.adminId = job.data.adminId;
    const activeTenants = await Tenant.find(query).populate('propertyId');

    let generated = 0;

    for (const tenant of activeTenants) {
        if (!tenant.propertyId) continue;

        const dueDay = tenant.propertyId.rentDueDay || 5;
        const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);

        // Idempotency: skip if invoice already exists
        const existingInvoice = await Invoice.findOne({
            tenantId: tenant._id,
            type: 'monthly_rent',
            month: currentMonthString
        });

        if (!existingInvoice) {
            const rentAmount = Number(tenant.propertyId.rent) || 0;
            const maintenanceCharges = Number(tenant.propertyId.maintenanceFee || 0);
            const totalAmount = rentAmount + maintenanceCharges;

            const newInvoice = new Invoice({
                adminId: tenant.adminId,
                type: 'monthly_rent',
                tenantId: tenant._id,
                propertyId: tenant.propertyId._id,
                month: currentMonthString,
                rentAmount,
                maintenanceCharges,
                totalAmount,
                dueDate,
                status: 'unpaid',
                balance: totalAmount
            });
            await newInvoice.save();
            generated++;
            logger.info(`[BillingJob] Generated rent invoice for tenant ${tenant._id} (${currentMonthString})`);
        }
    }

    logger.info(`[BillingJob] Monthly rent generation complete. ${generated} invoice(s) created.`);
    return { generated };
}

/**
 * Apply late fees to overdue invoices
 */
async function processLateFees(job) {
    logger.info('[BillingJob] Running late fee check...');
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // const overdueInvoices = await Invoice.find({
    //     status: { $in: ['unpaid', 'partial'] },
    //     isDeleted: false,
    //     dueDate: { $lt: startOfToday }
    // }).populate('propertyId');
    
    const overdueQuery = {
    status: { $in: ['unpaid', 'partial'] },
    isDeleted: false,
    dueDate: { $lt: startOfToday }
    };
    if (job?.data?.adminId) overdueQuery.adminId = job.data.adminId;
    const overdueInvoices = await Invoice.find(overdueQuery).populate('propertyId');

    let applied = 0;

    for (const invoice of overdueInvoices) {
        const gracePeriodDays = invoice.propertyId?.lateFeeGracePeriod || 5;
        const gracePeriodDate = new Date(invoice.dueDate);
        gracePeriodDate.setDate(gracePeriodDate.getDate() + gracePeriodDays);

        if (startOfToday > gracePeriodDate) {
            // One-time late fee
            if (invoice.lateFeesAccrued === 0) {
                const lateFee = invoice.propertyId?.lateFeeAmount || (invoice.rentAmount * 0.05);

                const lateFeeInvoice = new Invoice({
                    adminId: invoice.adminId,
                    type: 'late_fee',
                    tenantId: invoice.tenantId,
                    propertyId: invoice.propertyId._id,
                    month: invoice.month,
                    rentAmount: 0,
                    totalAmount: lateFee,
                    dueDate: startOfToday,
                    status: 'unpaid',
                    balance: lateFee
                });
                await lateFeeInvoice.save();

                invoice.lateFeesAccrued = lateFee;
                invoice.status = 'overdue';
                await invoice.save();
                applied++;
                logger.info(`[BillingJob] Applied $${lateFee} late fee to invoice ${invoice._id}`);
            }
        } else if (invoice.status !== 'overdue') {
            invoice.status = 'overdue';
            await invoice.save();
        }
    }

    logger.info(`[BillingJob] Late fee check complete. ${applied} fee(s) applied.`);
    return { applied };
}

/**
 * Send payment reminders for invoices due in 2 days
 */
async function processPaymentReminders(job) {
    logger.info('[BillingJob] Running payment reminders...');
    const now = new Date();
    const twoDaysFromNow = new Date(now);
    twoDaysFromNow.setDate(now.getDate() + 2);

    const startOfTarget = new Date(twoDaysFromNow.getFullYear(), twoDaysFromNow.getMonth(), twoDaysFromNow.getDate());
    const endOfTarget = new Date(startOfTarget);
    endOfTarget.setDate(endOfTarget.getDate() + 1);

    let dueSoonInvoices;
    try {
        const filter = sanitizeDateFilter({
            status: 'unpaid',
            isDeleted: false,
            dueDate: { $gte: startOfTarget, $lt: endOfTarget }
        }, ['dueDate']);
        dueSoonInvoices = await Invoice.find(filter).populate('tenantId').populate('propertyId');
    } catch (err) {
        logger.error('[BillingJob] Failed to fetch due-soon invoices - filter shape:', { filter: { status: 'unpaid', isDeleted: false, dueDate: { $gte: startOfTarget, $lt: endOfTarget } }, err: err.message });
        throw err;
    }

    let reminded = 0;

    for (const invoice of dueSoonInvoices) {
        if (invoice.lastReminderType !== 'due_in_2_days') {
            // Create in-app notification
            try {
                await Notification.create({
                    userType: 'tenant',
                    userId: invoice.tenantId?._id,
                    title: 'Payment Reminder',
                    message: `Your rent payment of $${invoice.totalAmount} is due in 2 days.`,
                    type: 'payment_reminder',
                    metadata: { invoiceId: invoice._id }
                });
            } catch (err) {
                logger.warn(`[BillingJob] Failed to create reminder notification: ${err.message}`);
            }

            invoice.lastReminderType = 'due_in_2_days';
            invoice.lastReminderAt = new Date();
            await invoice.save();
            reminded++;
            logger.info(`[BillingJob] Reminder sent for invoice ${invoice._id} (tenant: ${invoice.tenantId?.email})`);
        }
    }

    logger.info(`[BillingJob] Payment reminders complete. ${reminded} reminder(s) sent.`);
    return { reminded };
}

/**
 * Auto-cancel expired approved applications
 */
async function processExpiredApplications(job) {
    logger.info('[BillingJob] Running expired application check...');
    const now = new Date();

    let expiredApps;
    try {
        const appFilter = sanitizeDateFilter({ status: 'approved', expiresAt: { $lt: now }, isDeleted: false }, ['expiresAt']);
        expiredApps = await Application.find(appFilter);
    } catch (err) {
        logger.error('[BillingJob] Failed to fetch expired applications - filter shape:', { filter: { status: 'approved', expiresAt: { $lt: now }, isDeleted: false }, err: err.message });
        throw err;
    }

    let cancelled = 0;

    for (const app of expiredApps) {
        app.status = 'expired';
        await app.save();

        if (app.propertyId) {
            await Property.findByIdAndUpdate(app.propertyId, { status: 'available' });
        }

        cancelled++;
        logger.info(`[BillingJob] Auto-cancelled expired application ${app._id}`);
    }

    logger.info(`[BillingJob] Expired application check complete. ${cancelled} application(s) cancelled.`);
    return { cancelled };
}

module.exports = {
    processMonthlyRent,
    processLateFees,
    processPaymentReminders,
    processExpiredApplications,
};
