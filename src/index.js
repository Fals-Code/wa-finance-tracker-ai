/**
 * WhatsApp Finance Tracker Bot - Advanced Production Entry Point
 * Final Architectural Wiring (Composition Root)
 */

const express = require('express');
const { register, metrics } = require('./utils/metrics');
const logger = require('./utils/logger');
const { createBotClient } = require('./bot/client');
const MessageHandler = require('./bot/messageHandler');
const ReportService = require('./services/reportService');
const InsightService = require('./services/insightService');
const AILearningService = require('./services/aiLearningService');
const StatsService = require('./services/statsService');
const SemanticAIService = require('./services/semanticAIService');
const PatternInsightService = require('./services/patternInsightService');
const PredictionService = require('./services/predictionService');
const CoachService = require('./services/coachService');
const HealthScoreService = require('./services/healthScoreService');
const AnomalyService = require('./services/anomalyService');
const DashboardService = require('./services/dashboardService');

// 1. Config Layer
const env = require('./config/env');
require('dotenv').config(); // redundantly called in env.js but safe

// 2. Integration / Database Connection
const supabase = require('./config/database');

// 3. Repository Layer
const TransactionRepository = require('./repositories/transactionRepository');
const UserRepository = require('./repositories/userRepository');
const CategoryRepository = require('./repositories/categoryRepository');
const BudgetRepository = require('./repositories/budgetRepository');

const repositories = {
    transaction: new TransactionRepository(supabase, logger),
    user: new UserRepository(supabase, logger),
    category: new CategoryRepository(supabase, logger),
    budget: new BudgetRepository(supabase, logger),
};

// 4. Service Layer
const DatabaseService = require('./services/databaseService');
const AIService = require('./services/aiService');
const OCRService = require('./services/ocrService');
const BudgetService = require('./services/budgetService');
const TransactionService = require('./services/transactionService');
const CategoryService = require('./services/categoryService');
const ExportService = require('./services/exportService');

const dbService = new DatabaseService(repositories, logger);
const budgetService = new BudgetService(dbService, logger);
const transactionService = new TransactionService(dbService, budgetService, logger);
const aiService = new AIService({ db: dbService, logger });
const ocrService = new OCRService(logger);
const categoryService = new CategoryService(dbService, logger);
const exportService = new ExportService(supabase, logger); // Export still uses direct client for simple queries/python

const reportService = new ReportService(dbService, logger);
const insightService = new InsightService(dbService, logger);
const aiLearningService = new AILearningService(repositories, logger);
const statsService = new StatsService(dbService, logger);
const semanticAI = new SemanticAIService(dbService, logger);
const patternInsight = new PatternInsightService(dbService, logger);
const predictionService = new PredictionService(dbService, logger);
const coachService = new CoachService(dbService, logger);
const healthScoreService = new HealthScoreService(dbService, logger);
const anomalyService = new AnomalyService(dbService, logger);
const dashboardService = new DashboardService(dbService, logger);

const services = {
    db: dbService,
    budget: budgetService,
    transaction: transactionService,
    ai: aiService,
    ocr: ocrService,
    category: categoryService,
    export: exportService,
    report: reportService,
    insight: insightService,
    aiLearning: aiLearningService,
    stats: statsService,
    semanticAI: semanticAI,
    patternInsight: patternInsight,
    prediction: predictionService,
    coach: coachService,
    health: healthScoreService,
    anomaly: anomalyService,
    dashboard: dashboardService
};

// 5. Controllers
const TransactionController = require('./controllers/transactionController');
const ReportController = require('./controllers/reportController');
const BudgetController = require('./controllers/budgetController');
const CategoryController = require('./controllers/categoryController');
const MediaController = require('./controllers/mediaController');

const controllers = {
    transaction: new TransactionController(services, logger),
    report: new ReportController(services, logger),
    budget: new BudgetController(services, logger),
    category: new CategoryController(services, logger),
    media: new MediaController(services, logger)
};

// 6. Jobs & Scheduler
const DailyReportJob = require('./jobs/dailyReportJob');
const BudgetReminderJob = require('./jobs/budgetReminderJob');
const CleanupTempFilesJob = require('./jobs/cleanupTempFilesJob');

const jobs = {
    dailyReport: new DailyReportJob(null, supabase, logger),
    budgetReminder: new BudgetReminderJob(null, budgetService, logger),
    cleanup: new CleanupTempFilesJob(logger)
};

const client = createBotClient();
jobs.dailyReport.client = client;
jobs.budgetReminder.client = client;

const handler = new MessageHandler(controllers, services, logger);
const NotificationScheduler = require('./scheduler/notificationScheduler');
const scheduler = new NotificationScheduler({ client, logger, jobs });

// 7. Express Server for Monitoring
const app = express();
const port = process.env.PORT || 3000;

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (ex) {
        res.status(500).end(ex);
    }
});

const server = app.listen(port, () => {
    logger.info({ event: 'server_started', port }, `Health check server running on port ${port}`);
});

// 8. Global Event Handlers
client.on('ready', async () => {
    logger.info({ event: 'bot_online' }, '🚀 Advanced Production Bot is ONLINE');
    
    // Warm up AI dataset
    await aiService.loadDataset().catch(e => {
        logger.error({ event: 'ai_warmup_failed', err: e.message }, 'AI Dataset warm-up failed');
        metrics.errorCounter.inc({ type: 'ai_warmup' });
    });
    
    // Start Scheduler
    scheduler.init();
});

client.on('message', async (msg) => {
    try {
        metrics.messageCounter.inc({ status: 'received' });
        await handler.handle(msg);
    } catch (err) {
        metrics.errorCounter.inc({ type: 'message_handling' });
        logger.error({ event: 'message_handling_failed', err: err.message, stack: err.stack }, 'Message Handling Exception');
        try {
            await msg.reply('⚠️ Maaf, terjadi gangguan teknis. Hubungi admin jika masalah berlanjut.');
        } catch (_) {}
    }
});

// 9. Global Error Boundary
process.on('unhandledRejection', (reason, promise) => {
    metrics.errorCounter.inc({ type: 'unhandled_rejection' });
    logger.error({ event: 'unhandled_rejection', reason, promise }, 'Unhandled Rejection at Promise');
});

process.on('uncaughtException', (error) => {
    metrics.errorCounter.inc({ type: 'uncaught_exception' });
    logger.error({ event: 'uncaught_exception', error: error.message, stack: error.stack }, 'Uncaught Exception');
    gracefulShutdown('uncaughtException');
});

// 10. Graceful Shutdown
function gracefulShutdown(signal) {
    logger.info({ event: 'shutdown_initiated', signal }, `Shutdown initiated via ${signal}`);
    
    server.close(() => {
        logger.info({ event: 'http_server_closed' }, 'HTTP server closed');
        
        client.destroy().then(() => {
            logger.info({ event: 'bot_client_destroyed' }, 'WhatsApp client destroyed');
            process.exit(0);
        }).catch(err => {
            logger.error({ event: 'bot_cleanup_failed', err: err.message }, 'Error during WhatsApp client destruction');
            process.exit(1);
        });
    });

    // Forced shutdown after 10s
    setTimeout(() => {
        logger.error({ event: 'shutdown_forced' }, 'Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 11. Bootstrap
client.initialize();
