/**
 * Smart Financial Coach Service
 * Provides personalized financial advice based on user data
 */

class CoachService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    async getAdvice(waNumber) {
        const now = new Date();
        const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        
        const [transactions, budget] = await Promise.all([
            this.db.getTransactions(waNumber, thisMonthStart),
            this.db.getBudget(waNumber, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
        ]);

        const totalKeluar = transactions.filter(r => r.tipe !== 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        const totalMasuk = transactions.filter(r => r.tipe === 'masuk').reduce((s, r) => s + parseInt(r.nominal || 0), 0);
        
        const savingRate = totalMasuk > 0 ? Math.round(((totalMasuk - totalKeluar) / totalMasuk) * 100) : 0;
        
        let tips = [];

        // 1. Saving Rate Tip
        if (savingRate < 20) {
            tips.push(`📉 Saving rate kamu cuma *${savingRate}%*. Idealnya sisihkan minimal 20% ya! Coba kurangi jajan minggu ini.`);
        } else {
            tips.push(`🌟 Mantap! Saving rate kamu *${savingRate}%*. Pertahankan pola berhemat ini!`);
        }

        // 2. Category specific tip
        const byKat = {};
        transactions.filter(r => r.tipe !== 'masuk').forEach(r => {
            const kat = r.kategori || 'Lain-lain';
            byKat[kat] = (byKat[kat] || 0) + parseInt(r.nominal || 0);
        });

        const sorted = Object.entries(byKat).sort((a,b) => b[1] - a[1]);
        if (sorted.length > 0 && sorted[0][0] === 'Makanan & Minuman' && sorted[0][1] > totalKeluar * 0.4) {
            tips.push(`🍔 Pengeluaran makanmu mencapai *${Math.round((sorted[0][1]/totalKeluar)*100)}%* dari total. Masak di rumah bisa menghemat banyak lho!`);
        }

        // 3. Budget discipline
        if (budget && totalKeluar > budget) {
            tips.push(`⚠️ Kamu sudah melebihi budget bulanan sebesar *Rp ${(totalKeluar - budget).toLocaleString('id-ID')}*. Waktunya puasa belanja!`);
        }

        let msg = `🧠 *AI Financial Coach*\n━━━━━━━━━━━━━━━━━\n`;
        tips.forEach(t => msg += `• ${t}\n\n`);
        
        msg += `💡 _"Uang kecil yang keluar terus-menerus bisa jadi lubang besar bagi tabunganmu."_`;
        
        return msg;
    }
}

module.exports = CoachService;
