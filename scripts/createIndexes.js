/**
 * MongoDB Index Definitions
 * 
 * Run this script once to create compound indexes that dramatically improve
 * query performance for the most common access patterns.
 * 
 * Usage:  node shared/scripts/createIndexes.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { connect } = require('../shared/config/db');
const mongoose = require('mongoose');

// Import all models so their schemas are registered
require('../shared/models');

const indexes = [
    // Invoice lookups (tenant invoices page, cron jobs)
    { collection: 'invoices', index: { tenantId: 1, status: 1, createdAt: -1 } },
    { collection: 'invoices', index: { tenantId: 1, type: 1, month: 1 }, options: { name: 'idx_tenant_type_month' } },
    { collection: 'invoices', index: { propertyId: 1, status: 1 } },
    { collection: 'invoices', index: { dueDate: 1, status: 1 } },

    // Payment lookups (webhook idempotency, tenant payment history)
    { collection: 'payments', index: { invoiceId: 1, tenantId: 1, status: 1 } },
    { collection: 'payments', index: { stripePaymentIntentId: 1 }, options: { unique: true, sparse: true } },
    { collection: 'payments', index: { tenantId: 1, createdAt: -1 } },

    // Property queries (available listings, admin property list)
    { collection: 'properties', index: { status: 1, isDeleted: 1 } },
    { collection: 'properties', index: { adminId: 1, status: 1 } },
    { collection: 'properties', index: { tenantId: 1 }, options: { sparse: true } },

    // Application lookups (tenant applications, admin review queue)
    { collection: 'applications', index: { applicantId: 1, status: 1, isDeleted: 1 } },
    { collection: 'applications', index: { propertyId: 1, status: 1, isDeleted: 1 } },
    { collection: 'applications', index: { status: 1, expiresAt: 1 } },

    // Tenant lookups
    { collection: 'tenants', index: { email: 1 }, options: { unique: true } },
    { collection: 'tenants', index: { adminId: 1, status: 1 } },

    // Audit logs (admin actions, compliance)
    { collection: 'auditlogs', index: { userId: 1, createdAt: -1 } },
    { collection: 'auditlogs', index: { entity: 1, entityId: 1 } },

    // Notifications
    { collection: 'notifications', index: { userId: 1, read: 1, createdAt: -1 } },

    // Ledger
    { collection: 'ledgerentries', index: { tenantId: 1, createdAt: -1 } },
];

async function createIndexes() {
    await connect();
    const db = mongoose.connection.db;

    console.log('Creating indexes...\n');

    for (const def of indexes) {
        try {
            const opts = { background: true, ...def.options };
            await db.collection(def.collection).createIndex(def.index, opts);
            const indexKeys = Object.keys(def.index).join(', ');
            console.log(`  ✅ ${def.collection}: { ${indexKeys} }`);
        } catch (err) {
            // Index already exists or collection doesn't exist yet—both are fine
            if (err.codeName === 'IndexOptionsConflict') {
                console.log(`  ⚠️  ${def.collection}: index exists with different options, skipping.`);
            } else {
                console.error(`  ❌ ${def.collection}: ${err.message}`);
            }
        }
    }

    console.log('\nDone.');
    process.exit(0);
}

createIndexes();
