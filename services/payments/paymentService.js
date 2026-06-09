const mongoose = require('mongoose');
const { Invoice, Payment, Tenant, Application, Property, LedgerEntry, Lease, Notification } = require('../../shared/models');
const logger = require('../../utils/logger');
const { createAuditLog } = require('../auditService.js');

class PaymentService {
    /**
     * Process Stripe Webhook Payment Success with Transactions & Idempotency
     * @param {Object} session - Stripe checkout session object
     * @param {Object} metadata - Metadata passed during checkout
     * @param {Object} req - Express request object (for audit logs)
     * @param {Object} io - Socket.io instance
     */
    async processPaymentSuccess(session, metadata, req, io) {
        const { invoiceId, tenantId, purpose } = metadata;
        const amountPaid = session.amount_total / 100;

        // Idempotency check (no session needed for read)
        const existingPayment = await Payment.findOne({
            invoiceId,
            tenantId,
            amountPaid,
            status: 'approved'
        });

        if (existingPayment) {
            logger.warn(`[PaymentService] Payment already processed for invoice ${invoiceId}`);
            return { success: true, message: 'Already processed' };
        }

        const dbSession = await mongoose.startSession();
        dbSession.startTransaction();

        try {
            // 1. Fetch Invoice
            const invoice = await Invoice.findById(invoiceId).populate('propertyId').session(dbSession);
            if (!invoice) throw new Error('Invoice not found');

            // 2. Update Invoice
            invoice.status = 'paid';
            invoice.paidAmount = invoice.totalAmount;
            invoice.paidAt = new Date();
            invoice.balance = 0;
            await invoice.save({ session: dbSession });

            // 3. Create Payment Record
            const payment = new Payment({
                tenantId: invoice.tenantId,
                propertyId: invoice.propertyId?._id,
                invoiceId: invoice._id,
                amountPaid,
                paymentMethod: 'stripe',
                stripePaymentIntentId: session.payment_intent || session.id,
                stripeSessionId: session.id, // additional idempotency safety
                status: 'approved',
                notes: purpose === 'booking_deposit' ? 'Booking deposit via Stripe' : 'Rent payment via Stripe'
            });
            await payment.save({ session: dbSession });

            // 4. Create Ledger Entry
            const description = invoice.type === 'booking_deposit'
                ? `Booking deposit received for ${invoice.propertyId?.propertyname || ''}`
                : `Rent payment received for ${invoice.month}`;

            const ledgerEntry = new LedgerEntry({
                tenantId: invoice.tenantId,
                type: 'credit',
                amount: amountPaid,
                description,
                referenceType: 'invoice',
                referenceId: invoice._id
            });
            await ledgerEntry.save({ session: dbSession });

            logger.info(`[PaymentService] Payment processed. Invoice: ${invoiceId}, Amount: $${amountPaid}`);

            // 5. Booking Deposit specific logic
            if (invoice.type === 'booking_deposit') {
                const propertyId = invoice.propertyId?._id || invoice.propertyId;
                const property = invoice.propertyId && typeof invoice.propertyId === 'object' ? invoice.propertyId : 
                                 await Property.findById(propertyId).session(dbSession);

                const application = await Application.findOne({
                    tenantId: invoice.tenantId,
                    propertyId: propertyId,
                    status: 'approved',
                    isDeleted: false
                }).session(dbSession);

                if (application) {
                    application.status = 'lease_active';
                    await application.save({ session: dbSession });
                }

                // CREATE LEASE RECORD - Automatic lease creation after booking deposit paid
                if (propertyId && property && application) {
                    // Duplicate prevention: check if lease already exists
                    const existingLease = await Lease.findOne({
                        tenantId: invoice.tenantId,
                        propertyId: propertyId,
                        status: 'active',
                        isDeleted: false
                    }).session(dbSession);

                    if (!existingLease) {
                        // Calculate lease dates (from application or default 12 months)
                        const startDate = new Date(); // Today
                        const endDate = new Date();
                        endDate.setFullYear(endDate.getFullYear() + 1); // 12 months lease

                        // Get adminId from property
                        const adminId = property.adminId;
                        const monthlyRent = Number(property.rent) || 0;
                        const securityDeposit = Number(property.bookingDeposit) || 0;

                        console.log('[LEASE] Creating lease...');
                        const lease = new Lease({
                            tenantId: invoice.tenantId,
                            propertyId: propertyId,
                            adminId: adminId,
                            startDate,
                            endDate,
                            monthlyRent,
                            securityDeposit,
                            status: 'active'
                        });

                        await lease.save({ session: dbSession });
                        console.log('[LEASE] Lease created:', lease._id);
                        logger.info(`[PaymentService] ✅ Created Lease ${lease._id} for tenant ${invoice.tenantId} | Property: ${propertyId}`);
                    } else {
                        logger.warn(`[PaymentService] Lease already exists for tenant ${invoice.tenantId} / property ${propertyId}`);
                    }
                }

                // APPLICATION CLEANUP (Issue 3)
                if (application) {
                    await Application.updateMany(
                        {
                            tenantId: invoice.tenantId,
                            _id: { $nin: [application._id] },
                            status: { $in: ['pending', 'approved', 'reserved'] },
                            isDeleted: false
                        },
                        {
                            $set: { status: 'rejected_auto' }
                        },
                        { session: dbSession }
                    );
                }

                // Update property status to 'leased'
                if (propertyId) {
                    await Property.findByIdAndUpdate(
                        propertyId,
                        { status: 'leased', tenantId: invoice.tenantId },
                        { session: dbSession }
                    );
                }

                await Tenant.findByIdAndUpdate(
                    invoice.tenantId,
                    {
                        propertyId,
                        ...(application ? { applicationId: application._id } : {})
                    },
                    { session: dbSession }
                );

                // Create first monthly rent invoice
                const existingMonthly = await Invoice.findOne({
                    tenantId: invoice.tenantId,
                    propertyId,
                    type: 'monthly_rent',
                    status: { $in: ['unpaid', 'partial', 'overdue'] },
                    isDeleted: false
                }).session(dbSession);

                if (!existingMonthly && invoice.propertyId && typeof invoice.propertyId.rent === 'number') {
                    const now = new Date();
                    const due = new Date(now);
                    const rentDay = 5;
                    if (now.getDate() > rentDay) {
                        due.setMonth(due.getMonth() + 1);
                    }
                    due.setDate(rentDay);

                    const monthStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`;
                    const rentAmount = Number(invoice.propertyId.rent) || 0;
                    const maintenanceCharges = Number(invoice.propertyId.maintenanceFee || 0);
                    const totalAmount = rentAmount + maintenanceCharges;

                    const rentInvoice = new Invoice({
                        type: 'monthly_rent',
                        tenantId: invoice.tenantId,
                        propertyId,
                        month: monthStr,
                        rentAmount,
                        maintenanceCharges,
                        waterCharges: 0,
                        electricityCharges: 0,
                        otherCharges: 0,
                        totalAmount,
                        dueDate: due,
                        status: 'unpaid',
                        paidAmount: 0,
                        balance: totalAmount,
                        isDeleted: false
                    });
                    await rentInvoice.save({ session: dbSession });
                    logger.info(`[PaymentService] Created first monthly rent invoice for tenant ${invoice.tenantId}`);
                }
            }

            // Commit Transaction
            await dbSession.commitTransaction();
            logger.info(`[PaymentService] Transaction committed successfully for invoice ${invoiceId}`);

            // Side-effects (Post-Transaction)
            if (io) {
                io.to(`tenant:${invoice.tenantId}`).emit('paymentConfirmed', {
                    invoiceId: invoiceId,
                    amount: amountPaid,
                    status: 'paid',
                    type: invoice.type
                });
            }

            // Create notifications for tenant and admin
            try {
                await Notification.create({ userType: 'tenant', tenantId: invoice.tenantId, title: 'Payment received', message: `Payment of ${amountPaid} received for invoice ${invoice._id}`, type: 'payment_received', metadata: { invoiceId: invoice._id } });
            } catch (nErr) { console.error('Failed to create tenant payment notification', nErr); }

            try {
                await Notification.create({ userType: 'admin', adminId: invoice.propertyId?.adminId || null, title: 'Payment processed', message: `Payment received for invoice ${invoice._id}: ${amountPaid}`, type: 'payment_processed', metadata: { invoiceId: invoice._id, tenantId: invoice.tenantId } });
            } catch (nErr) { console.error('Failed to create admin payment notification', nErr); }

            // Audit Logs (Best-effort, post-transaction)
            if (invoice.type === 'booking_deposit') {
                this.triggerBestEffortAuditLogs(req, invoice, amountPaid).catch(err => {
                    logger.error(`[PaymentService] Audit logs failed: ${err.message}`);
                });
            }

            return { success: true };
        } catch (error) {
            await dbSession.abortTransaction();
            logger.error(`[PaymentService] Transaction failed: ${error.message}`);
            throw error;
        } finally {
            dbSession.endSession();
        }
    }

    async triggerBestEffortAuditLogs(req, invoice, amountPaid) {
        // Find application again outside session just for audit log
        const application = await Application.findOne({
            tenantId: invoice.tenantId,
            propertyId: invoice.propertyId?._id || invoice.propertyId,
            status: 'reserved'
        });

        if (application) {
            await createAuditLog({
                req,
                userId: invoice.tenantId,
                userType: 'system',
                action: 'system_reserve_application_after_deposit',
                entity: 'Application',
                entityId: application._id,
                changes: {
                    status: { before: 'approved', after: 'reserved' },
                },
            });
        }
        
        await createAuditLog({
            req,
            userId: invoice.tenantId,
            userType: 'system',
            action: 'system_assign_property_after_deposit',
            entity: 'Property',
            entityId: invoice.propertyId?._id || invoice.propertyId,
            changes: {
                status: { before: 'available', after: 'reserved' },
                tenantId: { before: null, after: invoice.tenantId },
            },
        });
    }
}

module.exports = new PaymentService();
