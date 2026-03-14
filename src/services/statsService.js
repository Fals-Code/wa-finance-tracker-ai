/**
 * Stats Service
 * Provides deep financial metrics and analytics
 */

class StatsService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    async getStats(waNumber) {
        const now = new Date();
        const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        
        const allRows = await this.db.getTransactions(waNumber);
        const monthRows = allRows.filter(r => new Date(r.tanggal) >= new Date(startOfMonth));

        const totalTrx = allRows.length;
        const totalKeluar = allRows.filter(r => r.tipe !== 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const totalMasuk = allRows.filter(r => r.tipe === 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        
        const monthKeluar = monthRows.filter(r => r.tipe !== 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const monthMasuk = monthRows.filter(r => r.tipe === 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);

        // Top Categories this month
        const byKat = {};
        monthRows.filter(r => r.tipe !== 'masuk').forEach(r => {
            const kat = r.kategori || 'Lain-lain';
            byKat[kat] = (byKat[kat] || 0) + parseInt(r.nominal || 0);
        });

        const topCats = Object.entries(byKat)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

        let msg = `📊 *Statistik Keuangan*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `🔢 Total Transaksi: ${totalTrx}\n`;
        msg += `💰 Total Saldo (All): Rp ${(totalMasuk - totalKeluar).toLocaleString('id-ID')}\n\n`;
        
        msg += `🏢 *Bulan Ini:*\n`;
        msg += `💸 Pengeluaran: Rp ${monthKeluar.toLocaleString('id-ID')}\n`;
        msg += `💰 Pemasukan  : Rp ${monthMasuk.toLocaleString('id-ID')}\n`;
        msg += `⚖️ Saldo       : Rp ${(monthMasuk - monthKeluar).toLocaleString('id-ID')}\n\n`;

        if (topCats.length > 0) {
            msg += `🏆 *Top Kategori (Bulan Ini):*\n`;
            topCats.forEach(([kat, nom], i) => {
                msg += `${i+1}. ${kat}: Rp ${nom.toLocaleString('id-ID')}\n`;
            });
        }

        return msg;
    }
}

module.exports = StatsService;
