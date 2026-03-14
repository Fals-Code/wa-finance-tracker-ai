/**
 * Verification script for refactored WhatsApp Bot
 */

try {
    console.log('🧪 Starting Verification...');

    // 1. Check Integrations
    const supabase = require('./src/integrations/supabaseClient');
    const groq = require('./src/integrations/groqClient');
    console.log('✅ Integrations Loaded');

    // 2. Check Utilities
    const MSG = require('./src/constants/messages');
    const { getState } = require('./src/utils/stateManager');
    const { isLikelyReceipt } = require('./src/utils/receiptParser');
    console.log('✅ Utilities & Constants Loaded');

    // 3. Check Services
    const DatabaseService = require('./src/services/databaseService');
    const AIService = require('./src/services/aiService');
    const OCRService = require('./src/services/ocrService');
    const BudgetService = require('./src/services/budgetService');
    const TransactionService = require('./src/services/transactionService');

    const db = new DatabaseService(supabase);
    const budget = new BudgetService(db);
    const transaction = new TransactionService(db, budget);
    const ai = new AIService(db);
    const ocr = new OCRService();

    console.log('✅ Services Initialized');

    // 4. Check Bot Layer
    const { createBotClient } = require('./src/bot/client');
    const MessageHandler = require('./src/bot/messageHandler');
    const handler = new MessageHandler({ db, budget, transaction, ai, ocr });
    console.log('✅ Bot Layer Loaded');

    console.log('\n🚀 ALL MODULES PASSED IMPORT & INIT TEST!\n');
    process.exit(0);

} catch (err) {
    console.error('\n❌ VERIFICATION FAILED!');
    console.error(err);
    process.exit(1);
}
