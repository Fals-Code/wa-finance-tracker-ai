/**
 * Pattern Insight Service
 * Detects dramatic spending fluctuations and patterns
 */

class PatternInsightService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    async getAnomalies(waNumber) {
        const now = new Date();
        const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthStart = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;

        const [thisRows, allLastRows] = await Promise.all([
            this.db.getTransactions(waNumber, thisMonthStart),
            this.db.getTransactions(waNumber, lastMonthStart)
        ]);
        const lastRows = allLastRows.filter(r => new Date(r.tanggal) < new Date(thisMonthStart));

        const thisByKat = this.sumByCategory(thisRows);
        const lastByKat = this.sumByCategory(lastRows);

        let insights = [];

        for (const [kat, total] of Object.entries(thisByKat)) {
            const lastTotal = lastByKat[kat] || 0;
            if (lastTotal > 0) {
                const diffPct = ((total - lastTotal) / lastTotal) * 100;
                if (diffPct > 35 && total > 100000) {
                    insights.push({
                        kategori: kat,
                        diffPct: Math.round(diffPct),
                        total,
                        impact: total - lastTotal
                    });
                }
            }
        }

        if (insights.length === 0) return null;

        let msg = `🚨 *Pola Pengeluaran Terdeteksi*\n━━━━━━━━━━━━━━━━━\n`;
        insights.forEach(insight => {
            msg += `📈 Kategori *${insight.kategori}* naik tajam *${insight.diffPct}%* dibanding bulan lalu.\n`;
            msg += `Kenaikan: Rp ${insight.impact.toLocaleString('id-ID')}\n\n`;
        });

        const top = insights.sort((a,b) => b.diffPct - a.diffPct)[0];
        msg += `💡 *Saran:* Kamu menghabiskan lebih banyak di ${top.kategori}. Cek lagi apakah ada belanja yang bisa dikurangi bulan depan.`;
        
        return msg;
    }

    sumByCategory(rows) {
        const sums = {};
        rows.filter(r => r.tipe !== 'masuk').forEach(r => {
            const kat = r.kategori || 'Lain-lain';
            sums[kat] = (sums[kat] || 0) + parseInt(r.nominal || 0);
        });
        return sums;
    }
}

module.exports = PatternInsightService;
