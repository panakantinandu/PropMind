const { join } = require('path');
require('dotenv').config({ path: join(__dirname, '..', '..', '.env') });
const { connect } = require(join(__dirname, '..', '..', '..', 'shared', 'config', 'db'));
const Admin = require(join(__dirname, '..', '..', '..', 'shared', 'models')).Admin;
const Notification = require(join(__dirname, '..', '..', '..', 'shared', 'models')).Notification;

(async () => {
    try {
        await connect();
        const admin = await Admin.findOne({ username: 'devadmin' });
        if (!admin) {
            console.error('Admin not found');
            process.exit(1);
        }
        const notif = await Notification.create({
            adminId: admin._id,
            userType: 'admin',
            title: 'Test Notification',
            message: 'This is a test notification',
            type: 'test',
            metadata: { foo: 'bar' }
        });
        console.log('Created notification:', notif._id.toString());
        process.exit(0);
    } catch (err) {
        console.error('Error creating notification', err);
        process.exit(1);
    }
})();
