const TransactionValidator = require('../validators/transactionValidator');
const ReceiptValidator = require('../validators/receiptValidator');
const { metrics } = require('../utils/metrics');

class TransactionService {
    constructor(databaseService, budgetService, logger) {
        this.db = databaseService;
        this.budgetService = budgetService;
        this.logger = logger;
    }

    async saveTransaction(waNumber, namaUser, data) {
        TransactionValidator.validateConfirmation(data);
        this.logger.info({ event: 'transaction_saving', user: waNumber, judul: data.judul }, 'Executing save transaction flow');
        await this.db.saveTransaction(waNumber, namaUser, data);
        metrics.transactionCounter.inc({ type: data.tipe || 'keluar', category: data.ai?.kategori || 'Unknown' });
        return await this.budgetService.checkBudgetAlert(waNumber);
    }

    async getLaporan(waNumber) {
        const now = new Date();
        const dari = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const bulanNama = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' });

        this.logger.debug({ waNumber, bulanNama }, 'Generating report data');
        const data = await this.db.getTransactions(waNumber, dari);

        if (!data || data.length === 0) return `📭 Belum ada transaksi di ${bulanNama}.`;

        const keluar = data.filter(r => r.tipe !== 'masuk');
        const masuk = data.filter(r => r.tipe === 'masuk');
        const totalKeluar = keluar.reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const totalMasuk = masuk.reduce((s, r) => s + parseInt(r.nominal || 0), 0);

        const byKat = {};
        for (const r of keluar) {
            const kat = r.kategori || 'Lain-lain';
            byKat[kat] = (byKat[kat] || 0) + parseInt(r.nominal || 0);
        }

        const sorted = Object.entries(byKat).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const maxVal = sorted[0]?.[1] || 1;
        const BAR_LEN = 10;

        let msg = `📊 *Laporan ${bulanNama}*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `💸 Keluar : Rp ${totalKeluar.toLocaleString('id-ID')}\n`;
        msg += `💰 Masuk  : Rp ${totalMasuk.toLocaleString('id-ID')}\n`;
        msg += `📝 Total  : ${data.length} transaksi\n\n`;

        const budget = await this.budgetService.getBudget(waNumber);
        if (budget) {
            const pct = Math.min(100, Math.round((totalKeluar / budget) * 100));
            const filled = Math.round((pct / 100) * BAR_LEN);
            const bar = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
            msg += `🎯 *Budget:* [${bar}] ${pct}%\n`;
            msg += `   Rp ${totalKeluar.toLocaleString('id-ID')} / Rp ${budget.toLocaleString('id-ID')}\n\n`;
        }

        msg += `*📈 Top Kategori:*\n`;
        for (const [kat, nom] of sorted) {
            const filled = Math.round((nom / maxVal) * BAR_LEN);
            const bar = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
            msg += `${kat}\n[${bar}] Rp ${nom.toLocaleString('id-ID')}\n`;
        }

        msg += `\n*🕐 Terakhir:*\n`;
        for (const r of data.slice(0, 5)) {
            const tgl = new Date(r.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            const icon = r.tipe === 'masuk' ? '💰' : '💸';
            const label = r.judul || r.nama_toko || '-';
            msg += `${icon} ${tgl} ${label} — Rp ${parseInt(r.nominal).toLocaleString('id-ID')}\n`;
        }

        msg += `\n━━━━━━━━━━━━━━━━━\nKetik *menu* untuk kembali`;
        return msg;
    }

    async getSaldo(waNumber) {
        const now = new Date();
        const dari = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const bulanNama = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' });

        this.logger.debug({ waNumber }, 'Generating balance data');
        const data = await this.db.getTransactions(waNumber, dari);

        const totalKeluar = (data || []).filter(r => r.tipe !== 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const totalMasuk = (data || []).filter(r => r.tipe === 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const saldo = totalMasuk - totalKeluar;
        const rataHari = now.getDate() > 0 ? Math.round(totalKeluar / now.getDate()) : 0;

        let msg = `💳 *Saldo ${bulanNama}*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `📅 Hari ke-${now.getDate()}\n`;
        msg += `🧾 Transaksi: ${(data || []).length}\n`;
        msg += `💸 Total Keluar : Rp ${totalKeluar.toLocaleString('id-ID')}\n`;
        msg += `💰 Total Masuk  : Rp ${totalMasuk.toLocaleString('id-ID')}\n`;
        msg += `📊 Saldo Bersih : Rp ${saldo.toLocaleString('id-ID')}${saldo < 0 ? ' ⚠️' : ' ✅'}\n`;
        msg += `📈 Rata-rata keluar/hari: Rp ${rataHari.toLocaleString('id-ID')}\n`;

        const budget = await this.budgetService.getBudget(waNumber);
        if (budget) {
            const sisa = budget - totalKeluar;
            const pct = Math.round((totalKeluar / budget) * 100);
            msg += `\n🎯 *Budget Bulan Ini:*\n`;
            msg += `   Total  : Rp ${budget.toLocaleString('id-ID')}\n`;
            msg += `   Terpakai: ${pct}%\n`;
            msg += `   Sisa   : Rp ${Math.max(0, sisa).toLocaleString('id-ID')}\n`;
        }

        msg += `\nKetik *menu* untuk kembali`;
        return msg;
    }

    async getRiwayat(waNumber, limit = 10) {
        const data = await this.db.getHistory(waNumber, limit);
        if (!data || data.length === 0) return `📭 Belum ada transaksi.`;

        let msg = `🕐 *Riwayat ${limit} Transaksi Terakhir*\n━━━━━━━━━━━━━━━━━\n`;
        for (const r of data) {
            const tgl = new Date(r.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            const icon = r.tipe === 'masuk' ? '💰' : '💸';
            const label = r.judul || r.nama_toko || '-';
            msg += `${icon} *${label}*\n`;
            msg += `   ${tgl} | ${r.kategori} | Rp ${parseInt(r.nominal).toLocaleString('id-ID')}\n`;
        }
        msg += `\nKetik *menu* untuk kembali`;
        return msg;
    }
}

module.exports = TransactionService;
