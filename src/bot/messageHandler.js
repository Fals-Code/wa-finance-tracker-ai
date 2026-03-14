/**
 * Message Handler (Router)
 * Clean routing for conversational WhatsApp finance assistant
 */

const { getState, setState, resetState, isTimedOut } = require('../utils/stateManager');
const MSG = require('../constants/messages');
const rateLimiter = require('../utils/rateLimiter');

class MessageHandler {
    constructor(controllers, services, logger) {
        this.transaction = controllers.transaction;
        this.report = controllers.report;
        this.budget = controllers.budget;
        this.category = controllers.category;
        this.media = controllers.media;
        
        this.db = services.db;
        this.ai = services.ai;
        this.reportService = services.report;
        this.insightService = services.insight;
        this.statsService = services.stats;
        this.patternService = services.patternInsight;
        this.coachService = services.coach;
        this.healthService = services.health;
        this.predictionService = services.prediction;
        this.otpService = services.otp;
        this.logger = logger;
    }

    async handle(msg) {
        if (msg.isStatus) return;
        
        let from = msg.from;
        if (from.endsWith('@g.us')) return;

        if (rateLimiter.isRateLimited(from)) {
            this.logger.warn({ from }, 'rate limit');
            return;
        }

        const text = (msg.body || '').trim();
        const lower = text.toLowerCase();

        // 1. Normalize ID and handle migration
        const originalFrom = from;
        let contactObj = null;
        try {
            contactObj = await msg.getContact();
            if (contactObj.number) {
                from = contactObj.number + '@c.us';
            }
        } catch (e) {
            this.logger.error(e);
        }

        if (originalFrom !== from) {
            await this.db.migrateUser(originalFrom, from).catch(() => {});
        }

        const namaUser = contactObj ? (contactObj.pushname || contactObj.name || from.split('@')[0]) : from.split('@')[0];
        
        this.logger.info({ from, user: namaUser, text: text.substring(0, 50) }, 'Incoming message');

        await this.db.getOrCreateProfile(from, namaUser).catch(() => {});

        const stateObj = getState(from);
        if (stateObj.step !== 'idle' && isTimedOut(stateObj)) {
            this.logger.debug({ from, step: stateObj.step }, 'State timed out, resetting');
            resetState(from);
        }
        
        const cur = getState(from);

        // 2. Handle Media (Photo Struk)
        if (msg.hasMedia) {
            if (['idle', 'menu', 'await_method', 'await_photo'].includes(cur.step)) {
                return await this.media.handlePhoto(msg, from, namaUser);
            } else if (cur.step === 'await_text') {
                return await msg.reply('📝 Mode teks aktif. Ketik *batal* dulu lalu pilih foto.');
            }
            return;
        }

        // 3. Global Commands
        if (['batal', 'cancel'].includes(lower)) { 
            this.logger.debug({ from }, 'Global cancel command');
            resetState(from); 
            return msg.reply(MSG.cancelled()); 
        }
        
        if (['menu', 'mulai', 'start'].includes(lower)) { 
            this.logger.debug({ from }, 'Global menu command');
            resetState(from);
            setState(from, 'menu', {}); 
            return msg.reply(MSG.menu(from)); 
        }

        // 4. State Handlers (Routing by State)
        if (cur.step !== 'idle' && cur.step !== 'menu') {
            return await this.routeByState(msg, from, cur, text, lower, namaUser);
        }

        // 5. Direct Commands (idle/menu)
        return await this.routeByCommand(msg, from, text, lower, namaUser, cur);
    }

