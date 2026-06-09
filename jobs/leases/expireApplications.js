// jobs/expireApplications.js
// Auto-expire lease applications when payment or move-in deadlines are missed.
// Run this script every 30 minutes using a scheduler (cron, worker dyno, etc.).

const mongoose = require('mongoose');
require('dotenv').config();

const { Application, Property, Tenant, Payment, Invoice } = require('../../shared/models');
const { createAuditLog } = require('../../services/auditService');
const { sendMail } = require('../../utils/notify');

async function connectDb() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is not defined');
  }

  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

async function hasSuccessfulPayment(application) {
  // "Successful payment" is deliberately strict:
  // 1) A PAID booking_deposit invoice for this tenant + property, OR
  // 2) An APPROVED payment clearly marked as a booking deposit, OR
  // 3) A PAID rent/monthly_rent invoice for this tenant + property (first month paid).

  if (!application.tenantId || !application.propertyId) return false;

  const tenantId = application.tenantId;
  const propertyId = application.propertyId;

  // 1) Booking deposit invoice paid
  const bookingDepositPaid = await Invoice.exists({
    tenantId,
    propertyId,
    type: 'booking_deposit',
    status: 'paid',
    isDeleted: false,
  });
  if (bookingDepositPaid) return true;

  // 2) Explicit booking deposit payment
  const bookingDepositPayment = await Payment.exists({
    tenantId,
    propertyId,
    status: 'approved',
    isDeleted: false,
    $or: [
      { notes: /Booking deposit/i },
      { notes: /booking_deposit/i },
    ],
  });
  if (bookingDepositPayment) return true;

  // 3) First month rent (or generic rent) fully paid
  const firstRentPaid = await Invoice.exists({
    tenantId,
    propertyId,
    type: { $in: ['monthly_rent', 'rent'] },
    status: 'paid',
    isDeleted: false,
  });
  if (firstRentPaid) return true;

  return false;
}

async function expireApplications() {
  const now = new Date();

  // Find pending/approved applications whose expiry or move-in date has passed
  const candidates = await Application.find({
    isDeleted: false,
    status: { $in: ['pending', 'approved'] },
    $or: [
      { expiresAt: { $lt: now } },
      { preferredMoveIn: { $lt: now } },
    ],
  }).lean();

  if (!candidates.length) {
    console.log('No applications to auto-expire at', now.toISOString());
    return;
  }

  console.log(`Found ${candidates.length} application(s) eligible for auto-expiry.`);

  for (const app of candidates) {
    try {
      const paymentExists = await hasSuccessfulPayment(app);
      if (paymentExists) {
        continue; // tenant has already paid for this property
      }

      const property = app.propertyId
        ? await Property.findById(app.propertyId)
        : null;
      const tenant = app.tenantId
        ? await Tenant.findById(app.tenantId)
        : null;

      // Mark application as expired
      await Application.updateOne(
        { _id: app._id },
        { $set: { status: 'expired' } }
      );

      // Release property
      if (property) {
        property.status = 'available';
        property.tenantId = null;
        await property.save();
      }

      // Detach property from tenant record
      if (tenant && String(tenant.propertyId || '') === String(app.propertyId || '')) {
        tenant.propertyId = null;
        await tenant.save();
      }

      // Send cancellation email to tenant (if we have an email address)
      if (tenant && tenant.email) {
        const subject = 'Lease Application Cancelled';
        const text = [
          'Your lease application was cancelled because the required payment was not completed in time.',
          'The property is now available to other applicants.',
        ].join('\n');

        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f44336;">Lease Application Cancelled</h2>
            <p>Dear ${tenant.firstname || ''} ${tenant.lastname || ''},</p>
            <p>Your lease application was cancelled because the required payment was not completed in time.</p>
            <p>The property is now available to other applicants.</p>
          </div>
        `;

        try {
          await sendMail({ to: tenant.email, subject, text, html });
        } catch (emailErr) {
          console.error('Failed to send auto-expiry email for application', app._id, emailErr.message || emailErr);
        }
      }

      // Audit log entry (system user)
      try {
        await createAuditLog({
          req: { ip: '127.0.0.1', headers: {} },
          userId: null,
          userType: 'system',
          action: 'auto_expire_application',
          entity: 'Application',
          entityId: app._id,
          changes: {
            status: { before: app.status, after: 'expired' },
            reason: 'Payment deadline missed',
            expiredAt: new Date(),
          },
        });
      } catch (auditErr) {
        console.error('Failed to write audit log for application', app._id, auditErr.message || auditErr);
      }

      console.log(`Auto-expired application ${app._id} for tenant ${app.tenantId || 'N/A'}`);
    } catch (err) {
      console.error('Error auto-expiring application', app._id, err.message || err);
    }
  }
}

async function main() {
  try {
    await connectDb();
    console.log('✓ Connected to MongoDB');
    await expireApplications();
    await mongoose.connection.close();
    console.log('✓ Auto-expiry job completed');
    process.exit(0);
  } catch (err) {
    console.error('✗ Error in expireApplications job:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
