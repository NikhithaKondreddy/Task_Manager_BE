const db = require('../db'); // Your MySQL db connection
const logger = require('../logger');

class AuditQueueService {
    constructor() {
        this.batch = [];
        this.batchSize = parseInt(process.env.AUDIT_BATCH_SIZE) || 100;
        this.failures = 0;
        this.circuitOpen = false;
        this.threshold = parseInt(process.env.AUDIT_CIRCUIT_BREAKER_THRESHOLD) || 10;

        // Auto-flush every 5 seconds regardless of batch size
        setInterval(() => this.flush(), 5000);
    }

    async logEvent(eventData) {
        if (this.circuitOpen) {
            // If DB is down, strictly output to winston (file) as a fallback
            logger.warn('Audit Circuit Breaker OPEN: Falling back to file-only logging', eventData);
            return;
        }

        this.batch.push({ ...eventData, createdAt: new Date() });

        if (this.batch.length >= this.batchSize) {
            await this.flush();
        }
    }

    async flush() {
        if (this.batch.length === 0) return;

        const currentBatch = [...this.batch];
        this.batch = []; // Clear array rapidly to unblock event loop

        try {
            const values = currentBatch.map(e => [
                e.actor_id || null, // Matches your existing DB column
                e.tenant_id || process.env.DEFAULT_TENANT || null,
                e.action || 'UNKNOWN_ACTION',
                e.entity || null,
                e.entity_id || null,
                e.module || null,
                e.ip_address || null,
                e.user_agent || null,
                e.correlation_id || null,
                e.details ? JSON.stringify(e.details) : null,
                e.previous_value ? JSON.stringify(e.previous_value) : null,
                e.new_value ? JSON.stringify(e.new_value) : null,
                e.createdAt
            ]);

            const query = `
                INSERT INTO audit_logs (
                    actor_id, tenant_id, action, entity, entity_id, module,
                    ip_address, user_agent, correlation_id, details,
                    previous_value, new_value, createdAt
                ) VALUES ?
            `;
            await db.query(query, [values]);

            this.failures = 0;
            this.circuitOpen = false;
        } catch (error) {
            this.failures++;
            // Requeue the batch so we don't drop events!
            this.batch = [...currentBatch, ...this.batch];
            logger.error(`Audit DB Flush Failed (${this.failures}/${this.threshold})`, { error: error.message });

            if (this.failures >= this.threshold) {
                this.circuitOpen = true;
                setTimeout(() => {
                    this.circuitOpen = false;
                    this.failures = 0;
                    logger.info('Audit Circuit Breaker: Retrying DB connection...');
                }, 30000); // Wait 30 seconds before hitting DB again
            }
        }
    }
}
module.exports = new AuditQueueService();
