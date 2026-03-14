const TransactionValidator = require('../validators/transactionValidator');
const transactionParser = require('../utils/transactionParser');
const MSG = require('../constants/messages');
const { setState, resetState } = require('../utils/stateManager');
const ValidationError = require('../errors/ValidationError');

class TransactionController {
    constructor(services, logger) {
        this.transactionService = services.transaction;
        this.aiService = services.ai;
        this.logger = logger;
    }

    async handleManualInput(msg, from, text, cur, namaUser) {
        try {
            const parsed = transactionParser.parse(text);
            if (!parsed || parsed.nominal === 0) {
                throw new ValidationError('Format salah. Contoh: *Kopi 20k* atau *Bensin 30rb*');
            }
            
            const { deskripsi, nominal, tipe } = parsed;
            
            this.logger.info({ from, deskripsi, nominal, tipe }, 'Processing manual transaction input via parser');
            // We still get AI analysis but using deskripsi now
            const ai = await this.aiService.getAnalysis(deskripsi, deskripsi);
            
            setState(from, 'await_judul', { toko: deskripsi, nominal, ai, tipe, sumber: 'WA Bot', namaUser });
            return msg.reply(MSG.askJudul(deskripsi, nominal));
        } catch (err) {
            if (err instanceof ValidationError) {
                return msg.reply(`❌ ${err.message}`);
            }
            throw err;
        }
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
        await this.aiService.saveFeedback(from, cur.data.toko, sel, 'Uncategorized');
        
        setState(from, 'await_confirm', learned);
        return msg.reply(MSG.confirm(learned));
    }
}

module.exports = TransactionController;
