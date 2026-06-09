const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function test() {
    try {
        console.log('Testing stripe express account creation...');
        const account = await stripe.accounts.create({
            type:    'express',
            email:   'test@example.com',
            capabilities: {
                card_payments: { requested: true },
                transfers:     { requested: true }
            },
            business_type: 'individual',
            metadata: { adminId: '123' }
        });
        console.log('Account created:', account.id);
    } catch (e) {
        console.error('Error:', e);
    }
}
test();
