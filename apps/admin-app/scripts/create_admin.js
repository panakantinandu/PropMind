const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { join } = require('path');
const { connect } = require(join(__dirname, '..', '..', '..', 'shared', 'config', 'db'));
const Admin = require(join(__dirname, '..', '..', '..', 'shared', 'models')).Admin;

(async () => {
    try {
        await connect();
        const username = 'devadmin';
        const email = 'devadmin@example.com';
        const password = 'Password123!';

        let admin = await Admin.findOne({ $or: [{ username }, { email }] });
        if (admin) {
            admin.username = username;
            admin.email = email;
            admin.password = password;
            admin.isVerified = true;
            admin.isActive = true;
            admin.isDeleted = false;
            await admin.save();
            console.log('Updated existing admin:', admin._id.toString());
        } else {
            admin = new Admin({ username, email, password, isVerified: true, isActive: true });
            await admin.save();
            console.log('Created admin:', admin._id.toString());
        }
        process.exit(0);
    } catch (err) {
        console.error('Error creating admin', err);
        process.exit(1);
    }
})();
