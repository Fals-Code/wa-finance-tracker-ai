/**
 * Budget Service handling budget alerts and calculations
 */

class BudgetService {
    constructor(databaseService, logger) {
        this.db = databaseService;
        this.logger = logger;
    }

    getBulanKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    async setBudget(waNumber, nominal) {
        const bulan = this.getBulanKey();
        this.logger.info({ waNumber, bulan, nominal }, 'Setting budget');
        await this.db.setBudget(waNumber, bulan, nominal);
    }

    async getBudget(waNumber) {
        const bulan = this.getBulanKey();
        return await this.db.getBudget(waNumber, bulan);
    }

    async checkBudgetAlert(waNumber) {
        const budget = await this.getBudget(waNumber);
        if (!budget) return null;

        const now = new Date();
        const dari = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const total = await this.db.getTotalKeluar(waNumber, dari);
        
        const pct = Math.round((total / budget) * 100);
        this.logger.debug({ waNumber, pct, total, budget }, 'Budget checking');

        if (pct >= 100) return `🚨 *BUDGET HABIS!*\nPengeluaran Rp ${total.toLocaleString('id-ID')} dari budget Rp ${budget.toLocaleString('id-ID')} (${pct}%)`;
        if (pct >= 90) return `⚠️ *Budget hampir habis!* ${pct}% terpakai\nSisa: Rp ${(budget - total).toLocaleString('id-ID')}`;
        if (pct >= 75) return `📊 Budget ${pct}% terpakai. Sisa: Rp ${(budget - total).toLocaleString('id-ID')}`;
        
        return null;
    }
}

module.exports = BudgetService;
