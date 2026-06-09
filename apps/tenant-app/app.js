// tenant-app/app.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const exphbs = require('express-handlebars');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const morgan = require('morgan');
const crypto = require('crypto');
// const csurf = require('csurf');
const { doubleCsrf } = require('csrf-csrf')
const cookieParser = require('cookie-parser');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set. Generate one with: npm run generate:secret');
  process.exit(1);
}

// Shared imports
const { connect } = require('../../shared/config/db.js');
const models = require('../../shared/models');
const utils = require('../../shared/utils');
const { sendBookingDepositExpired } = require('../../utils/notify');
const { createAuditLog } = require('../../services/auditService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.ADMIN_URL || 'http://localhost:4000',
        credentials: true
    }
});

// ======================
// AUTO-EXPIRY JOBS
// ======================
// Every 30 minutes, expire approved applications whose booking deposit
// window has passed and no booking_deposit payment exists.
if (process.env.DISABLE_WORKERS !== '1') {
    const THIRTY_MINUTES = 30 * 60 * 1000;
    setInterval(async () => {
        try {
            const { Application, Invoice, Payment, Property, Tenant } = models;
            const now = new Date();

            const expiringApps = await Application.find({
                status: 'approved',
                isDeleted: false,
                expiresAt: { $lt: now }
            }).lean();

            if (!expiringApps.length) {
                return;
            }

            for (const appDoc of expiringApps) {
                try {
                    // Find booking deposit invoice for this application
                    const depositInvoice = await Invoice.findOne({
                        tenantId: appDoc.tenantId,
                        propertyId: appDoc.propertyId,
                        type: 'booking_deposit',
                        isDeleted: false
                    }).lean();

                    if (depositInvoice) {
                        const payment = await Payment.findOne({
                            invoiceId: depositInvoice._id,
                            status: 'approved',
                            isDeleted: false
                        }).lean();

                        // Skip if payment exists
                        if (payment) {
                            continue;
                        }
                    }

                    // Mark application as expired
                    await Application.updateOne({ _id: appDoc._id }, { status: 'expired' });

                    // Reset property status to available
                    if (appDoc.propertyId) {
                        await Property.updateOne(
                            { _id: appDoc.propertyId },
                            { status: 'available', tenantId: null }
                        );
                    }

                    // Send email notification to tenant
                    if (appDoc.tenantId) {
                        const tenant = await Tenant.findById(appDoc.tenantId).lean();
                        const property = await Property.findById(appDoc.propertyId).lean();
                        if (tenant && property) {
                            await sendBookingDepositExpired({ tenant, property, application: appDoc });
                        }
                    }
                } catch (jobErr) {
                    console.error('Error processing booking deposit expiry for application', appDoc._id, jobErr);
                }
            }

            console.log(`⌛ Booking deposit expiry job executed. Processed ${expiringApps.length} application(s).`);
        } catch (err) {
            console.error('Booking deposit expiry job failed:', err);
        }
    }, THIRTY_MINUTES);
}

// ======================
// MIDDLEWARE
// ======================
// Stripe webhook needs raw body, must come before other body parsers
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error('⚠️  Webhook signature verification failed:', err.message);
        return res.sendStatus(400);
    }
    
    // Handle checkout.session.completed
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        try {
            const paymentService = require('../../services/payments/paymentService');
            const io = req.app.get('io');
            await paymentService.processPaymentSuccess(session, session.metadata, req, io);
        } catch (err) {
            console.error('Error processing Stripe webhook:', err);
        }
    }

    res.sendStatus(200);
});

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Regular body parsers for other endpoints
app.disable('x-powered-by');
app.use(bodyParser.urlencoded({ extended: true, limit: '10kb' }));
app.use(bodyParser.json({ limit: '10kb' }));
app.use(cookieParser()); 

