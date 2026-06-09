// Create Admin User Script
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✓ Connected to MongoDB'))
    .catch(err => {
        console.error('✗ MongoDB connection error:', err);
        process.exit(1);
    });

// Admin Schema
const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'admin', enum: ['admin', 'superadmin'] },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

const Admin = mongoose.model('Admin', adminSchema, 'admins');

async function createAdmin() {
    try {
        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ username: 'nan' });
        
        if (existingAdmin) {
            console.log('⚠️  Admin user already exists!');
            console.log('Username: nan');
            console.log('If you forgot the password, delete the admin user from database and run this script again.');
            process.exit(0);
        }

        // Create new admin
        const hashedPassword = await bcrypt.hash('nan427', 10);
        
        const admin = new Admin({
            username: 'nan',
            email: 'nan@leasehub.com',
            password: hashedPassword,
            role: 'superadmin',
            isActive: true
        });

        await admin.save();

        console.log('\n✅ Admin user created successfully!');
        console.log('═══════════════════════════════════');
        console.log('Username: nan');
        console.log('Password: nan427');
        console.log('Email: admin@leasehub.com');
        console.log('Role: superadmin');
        console.log('═══════════════════════════════════');
        console.log('\n⚠️  IMPORTANT: Change the password after first login!');
        console.log('\nYou can now login at: http://localhost:4000/admin/login/form\n');

        process.exit(0);
    } catch (error) {
        console.error('✗ Error creating admin:', error);
        process.exit(1);
    }
}

createAdmin();
