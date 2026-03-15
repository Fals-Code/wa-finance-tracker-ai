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
        const bulanNama = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
        const rows = await this.db.getTransactions(waNumber, startOfMonth);
        
        // Filter agar hanya bulan ini (bukan bulan sebelumnya yang ikut masuk)
        const thisMonthRows = (rows || []).filter(r => r.tanggal >= startOfMonth);
        
        return this.formatMonthlyReport(bulanNama, thisMonthRows, now);
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

        const sisaHari = this.getSisaHari();
        const bulanNama = new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' });
        msg += `\n━━━━━━━━━━━━━━━━━\n`;
        msg += `📅 Laporan periode: *${bulanNama}*\n`;
        msg += `⏳ Sisa ${sisaHari} hari hingga akhir bulan\n`;
        msg += `\nKetik *menu* untuk kembali`;
        return msg;
    }

    formatMonthlyReport(bulanNama, rows, now) {
        if (!rows || rows.length === 0) {
            return `📭 Belum ada transaksi di ${bulanNama}.\n\nKetik *menu* untuk kembali.`;
        }
      
        const keluar = rows.filter(r => r.tipe !== 'masuk');
        const masuk = rows.filter(r => r.tipe === 'masuk');
        const totalKeluar = keluar.reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const totalMasuk = masuk.reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const saldo = totalMasuk - totalKeluar;
        const sisaHari = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
        
        const byKat = {};
        keluar.forEach(r => {
            const kat = r.kategori || 'Lain-lain';
            byKat[kat] = (byKat[kat] || 0) + parseInt(r.nominal || 0);
        });
      
        let msg = `📊 *LAPORAN ${bulanNama.toUpperCase()}*\n`;
        msg += `━━━━━━━━━━━━━━━━━\n`;
        msg += `💸 Pengeluaran : *Rp ${totalKeluar.toLocaleString('id-ID')}*\n`;
        if (totalMasuk > 0) {
            msg += `💰 Pemasukan   : *Rp ${totalMasuk.toLocaleString('id-ID')}*\n`;
        }
        msg += `📊 Saldo Bersih: *Rp ${saldo.toLocaleString('id-ID')}*${saldo < 0 ? ' ⚠️' : ' ✅'}\n`;
        msg += `📝 Total Transaksi: ${rows.length}\n\n`;
      
        const sorted = Object.entries(byKat).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (sorted.length > 0) {
            const maxVal = sorted[0][1] || 1;
            const BAR_LEN = 8;
            msg += `*📈 Top Kategori Pengeluaran:*\n`;
            for (const [kat, nom] of sorted) {
                const filled = Math.round((nom / maxVal) * BAR_LEN);
                const bar = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
                const pct = Math.round((nom / totalKeluar) * 100);
                msg += `${kat}\n[${bar}] ${pct}% · Rp ${nom.toLocaleString('id-ID')}\n`;
            }
            msg += '\n';
        }

        // ⚖️ 50/30/20 ANALYSIS
        const klasifikasi = { Needs: 0, Wants: 0, Savings: 0 };
        keluar.forEach(r => {
            const catatan = r.catatan || '';
            const match = catatan.match(/\[AI: (Needs|Wants|Savings)\]/);
            const key = match ? match[1] : 'Needs'; // Default to Needs if not classified
            klasifikasi[key] += parseInt(r.nominal || 0);
        });

        const pctNeeds = Math.round((klasifikasi.Needs / (totalKeluar || 1)) * 100);
        const pctWants = Math.round((klasifikasi.Wants / (totalKeluar || 1)) * 100);
        const pctSavings = Math.round((klasifikasi.Savings / (totalKeluar || 1)) * 100);

        msg += `*⚖️ Analisis Needs vs Wants (50/30/20):*\n`;
        msg += `🏠 *Needs   :* ${pctNeeds}% (Rp ${klasifikasi.Needs.toLocaleString('id-ID')})\n`;
        msg += `🎡 *Wants   :* ${pctWants}% (Rp ${klasifikasi.Wants.toLocaleString('id-ID')})\n`;
        msg += `🐷 *Savings :* ${pctSavings}% (Rp ${klasifikasi.Savings.toLocaleString('id-ID')})\n\n`;

        if (pctNeeds > 60) msg += `💡 *Saran AI:* Pengeluaran 'Needs' kamu terlalu tinggi (>50%). Coba review tagihan rutin atau biaya makan darurat.\n\n`;
        else if (pctWants > 40) msg += `💡 *Saran AI:* 'Wants' kamu cukup tinggi (>30%). Kurangi jajan/hiburan untuk mempertebal tabungan!\n\n`;
        else msg += `💡 *Saran AI:* Rasio keuanganmu cukup sehat! Pertahankan proporsi ini. ✅\n\n`;
      
      
        msg += `*🕐 5 Transaksi Terakhir:*\n`;
        rows.slice(0, 5).forEach(r => {
            const tgl = new Date(r.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            const icon = r.tipe === 'masuk' ? '💰' : '💸';
            const label = r.judul || r.deskripsi || r.nama_toko || 'Transaksi';
            msg += `${icon} ${tgl} · ${label} · Rp ${parseInt(r.nominal).toLocaleString('id-ID')}\n`;
        });
        
        msg += `\n━━━━━━━━━━━━━━━━━\n`;
        msg += `📅 Periode: *${bulanNama}* (${rows.length} transaksi)\n`;
        msg += `⏳ Sisa *${sisaHari} hari* hingga akhir bulan\n`;
        msg += `\nKetik *menu* untuk kembali`;
        
        return msg;
    }

    getSisaHari() {
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return lastDay - now.getDate();
    }
}

module.exports = ReportService;
