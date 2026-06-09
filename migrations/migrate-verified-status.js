const mongoose = require('mongoose');
const Admin = require('../shared/models/admin.js');
const Tenant = requi../shared/models/tenant.jsnant');
require('dotenv').config();

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/property_ms', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        const adminResult = await Admin.updateMany(
            { isVerified: { $exists: false } },
            { $set: { isVerified: true } }
        );
        console.log(`Updated ${adminResult.modifiedCount} Admin records to isVerified: true`);

        const tenantResult = await Tenant.updateMany(
            { isVerified: { $exists: false } },
            { $set: { isVerified: true } }
        );
        console.log(`Updated ${tenantResult.modifiedCount} Tenant records to isVerified: true`);

        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

migrate();
