/**
 * Insight Service
 * Generates AI-driven financial comparisons and tips
 */

class InsightService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    async getMonthlyInsight(waNumber) {
        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        
        const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const lastMonthStart = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;

        const [thisMonth, lastMonthRows] = await Promise.all([
            this.db.getTransactions(waNumber, thisMonthStart),
            this.db.getTransactions(waNumber, lastMonthStart)
        ]);

        // Filter last month's rows to only include that specific month
        const lastMonthOnly = lastMonthRows.filter(r => new Date(r.tanggal) < new Date(thisMonthStart));

        const thisTotal = thisMonth.filter(r => r.tipe !== 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const lastTotal = lastMonthOnly.filter(r => r.tipe !== 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);

        const diff = thisTotal - lastTotal;
        const diffPercent = lastTotal > 0 ? Math.round((diff / lastTotal) * 100) : 0;

        let msg = `📈 *Insight Keuangan Bulan Ini*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `Total bulan ini : Rp ${thisTotal.toLocaleString('id-ID')}\n`;
        
        if (lastTotal > 0) {
            const trend = diff > 0 ? 'naik 🔺' : 'turun 🔻';
            msg += `Perbandingan  : ${trend} ${Math.abs(diffPercent)}% dibanding bulan lalu\n`;
        }

        // Find top category
        const byKat = {};
        thisMonth.forEach(r => {
            if (r.tipe !== 'masuk') {
                const kat = r.kategori || 'Lain-lain';
                byKat[kat] = (byKat[kat] || 0) + parseInt(r.nominal || 0);
            }
        });

        const sorted = Object.entries(byKat).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
            msg += `\n🏆 *Pengeluaran Terbesar:* ${sorted[0][0]} (Rp ${sorted[0][1].toLocaleString('id-ID')})\n`;
        }

        msg += `\n💡 *Tips Keuangan:*\n`;
        if (diff > 0 && diffPercent > 10) {
            msg += `• Pengeluaranmu naik tajam! Coba cek catatan belanja kategori ${sorted[0]?.[0]} untuk mencari pemborosan.\n`;
        } else if (diff < 0) {
            msg += `• Bagus! Kamu berhasil berhemat Rp ${Math.abs(diff).toLocaleString('id-ID')} dibanding bulan lalu. Pertahankan!\n`;
        } else {
            msg += `• Pengeluaranmu stabil. Pastikan tabungan tetap terisi ya!\n`;
        }

        return msg;
    }
}

module.exports = InsightService;
