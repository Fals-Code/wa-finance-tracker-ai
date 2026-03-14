/**
 * AI Prediction Service
 * Analyzes transaction patterns to predict future habits
 */

class PredictionService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    /**
     * Analyzes historical patterns to predict frequent transactions
     */
    async predictPatterns(waNumber) {
        this.logger.info({ waNumber }, 'Analyzing transaction patterns for prediction');

        const transactions = await this.db.getTransactions(waNumber);
        if (transactions.length < 5) return null;

        const patterns = {};

        transactions.forEach(r => {
            if (r.tipe !== 'masuk') {
                const date = new Date(r.tanggal);
                const day = date.getDay(); // 0-6 (Sun-Sat)
                const hour = r.created_at ? new Date(r.created_at).getHours() : -1;
                const key = `${r.nama_toko || r.deskripsi}`;

                if (!patterns[key]) patterns[key] = { counts: 0, days: {}, hours: [] };
                patterns[key].counts++;
                patterns[key].days[day] = (patterns[key].days[day] || 0) + 1;
                if (hour !== -1) patterns[key].hours.push(hour);
            }
        });

        const insights = [];
        for (const [name, stats] of Object.entries(patterns)) {
            if (stats.counts >= 3) {
                // Check for day regularity
                const topDay = Object.entries(stats.days).sort((a,b) => b[1] - a[1])[0];
                const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                
                // Check for time regularity
                const avgHour = stats.hours.length > 0 ? Math.round(stats.hours.reduce((s, h) => s + h, 0) / stats.hours.length) : null;

                if (topDay[1] >= stats.counts * 0.6) {
                    insights.push(`☕ Kamu biasanya beli *${name}* setiap hari *${dayNames[topDay[0]]}*.`);
                } else if (avgHour !== null && stats.counts >= 4) {
                    insights.push(`🕒 Kamu sering belanja *${name}* sekitar jam *${String(avgHour).padStart(2, '0')}:00*.`);
                }
            }
        }

        return insights.length > 0 ? insights : null;
    }
}

module.exports = PredictionService;
