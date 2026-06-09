// jobs/sendRentReminders.js
// Run this script daily. It sends rent reminders around the due date and applies
// escalation emails according to days late.

const mongoose = require('mongoose');
require('dotenv').config();

const { Tenant, Property, Invoice } = require('../../shared/models');
const {
  sendFriendlyRentReminder,
  sendDueTodayRentReminder,
  sendOverdueRentReminder,
  sendPaymentReminder,
  sendDefaultNotice,
  sendLegalWarning,
} = require('../../utils/notify');

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) throw new Error('MONGO_URI is not defined');

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✓ Connected to MongoDB');

    const today = startOfDay(new Date());
    const dayMs = 24 * 60 * 60 * 1000;

    // Only consider active monthly rent invoices that are not fully paid
    const invoices = await Invoice.find({
      isDeleted: false,
      $and: [
        { $or: [ { type: 'monthly_rent' }, { type: 'rent' } ] },
        { $or: [ { status: 'unpaid' }, { status: 'partial' }, { status: 'overdue' } ] }
      ],
    })
      .populate('tenantId')
      .populate('propertyId')
      .lean();

    console.log(`Found ${invoices.length} open rent invoice(s) for reminders.`);

    for (const inv of invoices) {
      if (!inv.tenantId || !inv.propertyId || !inv.dueDate) continue;

      const due = startOfDay(inv.dueDate);
      const diffDays = Math.round((due.getTime() - today.getTime()) / dayMs); // days until due (negative if late)
      const daysLate = -Math.min(diffDays, 0); // 0 if not yet late

      let stage = null;

      if (diffDays === 2) {
        stage = 'friendly';
      } else if (diffDays === 0) {
        stage = 'due_today';
      } else if (diffDays === -1) {
        stage = 'overdue_1';
      } else if (daysLate >= 7 && daysLate < 15) {
        stage = 'warning_7';
      } else if (daysLate >= 15 && daysLate < 30) {
        stage = 'alert_15';
      } else if (daysLate >= 30) {
        stage = 'default_30';
      }

      if (!stage) continue;

      if (inv.lastReminderType === stage) {
        // Already sent this stage, skip
        continue;
      }

      const tenant = inv.tenantId;
      const property = inv.propertyId;

      try {
        console.log(`Processing reminder stage='${stage}' for invoice ${inv._id}`);

        if (stage === 'friendly') {
          await sendFriendlyRentReminder({ tenant, invoice: inv, property });
        } else if (stage === 'due_today') {
          await sendDueTodayRentReminder({ tenant, invoice: inv, property });
        } else if (stage === 'overdue_1') {
          await sendOverdueRentReminder({ tenant, invoice: inv, property, daysLate });
        } else if (stage === 'warning_7') {
          await sendPaymentReminder({ tenant, invoice: inv, property, daysLate });
        } else if (stage === 'alert_15') {
          await sendLegalWarning({ tenant, invoice: inv, property, daysLate });
        } else if (stage === 'default_30') {
          await sendDefaultNotice({ tenant, invoice: inv, property, daysLate });
        }

        // Update reminder metadata
        await Invoice.updateOne(
          { _id: inv._id },
          { $set: { lastReminderType: stage, lastReminderAt: new Date() } }
        );
      } catch (err) {
        console.error(`Failed to send reminder for invoice ${inv._id}:`, err.message || err);
      }
    }

    console.log('Rent reminder run completed.');
    await mongoose.connection.close();
  } catch (err) {
    console.error('✗ Error in sendRentReminders:', err);
    process.exit(1);
  }
}

main();
