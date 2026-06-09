const { createLogger, format, transports } = require('winston');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        format.printf(({ level, message, timestamp, stack, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
            return `${timestamp} [${level.toUpperCase()}]: ${stack || message}${metaStr}`;
        })
    ),
    transports: [
        // Console with colorized output
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(({ level, message, timestamp, stack }) => {
                    return `${timestamp} ${level}: ${stack || message}`;
                })
            )
        }),
        // Combined log (all levels)
        new transports.File({
            filename: path.join(logDir, 'app.log'),
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 5,
            tailable: true
        }),
        // Error-only log for quick troubleshooting
        new transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3,
            tailable: true
        }),
        // Payment-specific log for audit trail
        new transports.File({
            filename: path.join(logDir, 'payments.log'),
            level: 'info',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
            format: format.combine(
                format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                format((info) => {
                    // Only log payment-related messages to this file
                    if (info.message && (
                        info.message.includes('[PaymentService]') ||
                        info.message.includes('[BillingJob]') ||
                        info.message.includes('Payment') ||
                        info.message.includes('Invoice')
                    )) {
                        return info;
                    }
                    return false;
                })(),
                format.printf(({ level, message, timestamp }) => {
                    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
                })
            )
        })
    ]
});

// Morgan stream for HTTP request logging
logger.stream = {
    write: function (message) {
        logger.info(message.trim());
    }
};

module.exports = logger;
