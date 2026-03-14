/**
 * Financial Health Score Service
 * Calculates health metrics (Saving Rate, Expense Ratio, Budget Discipline)
 */

class HealthScoreService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    async calculateScore(waNumber) {
        const now = new Date();
        const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const bulanKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        const [txs, budget] = await Promise.all([
            this.db.getTransactions(waNumber, start),
            this.db.getBudget(waNumber, bulanKey)
        ]);

        if (txs.length === 0) return { score: 0, label: 'Belum Ada Data' };

        const masuk = txs.filter(r => r.tipe === 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const keluar = txs.filter(r => r.tipe !== 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);

        // 1. Saving Rate (40%)
        const savingRate = masuk > 0 ? Math.max(0, (masuk - keluar) / masuk) : 0;
        const savingScore = Math.min(40, savingRate * 100 * 0.4 * 2); // Max at 50% saving rate

        // 2. Budget Discipline (30%)
        let budgetScore = 30;
        if (budget > 0) {
            const usage = keluar / budget;
            if (usage > 1) budgetScore = Math.max(0, 30 - (usage - 1) * 30);
            else if (usage > 0.9) budgetScore = 20;
        }

        // 3. Activity & Distribution (30%)
        const activityScore = Math.min(30, (txs.length / 20) * 30); // 20 txs a month is healthy recording

        const totalScore = Math.round(savingScore + budgetScore + activityScore);
        
        let label = 'Need Improvement 🔴';
        if (totalScore >= 80) label = 'Excellent! 🟢';
        else if (totalScore >= 60) label = 'Good 🟡';
        else if (totalScore >= 40) label = 'Fair 🟠';

        return {
            score: totalScore,
            label,
            metrics: {
                savingRate: Math.round(savingRate * 100),
                budgetUsage: budget > 0 ? Math.round((keluar/budget)*100) : 0,
                txCount: txs.length
            }
        };
    }
}

module.exports = HealthScoreService;
