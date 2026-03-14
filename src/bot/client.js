/**
 * WhatsApp Client Initialization
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

function createBotClient() {
    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            timeout: 60000,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        },
    });

    let qrCount = 0;
    client.on('qr', qr => {
        qrCount++;
        console.log(`\n📱 Scan QR Code (percobaan ke-${qrCount}):\n`);
        qrcode.generate(qr, { small: true });
        if (qrCount >= 3) {
            console.warn('⚠️ QR sudah di-refresh 3x dan tidak di-scan. Bot akan berhenti.');
            process.exit(0);
        }
    });

    client.on('auth_failure', errMsg => {
        console.error('❌ Auth gagal:', errMsg);
        process.exit(1);
    });

    client.on('disconnected', reason => {
        console.warn('⚠️ Bot terputus:', reason);
        process.exit(0);
    });

    return client;
}

module.exports = { createBotClient };
