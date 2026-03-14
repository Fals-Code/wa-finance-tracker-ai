/**
 * Dashboard Analytics Engine
 * Provides data for SaaS UI
 */

class DashboardService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    async getCoreAnalytics() {
        this.logger.info('Fetching global dashboard analytics');
        
        const totals = await this.db.getTransactions(null);
        
        const totalKeluar = totals?.filter(r => r.tipe !== 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0) || 0;
        const totalMasuk = totals?.filter(r => r.tipe === 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0) || 0;

        return {
            totalUsers: 1, // Mockup for now
            totalTransactions: totals?.length || 0,
            totalIncome: totalMasuk,
            totalExpense: totalKeluar,
            activeNow: 1
        };
    }
}

module.exports = DashboardService;
