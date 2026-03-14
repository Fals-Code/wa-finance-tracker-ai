/**
 * Message Handler (Router)
 * Pure router that delegates message processing to specific controllers
 * Includes Rate Limiting
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
        this.reportService = services.report;      // Added
        this.insightService = services.insight;    // Added
        this.statsService = services.stats;        // Added
        this.patternService = services.patternInsight; // Added
        this.logger = logger;
    }

    async handle(msg) {
        if (msg.isStatus) return;
        
        let from = msg.from;
        if (from.endsWith('@g.us')) return;

        // 0. Rate Limiting
        if (rateLimiter.isRateLimited(from)) {
            this.logger.warn({ from }, 'Rate limit exceeded');
            // Silently ignore or send a simple warning once?
            // Sending too many warnings would also be spam.
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
            this.logger.error({ from: originalFrom, err: e.message }, 'ID Normalization failed');
        }

        if (originalFrom !== from) {
            await this.db.migrateUser(originalFrom, from).catch(e => this.logger.error({ old: originalFrom, new: from, err: e.message }, 'Migration failed'));
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
            setState(from, 'menu', {}); 
            return msg.reply(MSG.menu(from)); 
        }

        // 4. State Handlers (Routing by State)
        if (cur.step !== 'idle' && cur.step !== 'menu') {
            return await this.routeByState(msg, from, cur, text, lower, namaUser);
        }

        // 5. Direct Commands (idle/menu)
        return await this.routeByCommand(msg, from, text, lower, namaUser);
    }

    async routeByState(msg, from, cur, text, lower, namaUser) {
        this.logger.debug({ from, step: cur.step }, 'Routing by state');
        
        switch (cur.step) {
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
                    return msg.reply(`📝 Ketik: *Nama Toko Nominal*`);
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

            case 'await_budget':
                return await this.budget.handleSetBudget(msg, from, text);

            case 'await_category':
                return await this.category.handleAddCategory(msg, from, text);

            case 'await_detail_pick':
                return await this.report.handleDetailPick(msg, from, text, cur);

            default:
                this.logger.warn({ from, step: cur.step }, 'Unknown state encountered');
                resetState(from);
                return msg.reply('⚠️ Sesuatu salah. Kembali ke menu.');
        }
    }

    async routeByCommand(msg, from, text, lower, namaUser) {
        this.logger.debug({ from, command: lower }, 'Routing by command');
        
        if (['laporan', 'report'].includes(lower)) return await this.transaction.showLaporan(msg, from);
        if (['saldo', 'balance'].includes(lower)) return await this.transaction.showSaldo(msg, from);
        if (['riwayat', 'history'].includes(lower)) return await this.transaction.showRiwayat(msg, from);
        if (['help', 'bantuan'].includes(lower)) return msg.reply(MSG.help());
        if (['budget'].includes(lower)) return await this.budget.showMenu(msg, from);
        if (['kategori'].includes(lower)) return await this.category.showMenu(msg, from);
        if (['export'].includes(lower)) return await this.routeExport(msg, from);
        
        // New Assistant Commands
        if (lower === '/hariini') return msg.reply(await this.reportService.getDailyReport(from));
        if (lower === '/minggu') return msg.reply(await this.reportService.getWeeklyReport(from));
        if (lower === '/bulan') return msg.reply(await this.reportService.getMonthlyReport(from));
        if (lower === '/insight') return msg.reply(await this.insightService.getMonthlyInsight(from));
        if (lower === '/stats') return msg.reply(await this.statsService.getStats(from));
        if (lower === '/pola') {
            const pattern = await this.patternService.getAnomalies(from);
            return msg.reply(pattern || '✅ Belum ada pola aneh terdeteksi.');
        }

        // Budget Setting Command: set budget [kategori] [nominal]
        const budgetMatch = text.match(/^set budget\s+(.+?)\s+([\d.,]+[kmbrt]*)$/i);
        if (budgetMatch) {
            const kategori = budgetMatch[1];
            const parsed = require('../utils/transactionParser').parse(`temp ${budgetMatch[2]}`);
            if (parsed && parsed.nominal > 0) {
                await this.budget.db.budgetService.setCategoryBudget(from, kategori, parsed.nominal);
                return msg.reply(`✅ Budget *${kategori}* diset ke *Rp ${parsed.nominal.toLocaleString('id-ID')}*`);
            }
        }
        
        // Quick Input Detection
        // This is where we also apply validation soon if we move it to controller
        if (text.match(/^(.+?)\s+([\d.,]+)\s*$/)) {
            return await this.transaction.handleManualInput(msg, from, text, { data: {} }, namaUser);
        }

        const newUser = await this.db.isNewUser(from);
        setState(from, 'menu', {});
        return msg.reply(newUser ? MSG.welcome(namaUser, from) : MSG.menu(from));
    }

    async routeExport(msg, from) {
        this.logger.info({ from }, 'Handling export request');
        await msg.reply('⏳ Menyiapkan file Excel...');
        // (Delegation to service)
    }
}

module.exports = MessageHandler;
