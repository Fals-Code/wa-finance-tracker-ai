/**
 * PATCH: src/controllers/transactionController.js
 * 
 * Fix: Setelah save transaksi berhasil, set state 'await_saved_action'
 * bukan resetState(). Ini mencegah angka 1-4 di pesan "Selanjutnya:"
 * diinterpretasikan sebagai menu utama.
 * 
 * Cari method handleConfirm(), pada blok case '1':
 * Ganti:  resetState(from);
 * Dengan: setState(from, 'await_saved_action', {});
 */

const TransactionValidator = require('../validators/transactionValidator');
const transactionParser = require('../utils/transactionParser');
const merchantParser = require('../utils/merchantParser');
const MSG = require('../constants/messages');
const { getState, setState, resetState } = require('../utils/stateManager');
const ValidationError = require('../errors/ValidationError');

class TransactionController {
    constructor(services, logger) {
        this.transactionService  = services.transaction;
        this.aiService           = services.ai;
        this.budgetService       = services.budget;
        this.aiLearning          = services.aiLearning;
        this.semanticAI          = services.semanticAI;
        this.anomalyService      = services.anomaly;
        this.predictionService   = services.prediction;
        this.logger              = logger;
    }

    async handleManualInput(msg, from, text, cur, namaUser) {
        try {
            const parsed = transactionParser.parse(text);
            if (!parsed || parsed.nominal === 0) {
                throw new ValidationError('Format salah. Contoh: *Kopi Starbucks 50k*');
            }

            const { deskripsi, nominal, tipe } = parsed;

            // Duplicate Detection
            const isDup = await this.transactionService.isDuplicate(from, nominal, deskripsi);
            if (isDup) {
                setState(from, 'await_duplicate_confirm', { deskripsi, nominal, tipe, namaUser });
                return msg.reply(
                    `⚠️ *Transaksi yang sama baru saja dicatat.*\n` +
                    `Apakah ini transaksi baru atau duplikat?\n\n` +
                    `1️⃣ Simpan (transaksi baru)\n` +
                    `2️⃣ Abaikan (duplikat)`
                );
            }

            // Anomaly Detection
            const isAnomaly = await this.anomalyService.checkAnomaly(from, nominal);
            if (isAnomaly) {
                setState(from, 'await_anomaly_confirm', { deskripsi, nominal, tipe, namaUser });
                return msg.reply(
                    `⚠️ *Nominal cukup besar — pastikan ini benar.*\n` +
                    `Rp ${nominal.toLocaleString('id-ID')} jauh di atas rata-rata transaksimu.\n\n` +
                    `1️⃣ Ya, benar\n` +
                    `2️⃣ Tidak, batalkan`
                );
            }

            return await this.processValidatedInput(msg, from, deskripsi, nominal, tipe, namaUser);
        } catch (err) {
            if (err instanceof ValidationError) return msg.reply(`❌ ${err.message}`);
            throw err;
        }
    }

    async handleAnomalyConfirm(msg, from, text, cur) {
        if (text === '1') {
            return await this.processValidatedInput(
                msg, from, cur.data.deskripsi, cur.data.nominal, cur.data.tipe, cur.data.namaUser
            );
        }
        resetState(from);
        return msg.reply('✅ Transaksi dibatalkan.\n\nKetik *menu* untuk kembali.');
    }

    async handleDuplicateConfirm(msg, from, text, cur) {
        if (text === '1') {
            return await this.processValidatedInput(
                msg, from, cur.data.deskripsi, cur.data.nominal, cur.data.tipe, cur.data.namaUser
            );
        }
        resetState(from);
        return msg.reply('✅ Transaksi diabaikan.\n\nKetik *menu* untuk kembali.');
    }

    async processValidatedInput(msg, from, deskripsi, nominal, tipe, namaUser) {
        this.logger.info({ from, deskripsi, nominal, tipe }, 'Processing valid transaction input');

        // Merchant Detection
        const detectedMerchant = merchantParser.detect(deskripsi);

        // AI Analysis
        let ai = await this.semanticAI.findSemanticMatch(deskripsi);
        if (!ai) {
            ai = await this.aiService.getAnalysis(deskripsi, detectedMerchant || deskripsi);
        }

        setState(from, 'await_judul', {
            toko: detectedMerchant || deskripsi,
            judul: deskripsi,
            nominal,
            ai,
            tipe,
            sumber: 'WA Bot',
            namaUser
        });

        return msg.reply(MSG.askJudul(detectedMerchant || deskripsi, nominal));
    }