// Basic query parameter pollution defense (normalize arrays to first value)
app.use((req, res, next) => {
    for (const [key, value] of Object.entries(req.query || {})) {
        if (Array.isArray(value)) req.query[key] = value[0];
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// CSP nonce for inline scripts
app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'self'"],
            scriptSrc: [
                "'self'",
                (req, res) => `'nonce-${res.locals.cspNonce}'`,
                "https://code.jquery.com",
                "https://stackpath.bootstrapcdn.com",
                "https://cdn.jsdelivr.net"
            ],
            scriptSrcElem: [
                "'self'",
                (req, res) => `'nonce-${res.locals.cspNonce}'`,
                "https://code.jquery.com",
                "https://stackpath.bootstrapcdn.com",
                "https://cdn.jsdelivr.net"
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://stackpath.bootstrapcdn.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://stackpath.bootstrapcdn.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://stackpath.bootstrapcdn.com", "https://cdnjs.cloudflare.com"],
            connectSrc: ["'self'", "https://stackpath.bootstrapcdn.com", "https://cdn.jsdelivr.net"]
        }
    }
}));
// app.use(mongoSanitize());
app.use(mongoSanitize({
    allowDots: true,
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
        if (key !== '_csrf') {
            console.warn(`[SANITIZE] Removed key: ${key}`);
        }
    }
}));

// Rate limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/tenant/login', authLimiter);
app.use('/properties/apply', authLimiter);

// Session
const session_config = {
    secret: process.env.SESSION_SECRET || 'tenant-app-secret',
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
        // secure: process.env.NODE_ENV === 'production',
        secure: false, 
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 2 * 60 * 60 * 1000
    }
};

if (process.env.REDIS_URL) {
    const redis = require('redis');
    const connectRedis = require('connect-redis');
    const RedisStore = connectRedis(session);
    const redisClient = redis.createClient({ url: process.env.REDIS_URL });
    redisClient.connect();
    session_config.store = new RedisStore({ client: redisClient });
}

app.use(cookieParser());
app.use(session(session_config));
// CSRF protection
const csurf = require('csurf');
const csrfProtection = csurf({
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false       // change to true in production
    }
});
app.use(csrfProtection);
// // CSRF protection (uses session storage)
// app.use(csurf());

// const { generateToken, doubleCsrfProtection } = doubleCsrf({
//   getSecret: () => process.env.SESSION_SECRET || 'dev-secret',
//   getSessionIdentifier: (req) => req.session?.id || req.sessionID || '',
//   cookieName: 'csrf-token',
//   cookieOptions: {
//     httpOnly: true,
//     sameSite: 'lax',
//     path: '/',
//     secure: false
//   },
//   getCsrfTokenFromRequest: (req) =>
//     req.body?._csrf || req.headers['x-csrf-token'] || ''
// });

// app.use(doubleCsrfProtection);
// app.use(doubleCsrfProtection({ 
//     cookie: false,           // use session, not cookie
//     ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
//     value: (req) => {
//         return req.body && req.body._csrf
//             || req.headers['x-csrf-token']
//             || req.headers['x-xsrf-token']
//             || '';
//     }
// }));
app.use((req, res, next) => {
  try {
    res.locals.csrfToken = generateToken(req, res);
  } catch (_) {
    res.locals.csrfToken = '';
  }
  next();
});
app.use((req, res, next) => {
  try {
    res.locals.csrfToken = generateToken(req, res);
  } catch (_) {
    res.locals.csrfToken = '';
  }
  next();
});

// Morgan logging
const morganFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';
app.use(morgan(morganFormat, {
    stream: {
        write: (message) => utils.logger.info(message.trim())
    }
}));

// Expose session and common config to views
// app.use((req, res, next) => {
//     res.locals.session = req.session || {};
//     res.locals.appName = 'Tenant Portal';
//     res.locals.cspNonce = res.locals.cspNonce || '';
//     // Currency configuration (shared between admin and tenant apps)
//     res.locals.currencySymbol = utils.currency.symbol;
//     res.locals.currencyCode = utils.currency.code;
//     if (typeof req.csrfToken === 'function') {
//         res.locals.csrfToken = req.csrfToken();
//     }
//     next();
// });
app.use((req, res, next) => {
    res.locals.session = req.session || {};
    res.locals.appName = 'Admin Console';
    res.locals.currencySymbol = utils.currency.symbol;
    res.locals.currencyCode = utils.currency.code;
    res.locals.csrfToken = req.csrfToken();   // CSRF 
    next();
});

