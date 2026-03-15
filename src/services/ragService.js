const groqClient = require('../integrations/groqClient');
const { getStartAndEndOfMonth } = require('../utils/dateUtils'); // assuming this exists, if not I will use inline JS dates

class RAGService {
    constructor(services, logger) {
        this.db = services.db;
        this.budget = services.budget;
        this.persona = services.persona;
        this.logger = logger;
    }

    /**
     * Tanyajawab Interaktif tentang keuangan (RAG)
     * @param {string} waNumber 
     * @param {string} question 
     * @returns {Promise<string>}
     */
    async answerQuestion(waNumber, question) {
        this.logger.info({ waNumber, question }, 'Processing RAG question');
        
        try {
            // 1. Fetch Context (Current Month Data)
            const date = new Date();
            const year = date.getFullYear();
            const month = date.getMonth() + 1; // 1-indexed for budget

            // Get current month's transactions
            const { start: startOfMonth } = getStartAndEndOfMonth(date);
            
            // Using existing repository method
            const transactions = await this.db.trxRepo.getByWaNumber(waNumber, {
                dariTanggal: startOfMonth
            });

            // Calculate aggregations for the prompt context
            let totalPengeluaran = 0;
            let totalPemasukan = 0;
            const pengeluaranPerKategori = {};

            transactions.forEach(trx => {
                const nom = parseInt(trx.nominal) || 0;
                if (trx.tipe === 'keluar') {
                    totalPengeluaran += nom;
                    pengeluaranPerKategori[trx.kategori] = (pengeluaranPerKategori[trx.kategori] || 0) + nom;
                } else if (trx.tipe === 'masuk') {
                    totalPemasukan += nom;
                }
            });

            // Get budget constraints
            const budget = await this.budget.getBudget(waNumber, year, month);

            // 2. Format Context for LLM
            let contextStr = `DATA KEUANGAN USER BULAN INI:\n`;
            contextStr += `- Total Pengeluaran: Rp ${totalPengeluaran.toLocaleString('id-ID')}\n`;
            contextStr += `- Total Pemasukan: Rp ${totalPemasukan.toLocaleString('id-ID')}\n`;
            
            if (budget) {
                const sisaBudget = parseInt(budget.nominal_budget) - totalPengeluaran;
                contextStr += `- Budget Bulanan: Rp ${parseInt(budget.nominal_budget).toLocaleString('id-ID')}\n`;
                contextStr += `- Sisa Budget: Rp ${sisaBudget.toLocaleString('id-ID')}\n`;
            } else {
                contextStr += `- Budget Bulanan: Belum diatur\n`;
            }

            if (Object.keys(pengeluaranPerKategori).length > 0) {
                contextStr += `- Rincian Pengeluaran per Kategori:\n`;
                for (const [kat, nom] of Object.entries(pengeluaranPerKategori)) {
                    contextStr += `   * ${kat}: Rp ${nom.toLocaleString('id-ID')}\n`;
                }
            } else {
                contextStr += `- Belum ada pengeluaran yg dicatat bulan ini.\n`;
            }

            // Limit recent transactions to prevent token overflow (last 10)
            const recentTrx = transactions.slice(0, 10).map(t => 
                `[${new Date(t.tanggal).toLocaleDateString()}] ${t.tipe === 'masuk' ? '+' : '-'} Rp${t.nominal} untuk ${t.kategori} (${t.judul || t.nama_toko})`
            ).join('\n');

            if (recentTrx) {
                contextStr += `\n10 Daftar Transaksi Terakhir:\n${recentTrx}`;
            }

            // 3. Build Prompt
            const persona = this.persona.getPersona(waNumber);
            const systemPrompt = `${persona.prompt}\n\nTugas utamamu adalah menjawab pertanyaan user berdasarkan [DATA KEUANGAN] yang diberikan.

ATURAN:
1. Jawab secara ringkas, jelas, dan santai (gunakan emoji secukupnya).
2. Jika user bertanya "apakah saya bisa membeli X seharga Y", bandingkan harga Y dengan Sisa Budget. Beri peringatan jika melebihi budget atau membuat sisa budget terlalu menipis.
3. Jika data tidak ada, sampaikan bahwa user belum mencatatnya.
4. JANGAN membuat-buat data. Hanya gunakan data di context.
5. Format angka menggunakan Rupiah, contoh Rp 50.000.`;

            const payload = {
                model: 'llama-3.3-70b-versatile', // very smart model for RAG reasoning
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `[DATA KEUANGAN]\n${contextStr}\n\nPertanyaan User: "${question}"` }
                ],
                temperature: 0.2, // Low temp for factual answers
            };

            const response = await groqClient.callGroq(payload);
            
            if (response.choices && response.choices.length > 0) {
                return response.choices[0].message.content.trim();
            }

            return "Maaf, AI sedang kesulitan memproses data kamu saat ini.";

        } catch (err) {
            this.logger.error({ waNumber, err: err.message }, 'RAG Service Error');
            return "Maaf, terjadi kesalahan saat mencoba menganalisa data keuanganmu.";
        }
    }
}

module.exports = RAGService;
