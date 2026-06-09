// jobs/applyLateFees.js
// Run this script daily. It applies automatic late fees to unpaid rent invoices
// and writes corresponding ledger entries.

const mongoose = require('mongoose');
require('dotenv').config();

const { Invoice, LedgerEntry, Tenant, Property } = require('../../shared/models');

const LATE_FEE_PER_DAY = 100; // $100 per day

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

    // Only consider monthly_rent invoices that are still unpaid
    const invoices = await Invoice.find({
      isDeleted: false,
      type: 'monthly_rent',
      status: 'unpaid',
    }).lean();

    console.log(`Found ${invoices.length} monthly rent invoice(s) to check for late fees.`);

    for (const inv of invoices) {
      if (!inv.dueDate) continue;

      const due = startOfDay(inv.dueDate);
      const daysLate = Math.floor((today.getTime() - due.getTime()) / dayMs);
      if (daysLate <= 0) continue; // not yet late

      // As per policy, late fee starts after 3 days late
      const effectiveDaysLate = Math.max(0, daysLate - 3);
      if (effectiveDaysLate <= 0) continue;

      const alreadyFees = Number(inv.lateFeesAccrued || 0);
      const targetFees = effectiveDaysLate * LATE_FEE_PER_DAY;
      const additionalFees = targetFees - alreadyFees;

      if (additionalFees <= 0) continue; // up-to-date

      console.log(
        `Invoice ${inv._id}: daysLate=${daysLate}, effectiveDaysLate=${effectiveDaysLate}, ` +
          `alreadyFees=${alreadyFees}, adding=${additionalFees}`
      );

      // Create a separate late_fee invoice entry for the additional amount
      const lateInvoice = new Invoice({
        type: 'late_fee',
        tenantId: inv.tenantId,
        propertyId: inv.propertyId,
        month: inv.month,
        rentAmount: 0,
        maintenanceCharges: 0,
        waterCharges: 0,
        electricityCharges: 0,
        otherCharges: 0,
        totalAmount: additionalFees,
        dueDate: today,
        status: 'unpaid',
        paidAmount: 0,
        balance: additionalFees,
        isDeleted: false,
      });

      await lateInvoice.save();

      await Invoice.updateOne(
        { _id: inv._id },
        {
          $set: {
            lateFeesAccrued: alreadyFees + additionalFees,
            status: daysLate > 0 ? 'overdue' : inv.status,
          },
        }
      );

      // Optional: create a ledger entry for audit
      const tenantId = inv.tenantId;
      if (!tenantId) continue;

      const description = `Late fee for rent invoice ${inv.month || ''}`.trim();

      const entry = new LedgerEntry({
        tenantId,
        type: 'debit',
        amount: additionalFees,
        description,
        referenceType: 'invoice',
        referenceId: lateInvoice._id,
      });

      await entry.save();
      console.log(`✓ Created late_fee invoice ${lateInvoice._id} of $${additionalFees} for rent invoice ${inv._id}`);
    }

    console.log('Late fee run completed.');
    await mongoose.connection.close();
  } catch (err) {
    console.error('✗ Error in applyLateFees:', err);
    process.exit(1);
  }
}

main();