// ======================
// VIEW ENGINE
// ======================
app.engine('hbs', exphbs.engine({
    extname: '.hbs',
    defaultLayout: false,
    layoutsDir: path.join(__dirname, 'views'),
    partialsDir: path.join(__dirname, 'views'),
    helpers: {
        formatDate: (date) => date ? new Date(date).toLocaleDateString() : '—',
        eq: (a, b) => a === b,
        normalizeConfidence: (value) => {
            const num = Number(value || 0);
            if (!Number.isFinite(num)) return 0;
            return num > 1 ? Math.min(100, num) : Math.min(100, num * 100);
        },
        subtract: (a, b) => a - b,
        substring: (str, start, end) => str ? str.substring(start, end) : '',
        currencySymbol: () => utils.currency.symbol,
        formatCurrency: (amount) => `${utils.currency.symbol}${Number(amount || 0)}`
    }
}));

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// ======================
// DATABASE CONNECTION
// ======================
connect().then(() => {
    console.log('✓ Tenant App: MongoDB Connected');
}).catch(err => {
    console.error('✗ Tenant App: MongoDB Error', err);
});

// ======================
// ROUTES (Tenant App)
// ======================
// Import and mount routes
const tenantRoutes = require('./src/modules/tenant');

// Mount tenant routes (all tenant features are under /tenant)
app.use('/tenant', tenantRoutes);

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        smtp: {
            configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
            host: process.env.SMTP_HOST
        }
    });
});

// Root route - redirect to tenant login
app.get('/', (req, res) => {
    if (req.session && req.session.loggedIn && req.session.userType === 'tenant') {
        return res.redirect('/tenant/dashboard');
    }
    res.render('login', { layout: false, cspNonce: res.locals.cspNonce });
});

// ======================
// SOCKET.IO (Real-time for tenants)
// ======================
io.on('connection', (socket) => {
    const tenantId = socket.handshake.query.tenantId;
    
    if (tenantId) {
        socket.join(`tenant:${tenantId}`);
        console.log(`✓ Tenant ${tenantId} connected via Socket.IO`);
    }
    
    socket.on('disconnect', () => {
        if (tenantId) {
            console.log(`✗ Tenant ${tenantId} disconnected`);
        }
    });
});

// Expose io to services
const emitter = require('../../shared/realtime/emitter');
emitter.set(io);

// ======================
// ERROR HANDLING
// ======================
// app.use((err, req, res, next) => {
//     if (err && err.code === 'EBADCSRFTOKEN') {
//         // Don't leak details; treat as forbidden.
//         if (req.accepts('html')) {
//             req.session.error = 'Your session expired. Please try again.';
//             return res.redirect(req.get('Referrer') || '/tenant/login/form');
//         }
//         return res.status(403).json({ error: 'Invalid CSRF token' });
//     }
//     next(err);
// });
// app.use((err, req, res, next) => {
//     if (err && err.code === 'EBADCSRFTOKEN') {
//         console.error('[CSRF ERROR] Bad token on:', req.method, req.path,
//             '| sessionID:', req.sessionID,
//             '| has session secret:', !!req.session);
//         if (req.accepts('html')) {
//             req.session.loginError = 'Form session expired. Please try again.';
//             return res.redirect('/tenant/login/form');
//         }
//         return res.status(403).json({ error: 'Invalid CSRF token' });
//     }
//     next(err);
// });
app.use((err, req, res, next) => {
    if (err && err.code === 'EBADCSRFTOKEN') {
        console.error('[CSRF] Bad token:', req.method, req.path);
        if (req.accepts('html')) {
            req.session.loginError = 'Form expired. Please try again.';
            const redirectTo = req.path.startsWith('/tenant') 
                ? '/tenant/login/form' 
                : '/admin/login/form';
            return res.redirect(redirectTo);
        }
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next(err);
});

app.use((err, req, res, next) => {
    utils.logger.error('Unhandled Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error'
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).send('Page not found');
});

// ======================
// START SERVER
// ======================
// Prefer Render/hosting provider PORT, fall back to configured TENANT_PORT or default.
const PORT = process.env.PORT || process.env.TENANT_PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   TENANT PORTAL - LeaseHub             ║
║   Running on: http://localhost:${PORT}  ║
║   Environment: ${process.env.NODE_ENV || 'development'}         ║
╚════════════════════════════════════════╝
    `);
    utils.logger.info(`Tenant app started on port ${PORT}`);
});

module.exports = { app, io };
