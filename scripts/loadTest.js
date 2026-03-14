/**
 * Simple Load Test Script
 * Simulates multiple message requests to the handler
 */
const { metrics } = require('../src/utils/metrics');

async function runLoadTest(handler, count = 50) {
    console.log(`🚀 Starting Load Test with ${count} messages...`);
    const startTime = Date.now();
    
    const messages = Array.from({ length: count }, (_, i) => ({
        from: `user_${i % 5}@c.us`,
        body: 'Makan Siang 25000',
        reply: async (text) => { /* console.log(`Reply to ${i}: ${text.substring(0, 20)}...`); */ },
        getContact: async () => ({ number: `user_${i % 5}`, pushname: `User ${i % 5}` })
    }));

    const results = await Promise.allSettled(messages.map(m => handler.handle(m)));
    
    const duration = (Date.now() - startTime) / 1000;
    const success = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`\n📊 Load Test Results:`);
    console.log(`- Total Messages: ${count}`);
    console.log(`- Success: ${success}`);
    console.log(`- Failed: ${failed}`);
    console.log(`- Duration: ${duration.toFixed(2)}s`);
    console.log(`- Avg Speed: ${(count / duration).toFixed(2)} msgs/s`);
}

// NOTE: This usually needs a mocked environment to run standalone
// module.exports = runLoadTest;
