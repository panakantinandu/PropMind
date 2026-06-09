const mongoose = require('mongoose');
const Admin = require('../shared/models/admin.js');
const Property = requi../shared/models/property.jserty');
const Tenant = r../shared/models/tenant.jss/tenant');
const Application../shared/models/application.js/application');
const Pay../shared/models/payment.jsd/models/payment');
const../shared/models/invoice.jshared/models/invoice');
const../shared/models/ledgerEntry.jshared/models/ledgerEntry../shared/models/ticket.jsuire('./shared/models/ticket')../shared/models/notification.jsre('./shared/models/notification');
require('dotenv').config();

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/property_ms', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Find existing admin or create a default one
        let defaultAdmin = await Admin.findOne().sort({ createdAt: 1 });
        if (!defaultAdmin) {
            console.log('No admin found, creating a default admin...');
            defaultAdmin = new Admin({
                username: 'admin',
                email: 'admin@leasehub.com',
                password: 'password', // will be hashed
                role: 'admin'
            });
            await defaultAdmin.save();
        }
        
        const adminId = defaultAdmin._id;
        console.log(`Using Admin ID: ${adminId} for migration`);

        const modelsToUpdate = [
            { name: 'Property', model: Property },
            { name: 'Tenant', model: Tenant },
            { name: 'Application', model: Application },
            { name: 'Payment', model: Payment },
            { name: 'Invoice', model: Invoice },
            { name: 'LedgerEntry', model: LedgerEntry },
            { name: 'Ticket', model: Ticket }
        ];

        for (const { name, model } of modelsToUpdate) {
            const result = await model.updateMany(
                { adminId: { $exists: false } },
                { $set: { adminId: adminId } }
            );
            console.log(`Updated ${result.modifiedCount} ${name} records.`);
        }

        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

migrate();
