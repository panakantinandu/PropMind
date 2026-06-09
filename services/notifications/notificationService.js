const Notification = require('../../shared/models').Notification;

class NotificationService {
    async createNotification(data) {
        try {
            const notification = new Notification({
                userType: data.userType, // 'admin' or 'tenant'
                tenantId: data.tenantId,
                adminId: data.adminId,
                title: data.title,
                message: data.message,
                type: data.type,
                metadata: data.metadata
            });
            await notification.save();
            return notification;
        } catch (error) {
            console.error('[NotificationService] Error creating notification:', error);
            return null;
        }
    }

    async notifyTenant(tenantId, title, message, type = 'general', metadata = {}) {
        return this.createNotification({
            userType: 'tenant',
            tenantId,
            title,
            message,
            type,
            metadata
        });
    }

    async notifyAdmin(adminId, title, message, type = 'general', metadata = {}) {
        return this.createNotification({
            userType: 'admin',
            adminId,
            title,
            message,
            type,
            metadata
        });
    }

    async markAsRead(notificationId) {
        try {
            await Notification.findByIdAndUpdate(notificationId, {
                isRead: true,
                readAt: new Date()
            });
        } catch (error) {
            console.error('[NotificationService] Error marking as read:', error);
        }
    }
}

module.exports = new NotificationService();