    async routeByState(msg, from, cur, text, lower, namaUser) {
        this.logger.debug({ from, step: cur.step }, 'Routing by state');
        
        switch (cur.step) {
            case 'menu':
                switch (text) {
                    case '1':
                        setState(from, 'await_tipe', {});
                        return msg.reply(MSG.chooseTipe());
                    case '2':
                        await msg.reply('📊 Mengambil laporan bulan ini...');
                        return msg.reply(await this.reportService.getMonthlyReport(from));
                    case '3':
                        await msg.reply('💰 Menghitung saldo...');
                        return await this.report.showSaldo(msg, from);
                    case '4':
                        await msg.reply('📜 Mengambil riwayat transaksi...');
                        return await this.report.showRiwayat(msg, from);
                    case '5':
                        return await this.budget.showMenu(msg, from);
                    case '6':
                        return await this.category.showMenu(msg, from);
                    case '7':
                        return await this.routeExport(msg, from);
                    case '8':
                        return msg.reply(MSG.help());
                    default:
                        resetState(from);
                        return await this.routeByCommand(msg, from, text, lower, namaUser);
                }

            case 'await_tipe':
                let tipe = null;
                if (['1', 'keluar', 'bayar', 'beli', 'pengeluaran'].includes(lower)) tipe = 'keluar';
                if (['2', 'masuk', 'pemasukan', 'gaji', 'terima'].includes(lower)) tipe = 'masuk';
                if (!tipe) return msg.reply(`❓ Pilih *1* Pengeluaran atau *2* Pemasukan.`);
                setState(from, 'await_method', { tipe });
                return msg.reply(MSG.chooseMethod(tipe));

            case 'await_method':
                if (['1', 'teks', 'manual'].includes(lower)) {
                    setState(from, 'await_text', { tipe: cur.data.tipe });
                    return msg.reply(`📝 Ketik transaksi seperti:\n\n*kopi 20k*`);
                }
                if (['2', 'foto', 'struk'].includes(lower)) {
                    setState(from, 'await_photo', { tipe: cur.data.tipe });
                    return msg.reply(`📸 Kirim foto struk.`);
                }
                return msg.reply(`❓ Pilih *1* teks atau *2* foto.`);

            case 'await_text':
                return await this.transaction.handleManualInput(msg, from, text, cur, namaUser);

            case 'await_judul':
            case 'await_tujuan_transfer':
                return await this.transaction.handleJudul(msg, from, text, cur);

            case 'await_confirm':
                return await this.transaction.handleConfirm(msg, from, text, cur, namaUser);
                
            case 'await_nominal_edit':
                return await this.transaction.handleNominalEdit(msg, from, text, cur);

            case 'await_ai_learning':
                return await this.transaction.handleAILearning(msg, from, text, cur);

            case 'await_duplicate_confirm':
                return await this.transaction.handleDuplicateConfirm(msg, from, text, cur);

            case 'await_anomaly_confirm':
                return await this.transaction.handleAnomalyConfirm(msg, from, text, cur);

            case 'await_budget':
                return await this.budget.handleSetBudget(msg, from, text);

            case 'await_category':
                return await this.category.handleAddCategory(msg, from, text);

            case 'await_detail_pick':
                return await this.report.handleDetailPick(msg, from, text, cur);

            default:
                this.logger.warn({ from, step: cur.step }, 'Unknown state encountered');
                resetState(from);
                return msg.reply(MSG.menu(from));
        }
    }

    async routeByCommand(msg, from, text, lower, namaUser) {
        this.logger.debug({ from, command: lower }, 'Routing by command');
        
        // PHRASE MAPPING
        if (lower.includes('laporan hari ini')) return msg.reply(await this.reportService.getDailyReport(from));
        if (lower.includes('laporan minggu')) return msg.reply(await this.reportService.getWeeklyReport(from));
        if (lower.includes('laporan bulan')) return msg.reply(await this.reportService.getMonthlyReport(from));
        if (lower.includes('saldo')) return await this.report.showSaldo(msg, from);
        if (lower.includes('riwayat transaksi')) return await this.report.showRiwayat(msg, from);

        // NUMERIC QUICK ACTIONS (Mapped to 1-4 suggestion list)
        if (lower === '1') {
            setState(from, 'await_tipe', {});
            return msg.reply(MSG.chooseTipe());
        }
        if (lower === '2') {
            await msg.reply('📊 Mengambil laporan...');
            return msg.reply(await this.reportService.getDailyReport(from));
        }
        if (lower === '3') {
            await msg.reply('💰 Menghitung saldo...');
            return await this.report.showSaldo(msg, from);
        }
        if (lower === '4') {
            return msg.reply(MSG.dashboard(from));
        }

        // COMMANDS
        if (lower === '/stats') {
            const stats = await this.statsService.getStats(from);
            const health = await this.healthService.calculateScore(from);
            return msg.reply(`${stats}\n\n❤️ *Health Score:* ${health.score}/100`);
        }
        if (lower === '/coach') return msg.reply(await this.coachService.getAdvice(from));
        if (lower === '/pola') {
            const pattern = await this.patternService.getAnomalies(from);
            const predictions = await this.predictionService.predictPatterns(from);
            let response = pattern || '✅ Pola pengeluaran masih stabil.';
            if (predictions && predictions.length > 0) {
                response += `\n\n🔮 *Prediksi Kebiasaan:*\n` + predictions.join('\n');
            }
            return msg.reply(response);
        }
        if (lower === 'dashboard') return msg.reply(MSG.dashboard(from));
        
        // QUICK INPUT DETECTION
        if (text.match(/^(.+?)\s+([\d.,]+[kmbrt]*)$/i)) {
            return await this.transaction.handleManualInput(msg, from, text, { data: {} }, namaUser);
        }

        // FINAL FALLBACK
        return msg.reply(MSG.fallback());
    }

    async routeExport(msg, from) {
        this.logger.info({ from }, 'Handling export request');
        await msg.reply('⏳ Menyiapkan file Excel...');
        // (Delegation to service)
    }
}

module.exports = MessageHandler;