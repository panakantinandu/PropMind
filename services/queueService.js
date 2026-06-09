/**
 * BullMQ Queue Service with Graceful Redis Fallback
 * 
 * If Redis is available, jobs are dispatched to BullMQ queues with automatic retries,
 * exponential backoff, and persistence across server restarts.
 * 
 * If Redis is NOT available (e.g. local dev without Docker), jobs execute inline
 * so nothing breaks. A warning is logged once at startup.
 */
const logger = require('../utils/logger');

let Queue, Worker, QueueEvents, connection;
let redisAvailable = false;
let initChecked = false;

async function initRedis() {
    if (initChecked) return redisAvailable;
    initChecked = true;

    try {
        const Redis = require('ioredis');
        const { Queue: BullQueue, Worker: BullWorker, QueueEvents: BullQueueEvents } = require('bullmq');

        const testConn = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
            lazyConnect: true,
            connectTimeout: 3000,
        });
        // Suppress noisy unhandled error events from ioredis
        testConn.on('error', () => {});

        await testConn.connect();
        logger.info('[QueueService] ✅ Redis connected successfully');

        connection = testConn;
        Queue = BullQueue;
        Worker = BullWorker;
        QueueEvents = BullQueueEvents;
        redisAvailable = true;
    } catch (err) {
        logger.warn(`[QueueService] ⚠️ Redis unavailable (${err.message}). Jobs will execute inline (no queue).`);
        redisAvailable = false;
    }

    return redisAvailable;
}

class QueueService {
    constructor() {
        this.queues = {};
        this.workers = {};
        this.processors = {}; // Registered processors for inline fallback
        this._initPromise = initRedis();
    }

    async ensureReady() {
        await this._initPromise;
    }

    /**
     * Register a processor function for a given queue + job name.
     * Used both as BullMQ worker handler AND as inline fallback.
     */
    registerProcessor(queueName, jobName, processorFn) {
        const key = `${queueName}:${jobName}`;
        this.processors[key] = processorFn;
    }

    /**
     * Add a job to a queue. Falls back to inline execution if Redis is down.
     */
    async addJob(queueName, jobName, data, options = {}) {
        await this.ensureReady();

        if (redisAvailable) {
            // Ensure queue exists
            if (!this.queues[queueName]) {
                this.queues[queueName] = new Queue(queueName, { connection });
            }

            const defaultOptions = {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: true,
                removeOnFail: false,
            };

            const job = await this.queues[queueName].add(jobName, data, { ...defaultOptions, ...options });
            logger.info(`[QueueService] Job queued: ${queueName}/${jobName} (id: ${job.id})`);
            return job;
        }

        // Inline fallback: execute processor directly
        const key = `${queueName}:${jobName}`;
        const processor = this.processors[key];
        if (processor) {
            logger.info(`[QueueService] Executing inline: ${queueName}/${jobName}`);
            try {
                await processor({ data, name: jobName });
            } catch (err) {
                logger.error(`[QueueService] Inline job ${key} failed: ${err.message}`);
            }
        } else {
            logger.warn(`[QueueService] No processor registered for ${key}, job skipped.`);
        }
    }

    /**
     * Start workers for a queue. Only operates if Redis is available.
     */
    async startWorkers() {
        await this.ensureReady();
        if (!redisAvailable) return;

        for (const [key, processorFn] of Object.entries(this.processors)) {
            const [queueName] = key.split(':');

            if (!this.workers[queueName]) {
                const worker = new Worker(queueName, async (job) => {
                    const processorKey = `${queueName}:${job.name}`;
                    const handler = this.processors[processorKey];
                    if (handler) {
                        await handler(job);
                    } else {
                        logger.warn(`[QueueService] No handler for ${processorKey}`);
                    }
                }, { connection });

                worker.on('completed', (job) => logger.info(`[BullMQ] ✅ Job ${job.id} completed in ${queueName}`));
                worker.on('failed', (job, err) => logger.error(`[BullMQ] ❌ Job ${job?.id} failed in ${queueName}: ${err.message}`));

                this.workers[queueName] = worker;
                logger.info(`[BullMQ] Worker started for queue: ${queueName}`);
            }
        }
    }

    get isRedisAvailable() {
        return redisAvailable;
    }
}

module.exports = new QueueService();
