// admin-app/app.js
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
// const { doubleCsrf } = require('csrf-csrf');
const cookieParser = require('cookie-parser');
const multer = require('multer');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set. Generate one with: npm run generate:secret');
  process.exit(1);
}

// Shared imports
const { connect } = require('../../shared/config/db.js');
const models = require('../../shared/models');
const utils = require('../../shared/utils');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.TENANT_URL || 'http://localhost:3000',
        credentials: true
    }
});

// ======================
// MIDDLEWARE
// ======================
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}
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

// Multer configuration for property image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'uploads', 'properties'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'property-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
        cb(null, true);
    } else {
        cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed'));
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: fileFilter
});

// Export upload middleware for routes
app.locals.upload = upload;

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
            connectSrc: ["'self'", "https://stackpath.bootstrapcdn.com", "https://cdn.jsdelivr.net", "https://code.jquery.com"]
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
app.use('/admin/login', authLimiter);

// Session
const session_config = {
    secret: process.env.SESSION_SECRET || 'admin-app-secret',
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


// Morgan logging
const morganFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';
app.use(morgan(morganFormat, {
    stream: {
        write: (message) => utils.logger.info(message.trim())
    }
}));

// Expose session and common config to views
app.use((req, res, next) => {
    if (req.method === 'POST') {
        console.log('[DEBUG POST]', req.path, '| body keys:', Object.keys(req.body || {}), '| has _csrf:', !!req.body?._csrf, '| csrf length:', req.body?._csrf?.length);
    }
    res.locals.session = req.session || {};
    res.locals.appName = 'Admin Console';
    // Currency configuration shared with tenant app
    res.locals.currencySymbol = utils.currency.symbol;
    res.locals.currencyCode = utils.currency.code;
    // if (typeof req.csrfToken === 'function') {
    //     res.locals.csrfToken = req.csrfToken();
    // }
    res.locals.csrfToken = req.csrfToken();  
    next();
});

// ======================
// VIEW ENGINE
// ======================
app.engine('hbs', exphbs.engine({
    extname: '.hbs',
    defaultLayout: false,
    layoutsDir: path.join(__dirname, 'views'),
    partialsDir: [
        path.join(__dirname, 'views', 'partials'),
        path.join(__dirname, 'views')
    ],
    helpers: {
        formatDate: (date) => date ? new Date(date).toLocaleDateString() : '—',
        eq: (a, b) => a === b,
        normalizeConfidence: (value) => {
            const num = Number(value || 0);
            if (!Number.isFinite(num)) return 0;
            return num > 1 ? Math.min(100, num) : Math.min(100, num * 100);
        },
        or: function() {
            // Returns true if any argument is truthy
            return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
        },
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
    console.log('✓ Admin App: MongoDB Connected');
}).catch(err => {
    console.error('✗ Admin App: MongoDB Error', err);
});

// ======================
// ROUTES (Admin App)
// ======================
// Root route - redirect to admin login
app.get('/', (req, res) => {
    res.render('admin-login', { layout: false });
});

// Import and mount routes
const adminRoutes = require('./src/modules/admin');

app.use('/admin', adminRoutes);
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
// ======================
// SOCKET.IO (Real-time for admins)
// ======================
io.on('connection', (socket) => {
    const adminId = socket.handshake.query.adminId;
    
    if (adminId) {
        socket.join(`admin:${adminId}`);
        console.log(`✓ Admin ${adminId} connected via Socket.IO`);
    }
    
    socket.on('disconnect', () => {
        console.log(`✗ Admin disconnected`);
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
//         if (req.accepts('html')) {
//             req.session.error = 'Your session expired. Please try again.';
//             return res.redirect(req.get('Referrer') || '/admin/login');
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
//             return res.redirect('/admin/login/form');
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

// Start Cron Service (async - initializes Redis connection probe + cron schedules)
const cronService = require('../../services/cronService');
cronService.start().catch(err => utils.logger.error('CronService init error:', err));

// Prefer Render/hosting provider PORT, fall back to configured ADMIN_PORT or default.
const PORT = process.env.PORT || process.env.ADMIN_PORT || 4000;
server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   ADMIN CONSOLE - LeaseHub             ║
║   Running on: http://localhost:${PORT} ║
║   Environment: ${process.env.NODE_ENV || 'development'}         ║
╚════════════════════════════════════════╝
    `);
    utils.logger.info(`Admin app started on port ${PORT}`);
});

module.exports = { app, io };
