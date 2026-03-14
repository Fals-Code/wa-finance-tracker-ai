/**
 * Anomaly Detection Service
 * Detects unusually large transactions
 */

class AnomalyService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    /**
     * Checks if a new transaction is an anomaly
     */
    async checkAnomaly(waNumber, nominal) {
        const transactions = await this.db.getTransactions(waNumber);
        if (transactions.length < 10) return false;

        const historical = transactions
            .filter(r => r.tipe !== 'masuk')
            .map(r => parseInt(r.nominal));
        
        if (historical.length < 5) return false;

        const avg = historical.reduce((s, v) => s + v, 0) / historical.length;
        
        // If nominal is 5x the average and > 500k
        if (nominal > avg * 5 && nominal > 500000) {
            this.logger.warn({ waNumber, nominal, avg }, 'Anomaly detected: Large transaction');
            return true;
        }

        return false;
    }
}

module.exports = AnomalyService;
