const TransactionValidator = require('../validators/transactionValidator');
const transactionParser = require('../utils/transactionParser');
const merchantParser = require('../utils/merchantParser');
const MSG = require('../constants/messages');
const { getState, setState, resetState } = require('../utils/stateManager');
const ValidationError = require('../errors/ValidationError');

class TransactionController {
    constructor(services, logger) {
        this.transactionService = services.transaction;
        this.aiService = services.ai;
        this.budgetService = services.budget;
        this.aiLearning = services.aiLearning;
        this.semanticAI = services.semanticAI; 
        this.anomalyService = services.anomaly; // Added
        this.predictionService = services.prediction; // Added
        this.logger = logger;
    }

    async handleManualInput(msg, from, text, cur, namaUser) {
        try {
            const parsed = transactionParser.parse(text);
            if (!parsed || parsed.nominal === 0) {
                throw new ValidationError('Format salah. Contoh: *Kopi Starbucks 50k*');
            }
            
            const { deskripsi, nominal, tipe } = parsed;
            
            // 1. Duplicate Detection
            const isDup = await this.transactionService.isDuplicate(from, nominal, deskripsi);
            if (isDup) {
                setState(from, 'await_duplicate_confirm', { deskripsi, nominal, tipe, namaUser });
                return msg.reply(`⚠️ *Transaksi yang sama terdeteksi.*\nApakah ini transaksi baru atau duplikat?\n\n1. Simpan\n2. Abaikan (Duplikat)`);
            }

            // 2. Anomaly Detection (SaaS Upgrade)
            const isAnomaly = await this.anomalyService.checkAnomaly(from, nominal);
            if (isAnomaly) {
                setState(from, 'await_anomaly_confirm', { deskripsi, nominal, tipe, namaUser });
                return msg.reply(`⚠️ *Transaksi Terdeteksi Cukup Besar (Anomaly!)*\nNominal Rp ${nominal.toLocaleString('id-ID')} jauh dari rata-rata kamu.\n\nApakah ini benar?\n1. Ya, Benar\n2. Tidak, Batalkan`);
            }

            return await this.processValidatedInput(msg, from, deskripsi, nominal, tipe, namaUser);
        } catch (err) {
            if (err instanceof ValidationError) {
                return msg.reply(`❌ ${err.message}`);
            }
            throw err;
        }
    }

    async handleAnomalyConfirm(msg, from, text, cur) {
        if (text === '1') {
            return await this.processValidatedInput(msg, from, cur.data.deskripsi, cur.data.nominal, cur.data.tipe, cur.data.namaUser);
        }
        resetState(from);
        return msg.reply('✅ Transaksi dibatalkan.');
    }

    async handleDuplicateConfirm(msg, from, text, cur) {
        if (text === '1') {
            return await this.processValidatedInput(msg, from, cur.data.deskripsi, cur.data.nominal, cur.data.tipe, cur.data.namaUser);
        }
        resetState(from);
        return msg.reply('✅ Transaksi diabaikan.');
    }

    async processValidatedInput(msg, from, deskripsi, nominal, tipe, namaUser) {
        this.logger.info({ from, deskripsi, nominal, tipe }, 'Processing valid transaction input');
        
        // 1. Merchant Detection
        const detectedMerchant = merchantParser.detect(deskripsi);
        const cleanDeskripsi = detectedMerchant ? deskripsi.replace(new RegExp(detectedMerchant, 'gi'), '').trim() : deskripsi;
        
        // 2. AI Analysis (Semantic Grouping First)
        let ai = await this.semanticAI.findSemanticMatch(deskripsi);
        if (!ai) {
            ai = await this.aiService.getAnalysis(deskripsi, detectedMerchant || deskripsi);
        }
        
        setState(from, 'await_judul', { 
            toko: detectedMerchant || deskripsi, 
            judul: cleanDeskripsi || deskripsi,
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
        
        this.logger.debug({ from, judul }, 'Setting transaction title');
        setState(from, 'await_confirm', newData);
        return msg.reply(MSG.confirm(newData));
    }

    async handleConfirm(msg, from, text, cur, namaUser) {
        const lower = text.toLowerCase();
        
        if (lower === '1') {
            this.logger.info({ from }, 'Saving confirmed transaction');
            try {
                const alert = await this.transactionService.saveTransaction(from, namaUser, cur.data);
                resetState(from);
                return msg.reply(MSG.saved(cur.data, alert));
            } catch (err) {
                if (err instanceof ValidationError) {
                    return msg.reply(`❌ ${err.message}`);
                }
                throw err;
            }
        }

        if (lower === '2') {
            setState(from, 'await_judul', cur.data);
            return msg.reply(MSG.askJudul(cur.data.toko, cur.data.nominal));
        }

        if (lower === '3') {
            setState(from, 'await_nominal_edit', cur.data);
            return msg.reply(`💰 Ketik nominal baru:`);
        }

        if (lower === '5') {
            setState(from, 'await_ai_learning', cur.data);
            return msg.reply(`🏷️ Pilih kategori: 1.Makanan, 2.Transportasi, 3.Pokok, 4.Kesehatan, 5.Hiburan, 6.Online, 7.Fashion, 8.Tagihan, 9.Pendidikan, 10.Rumah, 11.Perjalanan, 12.Investasi, 13.Lainnya`);
        }

        if (lower === '4') {
            this.logger.debug({ from }, 'Transaction cancelled at confirmation');
            resetState(from);
            return msg.reply(MSG.cancelled());
        }

        return msg.reply(`❓ Pilih 1-5.`);
    }

    async handleNominalEdit(msg, from, text, cur) {
        const newNom = parseInt(text.replace(/\D/g, ''));
        if (isNaN(newNom)) return msg.reply('❌ Nominal tidak valid.');
        
        this.logger.debug({ from, oldNom: cur.data.nominal, newNom }, 'Updating transaction nominal');
        const updatedData = { ...cur.data, nominal: newNom };
        setState(from, 'await_confirm', updatedData);
        return msg.reply(MSG.confirm(updatedData));
    }

    async handleAILearning(msg, from, text, cur) {
        const cats = {
            '1': 'Makanan & Minuman', '2': 'Transportasi', '3': 'Kebutuhan Pokok', '4': 'Kesehatan', '5': 'Hiburan',
            '6': 'Belanja Online', '7': 'Fashion', '8': 'Tagihan', '9': 'Pendidikan', '10': 'Rumah Tangga',
            '11': 'Perjalanan', '12': 'Investasi', '13': 'Lain-lain'
        };
        const sel = cats[text.trim()];
        if (!sel) return msg.reply('❌ Pilih 1-13.');
        
        this.logger.info({ from, toko: cur.data.toko, category: sel }, 'AI Feedback received');
        const learned = { ...cur.data, ai: { ...cur.data.ai, kategori: sel, status: '🧠 Learned' } };
        
        // Use the new AI Learning service
        await this.aiLearning.learnKeyword(from, cur.data.toko, sel, 'Uncategorized');
        
        setState(from, 'await_confirm', learned);
        return msg.reply(MSG.confirm(learned));
    }
}

module.exports = TransactionController;
