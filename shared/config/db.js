// shared/config/db.js
const mongoose = require('mongoose');
require('dotenv').config();

// Keep query parsing strict/predictable.
// Note: sanitizeFilter currently interferes with valid $in status queries used
// by support/AI flows, so it is intentionally left disabled.
mongoose.set('strictQuery', true);

const connect = async () => {
    try {
        const mongoUri = process.env.MONGO_URI;
        
        if (!mongoUri) {
            throw new Error('MONGO_URI is not defined in environment variables');
        }

        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log('MongoDB Connected Successfully to:', mongoUri.split('@')[1]);
        return mongoose.connection;
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        process.exit(1);
    }
};

module.exports = { connect, mongoose };
