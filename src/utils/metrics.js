const client = require('prom-client');

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'wa-finance-bot'
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
const messageCounter = new client.Counter({
  name: 'wa_bot_messages_total',
  help: 'Total number of incoming messages',
  labelNames: ['status']
});

const transactionCounter = new client.Counter({
  name: 'wa_bot_transactions_total',
  help: 'Total number of transactions processed',
  labelNames: ['type', 'category']
});

const ocrCounter = new client.Counter({
  name: 'wa_bot_ocr_processed_total',
  help: 'Total number of OCR operations',
  labelNames: ['result']
});

const errorCounter = new client.Counter({
  name: 'wa_bot_errors_total',
  help: 'Total number of errors',
  labelNames: ['type']
});

register.registerMetric(messageCounter);
register.registerMetric(transactionCounter);
register.registerMetric(ocrCounter);
register.registerMetric(errorCounter);

module.exports = {
  register,
  metrics: {
    messageCounter,
    transactionCounter,
    ocrCounter,
    errorCounter
  }
};
