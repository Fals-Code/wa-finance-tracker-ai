/**
 * Financial Report Service
 * Generates harian, mingguan, and bulanan summaries
 */

class ReportService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    async getDailyReport(waNumber) {
        const today = new Date().toISOString().split('T')[0];
        const rows = await this.db.getTransactions(waNumber, today);
        return this.formatSummary('Hari Ini', rows);
    }

    async getWeeklyReport(waNumber) {
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        const rows = await this.db.getTransactions(waNumber, lastWeek.toISOString().split('T')[0]);
        return this.formatSummary('Minggu Ini', rows);
    }

    async getMonthlyReport(waNumber) {
        const now = new Date();
        const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const rows = await this.db.getTransactions(waNumber, startOfMonth);
        return this.formatSummary('Bulan Ini', rows);
    }

    formatSummary(periodLabel, rows) {
        if (!rows || rows.length === 0) return `📭 Belum ada transaksi ${periodLabel.toLowerCase()}.`;

        const keluar = rows.filter(r => r.tipe !== 'masuk');
        const masuk = rows.filter(r => r.tipe === 'masuk');
        
        const totalKeluar = keluar.reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const totalMasuk = masuk.reduce((s, r) => s + parseInt(r.nominal || 0), 0);

        const byKat = {};
        for (const r of keluar) {
            const kat = r.kategori || 'Lain-lain';
            byKat[kat] = (byKat[kat] || 0) + parseInt(r.nominal || 0);
        }

        let msg = `📊 *Laporan ${periodLabel}*\n━━━━━━━━━━━━━━━━━\n`;
        
        if (totalMasuk > 0) {
            msg += `💰 Pemasukan : Rp ${totalMasuk.toLocaleString('id-ID')}\n`;
        }
        
        msg += `💸 Pengeluaran: Rp ${totalKeluar.toLocaleString('id-ID')}\n\n`;

        msg += `*Detail Kategori:* \n`;
        Object.entries(byKat)
            .sort((a, b) => b[1] - a[1])
            .forEach(([kat, nom]) => {
                msg += `• ${kat}: Rp ${nom.toLocaleString('id-ID')}\n`;
            });

        msg += `\n━━━━━━━━━━━━━━━━━\nSisa hari: ${this.getSisaHari()} hari lagi`;
        return msg;
    }

    getSisaHari() {
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return lastDay - now.getDate();
    }
}

module.exports = ReportService;
