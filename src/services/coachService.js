/**
 * Smart Financial Coach Service
 * Provides personalized financial advice based on user data
 */

const groqClient = require('../integrations/groqClient');

class CoachService {
    constructor(services, logger) {
        this.db = services.db;
        this.persona = services.persona;
        this.logger = logger;
    }

    /**
     * AI Coach Generator
     * @param {string} waNumber 
     * @param {boolean} isProactive - Jika true, AI bisa memutuskan untuk diam (tidak alert) jika keadaannya normal
     * @returns {Promise<{ message: string, shouldAlert: boolean }>}
     */
    async getAdvice(waNumber, isProactive = false) {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const dateStr = now.toLocaleDateString('id-ID');
        const dayOfMonth = now.getDate();
        const totalDaysIntMonth = new Date(year, month, 0).getDate();
        
        const thisMonthStart = `${year}-${String(month).padStart(2, '0')}-01`;
        
        try {
            const [transactions, budget] = await Promise.all([
                this.db.getTransactions(waNumber, thisMonthStart),
                this.db.getBudget(waNumber, `${year}-${String(month).padStart(2, '0')}`)
            ]);

            const nominalBudget = budget ? parseInt(budget.nominal_budget) : null;
            
            let totalKeluar = 0;
            const byKat = {};
            let todayExpenditure = 0;

            transactions.forEach(r => {
                const nom = parseInt(r.nominal || 0);
                if (r.tipe === 'keluar') {
                    totalKeluar += nom;
                    const kat = r.kategori || 'Lain-lain';
                    byKat[kat] = (byKat[kat] || 0) + nom;

                    const trxDate = new Date(r.tanggal);
                    if (trxDate.getDate() === dayOfMonth && trxDate.getMonth() + 1 === month) {
                        todayExpenditure += nom;
                    }
                }
            });

            let contextStr = `Data Keuangan User:
- Tanggal Hari Ini: ${dateStr} (Hari ke-${dayOfMonth} dari ${totalDaysIntMonth} hari bulan ini)
- Total Pengeluaran Bulan Ini: Rp ${totalKeluar.toLocaleString('id-ID')}
- Total Pemasukan Bulan Ini: Rp ${transactions.filter(r => r.tipe==='masuk').reduce((s,r) => s + parseInt(r.nominal), 0).toLocaleString('id-ID')}
- Pengeluaran Hari Ini Saja: Rp ${todayExpenditure.toLocaleString('id-ID')}
`;

            if (nominalBudget) {
                const sisa = nominalBudget - totalKeluar;
                contextStr += `- Budget Bulanan: Rp ${nominalBudget.toLocaleString('id-ID')}\n- Sisa Budget: Rp ${sisa.toLocaleString('id-ID')}\n`;
            } else {
                contextStr += `- Budget Bulanan: Belum diatur\n`;
            }

            const topCats = Object.entries(byKat).sort((a,b) => b[1] - a[1]).slice(0,3);
            if (topCats.length > 0) {
                contextStr += `- 3 Top Kategori Pengeluaran: ${topCats.map(c => `${c[0]} (Rp ${c[1].toLocaleString('id-ID')})`).join(', ')}`;
            }

            const persona = this.persona.getPersona(waNumber);

            let sysPrompt = `${persona.prompt}\n\nEvaluasi [Data] user. 
Keluarkan response HANYA berupa JSON valid dengan 2 key:
1. "shouldAlert": (boolean) true jika user pantas ditegur (misal: budget kritis padahal masih pertengahan bulan, pengeluaran hari ini nol bisa jadi lupa catat, atau over-spending parah). False jika semuanya aman dan normal. Jika mode == 'manual', SELALU isi true.
2. "message": (string) Pesan nasehat atau peringatan ramah menggunakan emoji. Jika shouldAlert false, biarkan string kosong.
TIDAK ADA TEKS LAIN SELAIN JSON!`;

            if (!isProactive) {
                sysPrompt += `\nMODE: manual (user yang meminta nasehat sekarang, jadi shouldAlert HARUS true dan berikan nasehat analisis mendalam).`;
            } else {
                sysPrompt += `\nMODE: proactive cron job (cuma peringatkan jika genting/perlu).`;
            }

            const payload = {
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: sysPrompt },
                    { role: 'user', content: `[Data]\n${contextStr}` }
                ],
                response_format: { type: "json_object" },
                temperature: 0.2
            };

            const response = await groqClient.callGroq(payload);
            const rawJson = response.choices[0].message.content.trim();
            const aiData = JSON.parse(rawJson);

            // Jika dipanggil via command `/coach`, kita butuhkan pesannya saja
            if (!isProactive) {
                return `🧠 *AI Financial Coach*\n━━━━━━━━━━━━━━━━━\n${aiData.message || 'Semuanya terlihat mantap! Teruskan kebiasaan baikmu.'}`;
            }

            // Jika cron job proaktif
            return aiData;

        } catch (err) {
            this.logger.error({ waNumber, err: err.message }, 'Failed to generate AI Coach advice');
            return isProactive ? { shouldAlert: false, message: '' } : '❌ Gagal menganalisa data. Coba lagi nanti.';
        }
    }
}

module.exports = CoachService;
