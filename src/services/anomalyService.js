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
        try {
            // Last 3 months for efficiency
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            const dari = threeMonthsAgo.toISOString().split('T')[0];
            
            const transactions = await this.db.getTransactions(waNumber, dari);
            if (!transactions || transactions.length < 10) return false;

            const historical = transactions
                .filter(r => r.tipe !== 'masuk')
                .map(r => parseInt(r.nominal))
                .filter(n => !isNaN(n) && n > 0)
                .slice(0, 100); // cap 100 for safety
            
            if (historical.length < 5) return false;

            const avg = historical.reduce((s, v) => s + v, 0) / historical.length;
            if (nominal > avg * 5 && nominal > 500000) {
                this.logger.warn({ waNumber, nominal, avg: Math.round(avg) }, 'Anomaly detected');
                return true;
            }
            return false;
        } catch (e) {
            this.logger.warn({ err: e.message }, 'Anomaly check failed, skipping');
            return false; // Fail-safe
        }
    }
}

module.exports = AnomalyService;
