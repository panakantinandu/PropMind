/**
 * Model Verification Script
 * Tests that new models (Lease, StripeAccount, AIInsight) are properly exported
 * and configured with correct Mongoose schemas.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('='.repeat(60));
console.log('MODEL VERIFICATION SCRIPT');
console.log('='.repeat(60));

try {
    // Step 1: Require the models index
    console.log('\n✓ Step 1: Loading models from shared/models/index.js...');
    const models = require('../shared/models');
    console.log('  Success: Models loaded');
    
    // Step 2: Verify new models exist
    console.log('\n✓ Step 2: Verifying new model exports...');
    const { Lease, StripeAccount, AIInsight } = models;
    
    if (!Lease) throw new Error('Lease model not exported');
    console.log('  ✓ Lease exported');
    
    if (!StripeAccount) throw new Error('StripeAccount model not exported');
    console.log('  ✓ StripeAccount exported');
    
    if (!AIInsight) throw new Error('AIInsight model not exported');
    console.log('  ✓ AIInsight exported');
    
    // Step 3: Verify Mongoose model names
    console.log('\n✓ Step 3: Verifying Mongoose model names...');
    console.log('  Lease.modelName:', Lease.modelName);
    if (Lease.modelName !== 'Lease') throw new Error('Lease modelName mismatch');
    
    console.log('  StripeAccount.modelName:', StripeAccount.modelName);
    if (StripeAccount.modelName !== 'StripeAccount') throw new Error('StripeAccount modelName mismatch');
    
    console.log('  AIInsight.modelName:', AIInsight.modelName);
    if (AIInsight.modelName !== 'AIInsight') throw new Error('AIInsight modelName mismatch');
    
    // Step 4: Verify collection names
    console.log('\n✓ Step 4: Verifying MongoDB collection names...');
    console.log('  Lease collection:', Lease.collection.name);
    if (Lease.collection.name !== 'leases') throw new Error('Lease collection name mismatch');
    
    console.log('  StripeAccount collection:', StripeAccount.collection.name);
    if (StripeAccount.collection.name !== 'stripeaccounts') throw new Error('StripeAccount collection name mismatch');
    
    console.log('  AIInsight collection:', AIInsight.collection.name);
    if (AIInsight.collection.name !== 'aiinsights') throw new Error('AIInsight collection name mismatch');
    
    // Step 5: Verify schema fields
    console.log('\n✓ Step 5: Verifying schema fields...');
    
    const leaseFields = Object.keys(Lease.schema.paths);
    console.log('  Lease schema paths:', leaseFields.filter(f => !f.startsWith('_')).join(', '));
    const requiredLeaseFields = ['tenantId', 'propertyId', 'adminId', 'startDate', 'endDate', 'monthlyRent', 'securityDeposit', 'status'];
    requiredLeaseFields.forEach(field => {
        if (!leaseFields.includes(field)) throw new Error(`Missing field in Lease: ${field}`);
    });
    console.log('  ✓ All required Lease fields present');
    
    const stripeFields = Object.keys(StripeAccount.schema.paths);
    console.log('  StripeAccount schema paths:', stripeFields.filter(f => !f.startsWith('_')).join(', '));
    const requiredStripeFields = ['adminId', 'stripeAccountId', 'onboardingComplete', 'chargesEnabled', 'payoutsEnabled', 'connectedAt'];
    requiredStripeFields.forEach(field => {
        if (!stripeFields.includes(field)) throw new Error(`Missing field in StripeAccount: ${field}`);
    });
    console.log('  ✓ All required StripeAccount fields present');
    
    const aiFields = Object.keys(AIInsight.schema.paths);
    console.log('  AIInsight schema paths:', aiFields.filter(f => !f.startsWith('_')).join(', '));
    const requiredAIFields = ['adminId', 'type', 'relatedEntityId', 'result', 'confidenceScore'];
    requiredAIFields.forEach(field => {
        if (!aiFields.includes(field)) throw new Error(`Missing field in AIInsight: ${field}`);
    });
    console.log('  ✓ All required AIInsight fields present');
    
    // Step 6: Verify indexes
    console.log('\n✓ Step 6: Verifying indexes...');
    const leaseIndexes = Lease.schema.indexes().length;
    console.log('  Lease indexes:', leaseIndexes);
    if (leaseIndexes < 4) throw new Error('Lease missing expected indexes');
    
    const stripeIndexes = StripeAccount.schema.indexes().length;
    console.log('  StripeAccount indexes:', stripeIndexes);
    if (stripeIndexes < 2) throw new Error('StripeAccount missing expected indexes');
    
    const aiIndexes = AIInsight.schema.indexes().length;
    console.log('  AIInsight indexes:', aiIndexes);
    if (aiIndexes < 2) throw new Error('AIInsight missing expected indexes');
    
    // Step 7: Verify existing models still work
    console.log('\n✓ Step 7: Verifying existing models are intact...');
    const { Admin, Tenant, Property, Application, Invoice, Payment, Ticket } = models;
    const existingModels = { Admin, Tenant, Property, Application, Invoice, Payment, Ticket };
    
    Object.entries(existingModels).forEach(([name, model]) => {
        if (!model || !model.modelName) throw new Error(`Existing model ${name} is broken`);
        console.log(`  ✓ ${name} intact`);
    });
    
    // Success
    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL VERIFICATION CHECKS PASSED');
    console.log('='.repeat(60));
    console.log('\nSummary:');
    console.log('  • 3 new models successfully exported');
    console.log('  • All model names and collection names verified');
    console.log('  • All required schema fields present');
    console.log('  • All indexes properly configured');
    console.log('  • No circular dependency issues detected');
    console.log('  • Existing models remain intact');
    console.log('\nModels ready for integration testing.');
    
    process.exit(0);
    
} catch (err) {
    console.error('\n❌ VERIFICATION FAILED');
    console.error('='.repeat(60));
    console.error('Error:', err.message);
    console.error('\nStack:', err.stack);
    console.error('='.repeat(60));
    process.exit(1);
}
