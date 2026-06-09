// jobs/sendExpiryWarnings.js
// Send pre-expiry warnings for lease applications approaching their payment deadline.
// Run this script every 30 minutes using a scheduler.

const mongoose = require('mongoose');
require('dotenv').config();

const { Application, Property, Tenant, Payment, Invoice } = require('../../shared/models');
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
  // Mirror the same strict definition used in expireApplications.js
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

async function sendWarnings() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Applications that will expire within the next 24h and are still pending/approved
  const candidates = await Application.find({
    isDeleted: false,
    status: { $in: ['pending', 'approved'] },
    expiresAt: { $gte: now, $lte: in24h },
  }).lean();

  if (!candidates.length) {
    console.log('No applications need expiry warnings at', now.toISOString());
    return;
  }

  console.log(`Found ${candidates.length} application(s) eligible for expiry warnings.`);

  for (const app of candidates) {
    try {
      const paymentExists = await hasSuccessfulPayment(app);
      if (paymentExists) {
        continue;
      }

      const property = app.propertyId
        ? await Property.findById(app.propertyId).lean()
        : null;
      const tenant = app.tenantId
        ? await Tenant.findById(app.tenantId).lean()
        : null;

      if (!tenant || !tenant.email || !property) {
        continue;
      }

      const expiresAt = app.expiresAt ? new Date(app.expiresAt) : null;
      const expiresStr = expiresAt
        ? expiresAt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'the expiry time';

      const subject = 'Action Required – Lease Application Expiring';
      const text = `Your lease application for ${property.propertyname} will be cancelled if payment is not completed by ${expiresStr}.`;
      const baseUrl = process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:3001';
      const payUrl = `${baseUrl}/tenant/dashboard`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ff9800;">Action Required – Lease Application Expiring</h2>
          <p>Dear ${tenant.firstname || ''} ${tenant.lastname || ''},</p>
          <p>Your lease application for <strong>${property.propertyname}</strong> will be cancelled if payment is not completed by <strong>${expiresStr}</strong>.</p>
          <p>
            <a href="${payUrl}" style="background: #4a90e2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Pay Now
            </a>
          </p>
        </div>
      `;

      try {
        await sendMail({ to: tenant.email, subject, text, html });
        console.log(`Sent expiry warning for application ${app._id} to ${tenant.email}`);
      } catch (emailErr) {
        console.error('Failed to send expiry warning for application', app._id, emailErr.message || emailErr);
      }
    } catch (err) {
      console.error('Error processing expiry warning for application', app._id, err.message || err);
    }
  }
}

async function main() {
  try {
    await connectDb();
    console.log('✓ Connected to MongoDB');
    await sendWarnings();
    await mongoose.connection.close();
    console.log('✓ Expiry warnings job completed');
    process.exit(0);
  } catch (err) {
    console.error('✗ Error in sendExpiryWarnings job:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
