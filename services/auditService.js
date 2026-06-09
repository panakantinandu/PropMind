const { AuditLog } = require('../shared/models');

async function createAuditLog({ req, userId, userType, action, entity, entityId, changes }) {
    try {
        const ipAddress = req.ip || (req.connection && req.connection.remoteAddress) || undefined;
        const userAgent = (req.headers && req.headers['user-agent']) || undefined;

        await AuditLog.create({
            userId,
            userType,
            action,
            entity,
            entityId,
            changes,
            ipAddress,
            userAgent,
            timestamp: new Date()
        });
    } catch (err) {
        // Audit logging must never break main flow
        // eslint-disable-next-line no-console
        console.error('Audit log error:', err.message || err);
    }
}

module.exports = {
    createAuditLog,
};
