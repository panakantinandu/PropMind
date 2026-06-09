/**
 * CronService - Hybrid Scheduler
 * 
 * Uses node-cron for scheduling, but dispatches work to BullMQ queues
 * when Redis is available. Falls back to inline execution otherwise.
 * 
 * This preserves the existing cron schedules while gaining queue benefits:
 * - Automatic retries with exponential backoff
 * - Job persistence across server restarts (when Redis is up)
 * - Structured logging via Winston
 * - No duplicate job execution (BullMQ deduplication)
 */
const cron = require('node-cron');
const logger = require('../utils/logger');
const queueService = require('./queueService');
const {
    processMonthlyRent,
    processLateFees,
    processPaymentReminders,
    processExpiredApplications,
} = require('../jobs/billing/billingJobs');

const QUEUE_NAME = 'billingQueue';

class CronService {
    async start() {
        logger.info('[CronService] Initializing background jobs...');

        // Register processors with the queue service (for both BullMQ and inline paths)
        queueService.registerProcessor(QUEUE_NAME, 'generateMonthlyRent', processMonthlyRent);
        queueService.registerProcessor(QUEUE_NAME, 'applyLateFees', processLateFees);
        queueService.registerProcessor(QUEUE_NAME, 'sendPaymentReminders', processPaymentReminders);
        queueService.registerProcessor(QUEUE_NAME, 'expireApplications', processExpiredApplications);

        // Start BullMQ workers if Redis is available
        await queueService.startWorkers();

        // 1. Monthly Rent Generation (every day at midnight)
        cron.schedule('0 0 * * *', async () => {
            try {
                await queueService.addJob(QUEUE_NAME, 'generateMonthlyRent', {
                    triggeredAt: new Date().toISOString()
                });
            } catch (err) {
                logger.error(`[CronService] Failed to queue rent generation: ${err.message}`);
            }
        });

        // 2. Payment Reminders (every day at 8 AM)
        cron.schedule('0 8 * * *', async () => {
            try {
                await queueService.addJob(QUEUE_NAME, 'sendPaymentReminders', {
                    triggeredAt: new Date().toISOString()
                });
            } catch (err) {
                logger.error(`[CronService] Failed to queue payment reminders: ${err.message}`);
            }
        });

        // 3. Late Fee Application (every day at 1 AM)
        cron.schedule('0 1 * * *', async () => {
            try {
                await queueService.addJob(QUEUE_NAME, 'applyLateFees', {
                    triggeredAt: new Date().toISOString()
                });
            } catch (err) {
                logger.error(`[CronService] Failed to queue late fee application: ${err.message}`);
            }
        });

        // 4. Auto-cancel Expired Applications (every hour)
        cron.schedule('0 * * * *', async () => {
            try {
                await queueService.addJob(QUEUE_NAME, 'expireApplications', {
                    triggeredAt: new Date().toISOString()
                });
            } catch (err) {
                logger.error(`[CronService] Failed to queue application expiry check: ${err.message}`);
            }
        });

        const mode = queueService.isRedisAvailable ? 'BullMQ (Redis)' : 'Inline (No Redis)';
        logger.info(`[CronService] ✅ Background jobs initialized. Mode: ${mode}`);
        console.log(`[CronService] ✅ Background jobs initialized. Mode: ${mode}`);
    }
}

module.exports = new CronService();
