/**
 * Anomaly Detection Service
 * Detects unusually large transactions
 */

class AnomalyService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    /**
     * Checks if a new transaction is an anomaly or duplicate
     * @returns {Promise<string|false>} Alert message if anomaly detected, false otherwise
     */
    async checkAnomaly(waNumber, nominal, toko, kategori) {
        try {
            // 1. Fetch transactions for the last 3 months
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            const dari = threeMonthsAgo.toISOString().split('T')[0];
            
            const transactions = await this.db.getTransactions(waNumber, dari);
            if (!transactions || transactions.length < 1) return false;

            // 2. Duplicate Check (Same Day, Same Nominal, Similar Name)
            const todayStr = new Date().toISOString().split('T')[0];
            const todaysTrx = transactions.filter(r => r.tanggal.startsWith(todayStr) && r.tipe === 'keluar');
            
            const isDuplicate = todaysTrx.some(r => 
                parseInt(r.nominal) === nominal && 
                (r.nama_toko && r.nama_toko.toLowerCase() === toko.toLowerCase())
            );

            if (isDuplicate) {
                return `🚨 *Peringatan:* Kamu sudah mencatat pengeluaran untuk "${toko}" sebesar Rp ${nominal.toLocaleString('id-ID')} hari ini. Apakah ini dobel?`;
            }

            // 3. Category Outlier Check
            const katHistory = transactions
                .filter(r => r.tipe !== 'masuk' && r.kategori === kategori)
                .map(r => parseInt(r.nominal))
                .filter(n => !isNaN(n) && n > 0);
            
            if (katHistory.length >= 3) {
                const avg = katHistory.reduce((s, v) => s + v, 0) / katHistory.length;
                // Anomaly if it's 3x the average of that category and > 100k
                if (nominal > avg * 3 && nominal > 100000) {
                    this.logger.warn({ waNumber, nominal, kategori, avg: Math.round(avg) }, 'Category anomaly detected');
                    return `🚨 *Anomali:* Pengeluaran ${kategori} ini jauh lebih besar dari rata-rata biasanya (Rp ${Math.round(avg).toLocaleString('id-ID')}). Cek kembali apakah nominalnya benar.`;
                }
            }

            return false;
        } catch (e) {
            this.logger.warn({ err: e.message }, 'Anomaly check failed, skipping');
            return false; // Fail-safe
        }
    }
}

module.exports = AnomalyService;
