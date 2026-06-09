const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');

/**
 * Configure Security Middleware for Express Apps
 * @param {Object} app - Express App instance
 */
module.exports = (app) => {
    // 1. Helmet: Sets secure HTTP headers
    app.use(helmet({
        contentSecurityPolicy: false, // Disabled if using external scripts/styles without proper CSP
        crossOriginEmbedderPolicy: false
    }));

    // 2. Data Sanitization: Prevent NoSQL Injection
    app.use(mongoSanitize());

    // 3. Global Rate Limiter: Prevent DDoS & brute force
    const globalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 1000, // Limit each IP to 1000 requests per window
        message: 'Too many requests from this IP, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use(globalLimiter);

    // 4. Strict Rate Limiter: For Login/OTP/Payment Endpoints
    const strictLimiter = rateLimit({
        windowMs: 10 * 60 * 1000, // 10 minutes
        max: 5, // Limit each IP to 5 requests per window
        message: 'Too many attempts, please try again after 10 minutes.'
    });
    
    // Example: app.use('/login', strictLimiter);
    // Export it so routers can use it specifically
    app.strictLimiter = strictLimiter;
};
