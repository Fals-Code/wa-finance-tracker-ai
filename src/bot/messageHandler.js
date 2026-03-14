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
        this.exportService = services.exportService; // Added
        this.scheduler = null; // Will be injected via index.js
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
                switch (lower) {
                    case '1': case 'catat': case 'transaksi':
                        setState(from, 'await_tipe', {});
                        return msg.reply(MSG.chooseTipe());
                    
                    case '2': case 'laporan': case 'report':
                        await msg.reply('📊 Mengambil laporan bulan ini...');
                        return msg.reply(await this.reportService.getMonthlyReport(from).catch(e => '❌ ' + e.message));
                    
                    case '3': case 'saldo': case 'balance':
                        await msg.reply('💰 Menghitung saldo...');
                        return await this.report.showSaldo(msg, from);
                    
                    case '4': case 'riwayat': case 'history':
                        await msg.reply('📜 Mengambil riwayat transaksi...');
                        return await this.report.showRiwayat(msg, from);
                    
                    case '5': case 'budget': case 'anggaran':
                        return await this.budget.showMenu(msg, from);
                    
                    case '6': case 'kategori': case 'category':
                        return await this.category.showMenu(msg, from);
                    
                    case '7': case 'export': case 'unduh': case 'download':
                        return await this.routeExport(msg, from);
                    
                    case '8': case 'help': case 'bantuan':
                        return msg.reply(MSG.help());
                    
                    case '9': case 'edit': case 'hapus': case 'ubah': {
                        const rows = await this.db.getHistory(from, 8);
                        setState(from, 'await_edit_select', { rows });
                        return msg.reply(MSG.editList(rows));
                    }
                    
                    case '10': case 'notif': case 'notifikasi': case 'pengaturan notif': {
                        const isEnable = this.scheduler ? this.scheduler.checkNotif(from) : false;
                        return msg.reply(
                            `🔔 *Pengaturan Notifikasi*\n━━━━━━━━━━━━━━━━━\n` +
                            `Status saat ini: *${isEnable ? 'AKTIF ✅' : 'NONAKTIF ❌'}*\n\n` +
                            `Jika aktif, bot akan mengirim:\n` +
                            `• ☀️ Ringkasan Harian (pukul 21:00)\n` +
                            `• 📅 Laporan Mingguan (Senin 07:00)\n` +
                            `• 📊 Laporan Bulanan (Tgl 1 pukul 08:00)\n\n` +
                            `_Ketik *notif on* untuk mengaktifkan_\n` +
                            `_Ketik *notif off* untuk mematikan_\n\n` +
                            `Ketik *menu* untuk kembali.`
                        );
                    }
                    
                    case 'dashboard':
                        return msg.reply(MSG.dashboard(from));
                    
                    default: {
                        // Coba deteksi input cepat (toko nominal)
                        const q = text.match(/^(.+?)\s+([\d.,]+[kmbrt]*)$/i);
                        if (q) {
                            return await this.transaction.handleManualInput(msg, from, text, { data: {} }, namaUser);
                        }
                        return msg.reply(`❓ Pilih menu 1-10 atau ketik perintah.\n\n${MSG.menu(from)}`);
                    }
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

            case 'await_detail_view':
                const { trx } = cur.data;
                if (lower.includes('hapus') || lower === 'delete') {
                    setState(from, 'await_delete_confirm', { trx });
                    return msg.reply(
                        `⚠️ *KONFIRMASI HAPUS*\n━━━━━━━━━━━━━━━━━\n` +
                        `Hapus: *${trx.judul || trx.nama_toko || trx.deskripsi}* — Rp ${parseInt(trx.nominal).toLocaleString('id-ID')}?\n\n` +
                        `Ketik *YA* untuk hapus atau *batal* untuk kembali.`
                    );
                }
                if (lower.includes('edit') || lower.includes('ubah')) {
                    setState(from, 'await_edit_action', { trx });
                    return msg.reply(MSG.editMenu(trx));
                }
                resetState(from);
                return msg.reply(MSG.menu(from));

            case 'await_delete_confirm':
                const { trx: trxDel } = cur.data;
                if (lower === 'ya' || lower === 'yes') {
                    try {
                        await this.db.deleteTransaction(from, trxDel.id);
                        resetState(from);
                        return msg.reply(`✅ Transaksi *${trxDel.judul || trxDel.deskripsi || trxDel.nama_toko}* berhasil dihapus.\n\nKetik *menu* untuk kembali.`);
                    } catch (e) {
                        this.logger.error({ from, err: e.message }, 'Delete failed');
                        resetState(from);
                        return msg.reply(`❌ Gagal menghapus: ${e.message}`);
                    }
                }
                resetState(from);
                return msg.reply(MSG.cancelled());

            case 'await_edit_select': {
                const { rows, intent } = cur.data;
                const idx = parseInt(lower) - 1;
                if (lower === 'hapus') {
                    setState(from, 'await_edit_select', { rows, intent: 'delete' });
                    return msg.reply(`❓ Nomor transaksi yang mau dihapus? (1-${rows.length})\nKetik *batal* untuk kembali.`);
                }
                const hapusMatch = lower.match(/^hapus\s+(\d+)$/);
                if (hapusMatch) {
                    const hIdx = parseInt(hapusMatch[1]) - 1;
                    if (hIdx >= 0 && hIdx < rows.length) {
                        setState(from, 'await_delete_confirm', { trx: rows[hIdx] });
                        return msg.reply(MSG.deleteConfirm(rows[hIdx]));
                    }
                }
                if (isNaN(idx) || idx < 0 || idx >= rows.length) {
                    return msg.reply(`❓ Pilih nomor 1-${rows.length} atau ketik *batal*.`);
                }
                if (intent === 'delete') {
                    setState(from, 'await_delete_confirm', { trx: rows[idx] });
                    return msg.reply(MSG.deleteConfirm(rows[idx]));
                }
                setState(from, 'await_edit_action', { trx: rows[idx] });
                return msg.reply(MSG.editMenu(rows[idx]));
            }

            case 'await_edit_action': {
                const { trx } = cur.data;
                if (lower.includes('hapus') || lower === 'delete') {
                    setState(from, 'await_delete_confirm', { trx });
                    return msg.reply(MSG.deleteConfirm(trx));
                }
                const fieldMap = { '1': 'judul', '2': 'nominal', '3': 'kategori', '4': 'catatan' };
                const fieldName = fieldMap[lower];
                if (!fieldName) return msg.reply(`❓ Pilih 1-4 atau ketik *hapus*. Ketik *batal* untuk kembali.`);
                setState(from, 'await_edit_value', { trx, field: fieldName });
                if (fieldName === 'kategori') {
                    return msg.reply(
                        `🏷️ *Pilih Kategori Baru:*\n1. Makanan & Minuman\n2. Transportasi\n3. Kebutuhan Pokok\n4. Kesehatan\n5. Hiburan\n6. Belanja Online\n7. Fashion\n8. Tagihan\n9. Pendidikan\n10. Rumah Tangga\n11. Perjalanan\n12. Investasi\n13. Lain-lain\n\n_Balas angka 1-13_`
                    );
                }
                return msg.reply(`✏️ *Ubah ${fieldName}*\n\nNilai saat ini: *${trx[fieldName] || '-'}*\n\nKetik nilai baru:`);
            }

            case 'await_edit_value': {
                const { trx, field } = cur.data;
                let newValue = text;
                if (field === 'nominal') {
                    newValue = parseInt(text.replace(/\D/g, ''));
                    if (isNaN(newValue) || newValue <= 0) return msg.reply(`❌ Nominal tidak valid.\nContoh: \`75000\`\n\nCoba lagi:`);
                } else if (field === 'kategori') {
                    const kMap = { '1':'Makanan & Minuman','2':'Transportasi','3':'Kebutuhan Pokok','4':'Kesehatan','5':'Hiburan','6':'Belanja Online','7':'Fashion','8':'Tagihan','9':'Pendidikan','10':'Rumah Tangga','11':'Perjalanan','12':'Investasi','13':'Lain-lain' };
                    newValue = kMap[lower] || text;
                }
                try {
                    await this.db.updateTransaction(from, trx.id, { [field]: newValue });
                    resetState(from);
                    return msg.reply(`✅ *Transaksi Diperbarui!*\n\n${field.charAt(0).toUpperCase() + field.slice(1)}: ${trx[field] || '-'} → *${newValue}*\n\nKetik *menu* untuk kembali.`);
                } catch (e) {
                    this.logger.error({ from, err: e.message }, 'Update transaction failed');
                    return msg.reply(`❌ Gagal mengubah: ${e.message}\n\nKetik *batal* untuk kembali.`);
                }
            }

            case 'await_kategori_koreksi': {
                const d = cur.data;
                const kMap = { '1':'Makanan & Minuman','2':'Transportasi','3':'Kebutuhan Pokok','4':'Kesehatan','5':'Hiburan','6':'Belanja Online','7':'Fashion','8':'Tagihan','9':'Pendidikan','10':'Rumah Tangga','11':'Perjalanan','12':'Investasi','13':'Lain-lain' };
                const kategori = kMap[lower] || text;
                if (!kategori || kategori.length < 3) return msg.reply(`❌ Pilih angka 1-13.\nKetik *batal* untuk kembali.`);
                setState(from, 'await_sub_koreksi', { ...d, newKategori: kategori });
                return msg.reply(`✏️ *Kategori: ${kategori}*\n\nKetik sub-kategori:\n_Contoh: Fast Food, BBM, Ojek Online_\n\n_Ketik *skip* untuk otomatis_`);
            }

            case 'await_sub_koreksi': {
                const d = cur.data;
                const sub = lower === 'skip' ? d.newKategori : text;
                const correctedAI = { ...d.ai, kategori: d.newKategori, sub, confidence: 99.0, status: '✅ Dikoreksi', method: 'User Feedback' };
                this.ai.saveFeedback(from, d.toko, d.newKategori, sub).catch(() => {});
                setState(from, 'await_confirm', { ...d, ai: correctedAI });
                return msg.reply(`✅ *Kategori diperbarui!*\n🧠 AI akan belajar dari koreksi ini.\n\n${MSG.confirm({ ...d, ai: correctedAI })}`);
            }

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
        if (/^\d+$/.test(text.trim()) && parseInt(text) > 0) {
            setState(from, 'menu', {});
            return msg.reply(MSG.menu(from));
        }

        if (text.match(/^(.+?)\s+([\d.,]+[kmbrt]*)$/i)) {
            return await this.transaction.handleManualInput(msg, from, text, { data: {} }, namaUser);
        }

        // NOTIF TOGGLE
        if (lower === 'notif on' || lower === 'notif off') {
            const isEnable = lower === 'notif on';
            if (this.scheduler) {
                this.scheduler.toggleNotif(from, isEnable);
            }
            return msg.reply(isEnable 
                ? `🔔 *Notifikasi Aktif!*\nKamu akan menerima ringkasan harian pukul 21:00.`
                : `🔕 *Notifikasi Dimatikan.*`
            );
        }

        // FINAL FALLBACK
        setState(from, 'menu', {});
        return msg.reply(`${MSG.fallback()}\n\n${MSG.menu(from)}`);
    }

    async routeExport(msg, from) {
        this.logger.info({ from }, 'Handling export request');
        await msg.reply('⏳ Menyiapkan file Excel...');
        
        try {
            const os = require('os');
            const path = require('path');
            const fs = require('fs');
            const { MessageMedia } = require('whatsapp-web.js');
            
            const now = new Date();
            const bulanKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const tmpPath = path.join(os.tmpdir(), `transaksi_${Date.now()}.xlsx`);
            
            const ok = this.exportService 
                ? await this.exportService.generateExportXLSX(from, tmpPath)
                : false;
                
            if (!ok) {
                return msg.reply('📭 Belum ada data transaksi untuk di-export.');
            }
            
            const media = MessageMedia.fromFilePath(tmpPath);
            media.filename = `transaksi_${bulanKey}.xlsx`;
            media.mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            
            await msg.reply(media, undefined, {
                caption: `📊 *Export Data Transaksi*\n✅ File Excel siap!\n• Kuning = pengeluaran\n• Hijau = pemasukan`
            });
            
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        } catch (e) {
            this.logger.error({ from, err: e.message }, 'Export failed');
            await msg.reply('❌ Gagal export. Coba lagi nanti.');
        }
    }
}

module.exports = MessageHandler;