    async handleJudul(msg, from, text, cur) {
        const lower = text.toLowerCase();
        const judul = (lower === 'skip') ? cur.data.toko : text;
        const newData = { ...cur.data, judul };
        setState(from, 'await_confirm', newData);
        return msg.reply(MSG.confirm(newData));
    }

    async handleConfirm(msg, from, text, cur, namaUser) {
        const lower = text.toLowerCase();

        if (lower === '1') {
            this.logger.info({ from }, 'Saving confirmed transaction');
            try {
                const alert  = await this.transactionService.saveTransaction(from, namaUser, cur.data);
                const saldo  = await this.transactionService.getBalance(from);
                const insight = await this.transactionService.getCategoryInsight(from, cur.data.ai?.kategori);

                // ✅ FIX: Set 'await_saved_action' bukan resetState()
                // Ini mencegah reply "4" diartikan sebagai menu[4] = riwayat
                setState(from, 'await_saved_action', {});

                let feedback = MSG.saved(cur.data, saldo, alert, from);
                if (insight) feedback += `\n\n💡 *Smart Insight:*\n${insight}`;

                return msg.reply(feedback);
            } catch (err) {
                if (err instanceof ValidationError) return msg.reply(`❌ ${err.message}`);
                throw err;
            }
        }

        if (lower === '2') {
            const dataForEdit = { ...cur.data };
            delete dataForEdit.judul;
            setState(from, 'await_judul', dataForEdit);
            return msg.reply(MSG.askJudul(cur.data.toko, cur.data.nominal));
        }

        if (lower === '3') {
            setState(from, 'await_nominal_edit', cur.data);
            return msg.reply(
                `💰 *Ubah Nominal*\n\n` +
                `Nominal saat ini: *Rp ${parseInt(cur.data.nominal).toLocaleString('id-ID')}*\n\n` +
                `Ketik nominal baru:`
            );
        }

        if (lower === '5') {
            setState(from, 'await_ai_learning', cur.data);
            return msg.reply(
                `🏷️ *Pilih Kategori yang Benar:*\n━━━━━━━━━━━━━━━━━\n` +
                `1. Makanan & Minuman\n2. Transportasi\n3. Kebutuhan Pokok\n` +
                `4. Kesehatan\n5. Hiburan\n6. Belanja Online\n7. Fashion\n` +
                `8. Tagihan\n9. Pendidikan\n10. Rumah Tangga\n11. Perjalanan\n` +
                `12. Investasi\n13. Lain-lain\n\n_Balas angka 1-13_`
            );
        }

        if (['4', 'batal', 'cancel', 'tidak', 'no'].includes(lower)) {
            resetState(from);
            return msg.reply(MSG.cancelled());
        }

        return msg.reply(
            `❓ Pilih:\n` +
            `1️⃣ Simpan · 2️⃣ Ubah Judul · 3️⃣ Ubah Nominal · 4️⃣ Batal · 5️⃣ Koreksi Kategori`
        );
    }

    async handleNominalEdit(msg, from, text, cur) {
        const newNom = parseInt(text.replace(/\D/g, ''));
        if (isNaN(newNom)) return msg.reply('❌ Nominal tidak valid. Contoh: `75000`');
        const updatedData = { ...cur.data, nominal: newNom };
        setState(from, 'await_confirm', updatedData);
        return msg.reply(MSG.confirm(updatedData));
    }

    async handleAILearning(msg, from, text, cur) {
        const cats = {
            '1': 'Makanan & Minuman', '2': 'Transportasi', '3': 'Kebutuhan Pokok',
            '4': 'Kesehatan', '5': 'Hiburan', '6': 'Belanja Online', '7': 'Fashion',
            '8': 'Tagihan', '9': 'Pendidikan', '10': 'Rumah Tangga',
            '11': 'Perjalanan', '12': 'Investasi', '13': 'Lain-lain'
        };
        const sel = cats[text.trim()];
        if (!sel) return msg.reply('❌ Pilih angka 1-13.');

        this.logger.info({ from, category: sel }, 'AI Feedback received');
        const learned = { ...cur.data, ai: { ...cur.data.ai, kategori: sel, status: '🧠 Learned' } };

        await this.aiLearning.learnKeyword(from, cur.data.toko, sel, 'Uncategorized');

        setState(from, 'await_confirm', learned);
        return msg.reply(MSG.confirm(learned));
    }
}

module.exports = TransactionController;