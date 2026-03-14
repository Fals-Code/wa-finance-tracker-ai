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
        this.logger.info({ waNumber, bulan, nominal }, 'Setting global budget');
        await this.db.setBudget(waNumber, bulan, nominal);
    }

    async setCategoryBudget(waNumber, kategori, nominal) {
        this.logger.info({ waNumber, kategori, nominal }, 'Setting category budget');
        await this.db.setCategoryBudget(waNumber, kategori, nominal);
    }

    async getBudget(waNumber) {
        const bulan = this.getBulanKey();
        return await this.db.getBudget(waNumber, bulan);
    }

    async checkBudgetAlert(waNumber, kategori = null) {
        let alerts = [];

        // 1. Check Global Budget
        const globalBudget = await this.getBudget(waNumber);
        if (globalBudget) {
            const now = new Date();
            const dari = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            const total = await this.db.getTotalKeluar(waNumber, dari);
            const pct = Math.round((total / globalBudget) * 100);
            
            if (pct >= 100) alerts.push(`🚨 *BUDGET BULANAN HABIS!* (Rp ${total.toLocaleString('id-ID')} / Rp ${globalBudget.toLocaleString('id-ID')})`);
            else if (pct >= 90) alerts.push(`⚠️ *Budget Bulanan hampir habis!* ${pct}% terpakai.`);
        }

        // 2. Check Category Budget (specific to the transaction)
        if (kategori) {
            const catBudgets = await this.db.getCategoryBudgets(waNumber);
            const target = catBudgets.find(b => b.kategori.toLowerCase() === kategori.toLowerCase());
            
            if (target) {
                const now = new Date();
                const dari = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                const txs = await this.db.getTransactions(waNumber, dari);
                const totalKat = txs
                    .filter(t => t.tipe !== 'masuk' && t.kategori.toLowerCase() === kategori.toLowerCase())
                    .reduce((s, t) => s + parseInt(t.nominal || 0), 0);
                
                const pctKat = Math.round((totalKat / target.limit_amount) * 100);
                if (pctKat >= 100) alerts.push(`🚨 *BUDGET ${kategori.toUpperCase()} TERLAMPAUI!* (Rp ${totalKat.toLocaleString('id-ID')} / Rp ${target.limit_amount.toLocaleString('id-ID')})`);
                else if (pctKat >= 90) alerts.push(`⚠️ *Budget ${kategori} hampir habis!* ${pctKat}% terpakai.`);
            }
        }
        
        return alerts.length > 0 ? alerts.join('\n\n') : null;
    }
}

module.exports = BudgetService;
