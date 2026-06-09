// jobs/generateMonthlyRentInvoices.js
// Run this script on the 1st of every month (via OS cron/task scheduler).
// It generates monthly_rent invoices for all active leases.

const mongoose = require('mongoose');
require('dotenv').config();

const { Lease, Invoice } = require('../../shared/models');

async function main() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✓ Connected to MongoDB');

    const now = new Date();
    const isFirstOfMonth = now.getDate() === 1;
    if (!isFirstOfMonth) {
      console.log('Today is not the 1st of the month. No invoices generated.');
      await mongoose.connection.close();
      return;
    }

    const year = now.getFullYear();
    const monthIndex = now.getMonth(); // 0-based
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

    // Rent is due on the 5th of the current month
    const dueDate = new Date(year, monthIndex, 5, 0, 0, 0, 0);

    // Query active leases instead of occupied properties
    const activeLeases = await Lease.find({
      status: 'active',
      isDeleted: false
    }).populate('tenantId').populate('propertyId').lean();

    if (!activeLeases.length) {
      console.log('No active leases found. Nothing to do.');
      await mongoose.connection.close();
      return;
    }

    console.log(`Found ${activeLeases.length} active lease(s). Generating invoices for month ${monthKey}...`);

    let createdCount = 0;

    for (const lease of activeLeases) {
      const tenantId = lease.tenantId && lease.tenantId._id;
      const propertyId = lease.propertyId && lease.propertyId._id;
      const adminId = lease.adminId;
      
      if (!tenantId || !propertyId) {
        console.log(`Skipping lease ${lease._id} - missing tenantId or propertyId.`);
        continue;
      }

      // Check if an invoice already exists for this lease/month
      const existing = await Invoice.findOne({
        tenantId,
        propertyId,
        month: monthKey,
        type: 'monthly_rent',
        isDeleted: false,
      }).lean();

      if (existing) {
        console.log(`Invoice already exists for lease ${lease._id} for ${monthKey}, skipping.`);
        continue;
      }

      const rentAmount = Number(lease.monthlyRent) || 0;
      if (!rentAmount || rentAmount <= 0) {
        console.log(`Skipping lease ${lease._id} - invalid rent amount.`);
        continue;
      }

      const totalAmount = rentAmount;

      const invoice = new Invoice({
        type: 'monthly_rent',
        tenantId,
        propertyId,
        adminId,
        month: monthKey,
        rentAmount,
        maintenanceCharges: 0,
        waterCharges: 0,
        electricityCharges: 0,
        otherCharges: 0,
        totalAmount,
        dueDate,
        status: 'unpaid',
        paidAmount: 0,
        balance: totalAmount,
        lateFeesAccrued: 0,
        isDeleted: false,
      });

      await invoice.save();
      createdCount += 1;
      console.log(`✓ Created monthly_rent invoice ${invoice._id} for lease ${lease._id} | Amount: ₹${totalAmount}`);
    }

    console.log(`\nDone. Created ${createdCount} monthly_rent invoice(s) for ${monthKey}.`);
    await mongoose.connection.close();
  } catch (err) {
    console.error('✗ Error in generateMonthlyRentInvoices:', err);
    process.exit(1);
  }
}

main();
