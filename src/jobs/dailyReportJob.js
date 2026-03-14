/**
 * Daily Report Job
 */
class DailyReportJob {
    constructor(client, supabase, logger) {
        this.client = client;
        this.supabase = supabase;
        this.logger = logger;
    }

    async run() {
        this.logger.info('Running Daily Report Job');
        
        // This logic would pull active users from DB and send summaries
        // For brevity, abstracting the "active users" part
        // Mocking the broad-stroke logic
        this.logger.warn('DailyReportJob: Active user fetching not fully implemented in DB');
    }

    async executeForUser(wa) {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await this.supabase.from('transaksi')
            .select('nominal, judul, nama_toko, deskripsi')
            .eq('wa_number', wa).eq('tipe', 'keluar').eq('tanggal', today);
        
        if (!data || data.length === 0) return null;
        const total = data.reduce((sum, r) => sum + parseInt(r.nominal), 0);
        
        let msg = `🌙 *Ringkasan Pengeluaran Hari Ini*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `Total Keluar: *Rp ${total.toLocaleString('id-ID')}*\n\n`;
        data.forEach(r => msg += `• ${r.judul || r.deskripsi || r.nama_toko || 'Transaksi'} (Rp ${parseInt(r.nominal).toLocaleString('id-ID')})\n`);
        return msg;
    }
}

module.exports = DailyReportJob;
