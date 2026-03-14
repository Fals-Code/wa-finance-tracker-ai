/**
 * WhatsApp Finance Tracker Bot - Advanced Production Entry Point
 * Composition Root
 */

require('dotenv').config()

const express = require('express')

const { register, metrics } = require('./utils/metrics')
const logger = require('./utils/logger')

const { createBotClient } = require('./bot/client')
const MessageHandler = require('./bot/messageHandler')

const MSG = require('./constants/messages')

// Config
const env = require('./config/env')

// Database
const supabase = require('./config/database')

/* ================================
   REPOSITORIES
================================ */

const TransactionRepository = require('./repositories/transactionRepository')
const UserRepository = require('./repositories/userRepository')
const CategoryRepository = require('./repositories/categoryRepository')
const BudgetRepository = require('./repositories/budgetRepository')
const OTPRepository = require('./repositories/otpRepository')

const repositories = {
  transaction: new TransactionRepository(supabase, logger),
  user: new UserRepository(supabase, logger),
  category: new CategoryRepository(supabase, logger),
  budget: new BudgetRepository(supabase, logger),
  otp: new OTPRepository(supabase, logger)
}

/* ================================
   SERVICES
================================ */

const DatabaseService = require('./services/databaseService')
const AIService = require('./services/aiService')
const OCRService = require('./services/ocrService')
const BudgetService = require('./services/budgetService')
const TransactionService = require('./services/transactionService')
const CategoryService = require('./services/categoryService')
const ExportService = require('./services/exportService')

const ReportService = require('./services/reportService')
const InsightService = require('./services/insightService')
const AILearningService = require('./services/aiLearningService')
const StatsService = require('./services/statsService')
const SemanticAIService = require('./services/semanticAIService')
const PatternInsightService = require('./services/patternInsightService')
const PredictionService = require('./services/predictionService')
const CoachService = require('./services/coachService')
const HealthScoreService = require('./services/healthScoreService')
const AnomalyService = require('./services/anomalyService')
const DashboardService = require('./services/dashboardService')
const OTPService = require('./services/otpService')

const dbService = new DatabaseService(repositories, logger)

const budgetService = new BudgetService(dbService, logger)
const transactionService = new TransactionService(dbService, budgetService, logger)
const aiService = new AIService({ db: dbService, logger })
const ocrService = new OCRService(logger)
const categoryService = new CategoryService(dbService, logger)
const exportService = new ExportService(supabase, logger)

const reportService = new ReportService(dbService, logger)
const insightService = new InsightService(dbService, logger)
const aiLearningService = new AILearningService(repositories, logger)
const statsService = new StatsService(dbService, logger)
const semanticAI = new SemanticAIService(dbService, logger)
const patternInsight = new PatternInsightService(dbService, logger)
const predictionService = new PredictionService(dbService, logger)
const coachService = new CoachService(dbService, logger)
const healthScoreService = new HealthScoreService(dbService, logger)
const anomalyService = new AnomalyService(dbService, logger)
const dashboardService = new DashboardService(dbService, logger)
const otpService = new OTPService(repositories.otp, logger)

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
  semanticAI,
  patternInsight,
  prediction: predictionService,
  coach: coachService,
  health: healthScoreService,
  anomaly: anomalyService,
  dashboard: dashboardService,
  otp: otpService
}

/* ================================
   CONTROLLERS
================================ */

const TransactionController = require('./controllers/transactionController')
const ReportController = require('./controllers/reportController')
const BudgetController = require('./controllers/budgetController')
const CategoryController = require('./controllers/categoryController')
const MediaController = require('./controllers/mediaController')

const controllers = {
  transaction: new TransactionController(services, logger),
  report: new ReportController(services, logger),
  budget: new BudgetController(services, logger),
  category: new CategoryController(services, logger),
  media: new MediaController(services, logger)
}

/* ================================
   BOT CLIENT
================================ */

const client = createBotClient()
const handler = new MessageHandler(controllers, services, logger)

/* ================================
   EXPRESS SERVER
================================ */

const app = express()
const port = process.env.PORT || 3000

app.use(express.json())

/* ================================
   OTP LOGIN API
================================ */

app.post('/api/send-login-code', async (req, res) => {

  const { waNumber } = req.body

  if (!waNumber) {
    return res.status(400).json({ error: 'waNumber required' })
  }

  try {

    const code = await otpService.generateOTP(waNumber)

    const target = waNumber.includes('@')
      ? waNumber
      : `${waNumber}@c.us`

    await client.sendMessage(
      target,
      MSG.otpMessage(code)
    )

    logger.info({ event: 'otp_sent', waNumber })

    res.json({ success: true })

  } catch (err) {

    logger.error({ event: 'otp_failed', err: err.message })

    res.status(500).json({
      error: 'Terjadi kesalahan saat mengirim kode'
    })

  }

})

/* ================================
   HEALTH CHECK
================================ */

app.get('/health', (req, res) => {

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  })

})

/* ================================
   PROMETHEUS METRICS
================================ */

app.get('/metrics', async (req, res) => {

  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())

})

const server = app.listen(port, () => {

  logger.info({
    event: 'server_started',
    port
  }, `Server running on ${port}`)

})

/* ================================
   BOT EVENTS
================================ */

client.on('ready', async () => {

  logger.info({ event: 'bot_online' }, 'Bot is ONLINE')

  await aiService.loadDataset().catch(e => {
    logger.error(e)
  })

})

client.on('message', async (msg) => {

  try {

    metrics.messageCounter.inc({ status: 'received' })

    await handler.handle(msg)

  } catch (err) {

    metrics.errorCounter.inc({ type: 'message_handling' })

    logger.error(err)

  }

})

/* ================================
   GRACEFUL SHUTDOWN
================================ */

function shutdown(signal) {

  logger.info(`Shutdown via ${signal}`)

  server.close(() => {

    client.destroy().then(() => {

      process.exit(0)

    })

  })

}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

/* ================================
   START BOT
================================ */

client.initialize()