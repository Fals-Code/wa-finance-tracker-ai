/**
 * Message Handler (Router) — PATCHED VERSION
 * Fix: case menu '5' s/d '10' sekarang ter-handle dengan benar
 * Fix: global commands di routeByCommand juga diperlengkap
 */

const { getState, setState, resetState, isTimedOut } = require('../utils/stateManager');
const MSG = require('../constants/messages');
const rateLimiter = require('../utils/rateLimiter');

class MessageHandler {
    constructor(controllers, services, logger) {
        this.transaction = controllers.transaction;
        this.report      = controllers.report;
        this.budget      = controllers.budget;
        this.category    = controllers.category;
        this.media       = controllers.media;

        this.db               = services.db;
        this.ai               = services.ai;
        this.reportService    = services.report;
        this.insightService   = services.insight;
        this.statsService     = services.stats;
        this.patternService   = services.patternInsight;
        this.coachService     = services.coach;
        this.healthService    = services.health;
        this.predictionService = services.prediction;
        this.otpService       = services.otp;
        this.exportService    = services.exportService;
        this.scheduler        = null; // injected via index.js
        this.logger           = logger;
    }

    async handle(msg) {
        if (msg.isStatus) return;
        let from = msg.from;
        if (from.endsWith('@g.us')) return;

        if (rateLimiter.isRateLimited(from)) {
            this.logger.warn({ from }, 'rate limit');
            return;
        }

        const text  = (msg.body || '').trim();
        const lower = text.toLowerCase();

        // 1. Normalize ID
        const originalFrom = from;
        let contactObj = null;
        try {
            contactObj = await msg.getContact();
            if (contactObj.number) from = contactObj.number + '@c.us';
        } catch (e) {
            this.logger.error(e);
        }

        if (originalFrom !== from) {
            await this.db.migrateUser(originalFrom, from).catch(() => {});
        }

        const namaUser = contactObj
            ? (contactObj.pushname || contactObj.name || from.split('@')[0])
            : from.split('@')[0];

        this.logger.info({ from, user: namaUser, text: text.substring(0, 50) }, 'Incoming');

        await this.db.getOrCreateProfile(from, namaUser).catch(() => {});

        const stateObj = getState(from);
        if (stateObj.step !== 'idle' && isTimedOut(stateObj)) resetState(from);
        const cur = getState(from);

        // 2. Handle Media
        if (msg.hasMedia) {
            if (['idle', 'menu', 'await_method', 'await_photo'].includes(cur.step)) {
                return await this.media.handlePhoto(msg, from, namaUser);
            } else if (cur.step === 'await_text') {
                return await msg.reply('📝 Mode teks aktif. Ketik *batal* dulu lalu pilih foto.');
            }
            return;
        }

        // 3. Global Priority Commands (selalu jalan di state apapun)
        if (['batal', 'cancel'].includes(lower)) {
            resetState(from);
            return msg.reply(MSG.cancelled());
        }
        if (['menu', 'mulai', 'start', 'home'].includes(lower)) {
            resetState(from);
            setState(from, 'menu', {});
            return msg.reply(MSG.menu(from));
        }

        // 4. State Handlers
        // PENTING: state 'menu' HARUS masuk routeByState agar case '5'-'10' ter-handle
        // Sebelumnya ada bug: `cur.step !== 'menu'` di-exclude → semua angka 5-10 fallback
        if (cur.step !== 'idle') {
            return await this.routeByState(msg, from, cur, text, lower, namaUser);
        }

        // 5. Jika idle, pastikan set state ke menu dulu sebelum routing command
        // Ini memastikan pesan berikutnya sudah punya konteks
        setState(from, 'menu', {});
        return await this.routeByCommand(msg, from, text, lower, namaUser, cur);
    }

    // ================================================================
    // ROUTE BY STATE
    // ================================================================
    async routeByState(msg, from, cur, text, lower, namaUser) {
        this.logger.debug({ from, step: cur.step }, 'Routing by state');

        switch (cur.step) {

            // ── MENU ──────────────────────────────────────────────────
            case 'menu':
                switch (lower) {

                    // --- CATAT TRANSAKSI ---
                    case '1': case 'catat': case 'transaksi': case 'input':
                        setState(from, 'await_tipe', {});
                        return msg.reply(MSG.chooseTipe());

                    // --- LAPORAN BULANAN ---
                    case '2': case 'laporan': case 'report':
                    case 'laporan bulan': case 'laporan bulanan':
                        await msg.reply('📊 _Mengambil laporan bulan ini..._');
                        return msg.reply(
                            await this.reportService.getMonthlyReport(from)
                                .catch(e => '❌ ' + e.message)
                        );

                    // --- SALDO & RINGKASAN ---
                    case '3': case 'saldo': case 'balance': case 'ringkasan':
                        await msg.reply('💰 _Menghitung saldo..._');
                        return await this.report.showSaldo(msg, from);

                    // --- RIWAYAT ---
                    case '4': case 'riwayat': case 'history':
                        await msg.reply('📜 _Mengambil riwayat transaksi..._');
                        return await this.report.showRiwayat(msg, from);

                    // --- BUDGET ---
                    case '5': case 'budget': case 'anggaran': case 'atur budget':
                        return await this.budget.showMenu(msg, from);

                    // --- KATEGORI CUSTOM ---
                    case '6': case 'kategori': case 'category': case 'kategori custom':
                        return await this.category.showMenu(msg, from);

                    // --- EXPORT ---
                    case '7': case 'export': case 'unduh': case 'download': case 'excel':
                        return await this.routeExport(msg, from);

                    // --- BANTUAN ---
                    case '8': case 'help': case 'bantuan': case 'panduan':
                        return msg.reply(MSG.help());

                    // --- EDIT / HAPUS ---
                    case '9': case 'edit': case 'hapus': case 'ubah': case 'edit transaksi': {
                        const rows = await this.db.getHistory(from, 8);
                        setState(from, 'await_edit_select', { rows });
                        return msg.reply(MSG.editList(rows));
                    }

                    // --- NOTIFIKASI ---
                    case '10': case 'notif': case 'notifikasi': case 'pengaturan notif': {
                        const isActive = this.scheduler && this.scheduler.checkNotif ? this.scheduler.checkNotif(from) : (this.scheduler && this.scheduler.isNotifActive ? this.scheduler.isNotifActive(from) : false);
                        return msg.reply(
                            `🔔 *Pengaturan Notifikasi*\n` +
                            `━━━━━━━━━━━━━━━━━\n` +
                            `Status saat ini: *${isActive ? '✅ AKTIF' : '❌ NONAKTIF'}*\n\n` +
                            `Jika aktif, bot akan mengirim:\n` +
                            `• ☀️ Ringkasan Harian (21:00)\n` +
                            `• 📅 Laporan Mingguan (Senin 07:00)\n` +
                            `• 📊 Laporan Bulanan (Tgl 1 08:00)\n\n` +
                            `Ketik *notif on* untuk mengaktifkan\n` +
                            `Ketik *notif off* untuk mematikan\n\n` +
                            `Ketik *menu* untuk kembali.`
                        );
                    }

                    // --- NOTIF TOGGLE LANGSUNG ---
                    case 'notif on': case 'notif off': {
                        const isEnable = lower === 'notif on';
                        if (this.scheduler) this.scheduler.toggleNotif(from, isEnable);
                        return msg.reply(isEnable
                            ? `🔔 *Notifikasi AKTIF!*\n\nBot akan mengirim ringkasan harian pukul 21:00.\n\nKetik *menu* untuk kembali.`
                            : `🔕 *Notifikasi DIMATIKAN.*\n\nKetik *menu* untuk kembali.`
                        );
                    }

                    // --- DASHBOARD LINK ---
                    case 'dashboard': case 'web':
                        return msg.reply(MSG.dashboard(from));

                    // --- DEFAULT (quick input atau tidak dikenal) ---
                    default: {
                        // Coba deteksi quick input "Toko Nominal"
                        const q = text.match(/^(.+?)\s+([\d.,]+[kmbrtjuta]*)$/i);
                        if (q) {
                            return await this.transaction.handleManualInput(
                                msg, from, text, { data: {} }, namaUser
                            );
                        }
                        return msg.reply(
                            `❓ Pilih menu *1–10* atau ketik perintah.\n\n${MSG.menu(from)}`
                        );
                    }
                }

            // ── AWAIT TIPE ─────────────────────────────────────────
            case 'await_tipe': {
                let tipe = null;
                if (['1', 'keluar', 'bayar', 'beli', 'pengeluaran'].includes(lower)) tipe = 'keluar';
                if (['2', 'masuk', 'pemasukan', 'gaji', 'terima'].includes(lower)) tipe = 'masuk';
                if (!tipe) return msg.reply(`❓ Pilih *1* Pengeluaran atau *2* Pemasukan.\nKetik *batal* untuk kembali.`);
                setState(from, 'await_method', { tipe });
                return msg.reply(MSG.chooseMethod(tipe));
            }

            // ── AWAIT METHOD ────────────────────────────────────────
            case 'await_method': {
                const { tipe } = cur.data;
                if (['1', 'teks', 'manual', 'ketik'].includes(lower)) {
                    setState(from, 'await_text', { tipe });
                    return msg.reply(
                        `📝 *Input Manual*\n━━━━━━━━━━━━━━━━━\n` +
                        `Ketik: *Nama Toko Nominal*\n\n` +
                        `Contoh:\n` +
                        `• \`Indomaret 25000\`\n` +
                        `• \`Kopi 20k\`\n` +
                        `• \`Gaji 5jt\`\n\n` +
                        `_Ketik *batal* untuk kembali_`
                    );
                }
                if (['2', 'foto', 'photo', 'struk', 'gambar'].includes(lower)) {
                    setState(from, 'await_photo', { tipe });
                    return msg.reply(
                        `📸 *Kirim Foto Struk / Bukti Transfer*\n━━━━━━━━━━━━━━━━━\n` +
                        `Bot akan otomatis:\n` +
                        `• Baca nama toko / penerima\n` +
                        `• Deteksi total belanja\n` +
                        `• Kategorikan dengan AI\n\n` +
                        `_Ketik *batal* untuk kembali_`
                    );
                }
                return msg.reply(`❓ Pilih *1* teks atau *2* foto.\nKetik *batal* untuk kembali.`);
            }

            // ── AWAIT TEXT ──────────────────────────────────────────
            case 'await_text':
                return await this.transaction.handleManualInput(msg, from, text, cur, namaUser);

            // ── AWAIT PHOTO ─────────────────────────────────────────
            case 'await_photo':
                return msg.reply(`📸 Kirim foto struk atau bukti transfer.\nKetik *batal* untuk kembali.`);

            // ── AWAIT JUDUL / TUJUAN TRANSFER ───────────────────────
            case 'await_judul':
            case 'await_tujuan_transfer':
                return await this.transaction.handleJudul(msg, from, text, cur);

            // ── AWAIT CONFIRM ────────────────────────────────────────
            case 'await_confirm':
                return await this.transaction.handleConfirm(msg, from, text, cur, namaUser);

            // ── AWAIT SAVED ACTION ────────────────────────────────────
            // State khusus setelah transaksi tersimpan.
            // Mencegah angka 1-4 di pesan "Selanjutnya:" diinterpretasikan
            // sebagai pilihan menu utama (misal: 4 → riwayat transaksi).
            case 'await_saved_action':
                switch (lower) {
                    case '1': case 'catat': case 'catat lagi':
                        setState(from, 'await_tipe', {});
                        return msg.reply(MSG.chooseTipe());
                    case '2': case 'laporan':
                        resetState(from);
                        await msg.reply('📊 _Mengambil laporan bulan ini..._');
                        return msg.reply(await this.reportService.getMonthlyReport(from).catch(e => '❌ ' + e.message));
                    case '3': case 'saldo':
                        resetState(from);
                        await msg.reply('💰 _Menghitung saldo..._');
                        return await this.report.showSaldo(msg, from);
                    case '4': case 'menu': case 'kembali':
                        resetState(from);
                        setState(from, 'menu', {});
                        return msg.reply(MSG.menu(from));
                    default:
                        // Coba quick input transaksi baru
                        if (text.match(/^(.+?)\s+([\d.,]+[kmbrtjuta]*)$/i)) {
                            return await this.transaction.handleManualInput(msg, from, text, { data: {} }, namaUser);
                        }
                        // Fallback ke menu
                        resetState(from);
                        setState(from, 'menu', {});
                        return msg.reply(MSG.menu(from));
                }

            // ── AWAIT NOMINAL EDIT ───────────────────────────────────
            case 'await_nominal_edit':
                return await this.transaction.handleNominalEdit(msg, from, text, cur);

            // ── AWAIT AI LEARNING ────────────────────────────────────
            case 'await_ai_learning':
                return await this.transaction.handleAILearning(msg, from, text, cur);

            // ── AWAIT DUPLICATE CONFIRM ──────────────────────────────
            case 'await_duplicate_confirm':
                return await this.transaction.handleDuplicateConfirm(msg, from, text, cur);

            // ── AWAIT ANOMALY CONFIRM ────────────────────────────────
            case 'await_anomaly_confirm':
                return await this.transaction.handleAnomalyConfirm(msg, from, text, cur);

            // ── AWAIT BUDGET ─────────────────────────────────────────
            case 'await_budget':
                return await this.budget.handleSetBudget(msg, from, text);

            // ── AWAIT CATEGORY ───────────────────────────────────────
            case 'await_category':
                return await this.category.handleAddCategory(msg, from, text);

            // ── AWAIT DETAIL PICK ────────────────────────────────────
            case 'await_detail_pick':
                return await this.report.handleDetailPick(msg, from, text, cur);

            // ── AWAIT DETAIL VIEW ────────────────────────────────────
            case 'await_detail_view': {
                const { trx } = cur.data;
                if (lower.includes('hapus') || lower === 'delete') {
                    setState(from, 'await_delete_confirm', { trx });
                    return msg.reply(
                        `⚠️ *KONFIRMASI HAPUS*\n━━━━━━━━━━━━━━━━━\n` +
                        `Hapus: *${trx.judul || trx.nama_toko || trx.deskripsi}*\n` +
                        `Nominal: Rp ${parseInt(trx.nominal).toLocaleString('id-ID')}\n\n` +
                        `Ketik *YA* untuk hapus atau *batal* untuk kembali.`
                    );
                }
                if (lower.includes('edit') || lower.includes('ubah')) {
                    setState(from, 'await_edit_action', { trx });
                    return msg.reply(MSG.editMenu(trx));
                }
                resetState(from);
                return msg.reply(MSG.menu(from));
            }

            // ── AWAIT DELETE CONFIRM ─────────────────────────────────
            case 'await_delete_confirm': {
                const { trx: trxDel } = cur.data;
                if (lower === 'ya' || lower === 'yes') {
                    try {
                        await this.db.deleteTransaction(from, trxDel.id);
                        resetState(from);
                        return msg.reply(
                            `✅ *Transaksi Berhasil Dihapus*\n\n` +
                            `_${trxDel.judul || trxDel.deskripsi || trxDel.nama_toko}_ ` +
                            `(Rp ${parseInt(trxDel.nominal).toLocaleString('id-ID')}) telah dihapus.\n\n` +
                            `Ketik *menu* untuk kembali.`
                        );
                    } catch (e) {
                        this.logger.error({ from, err: e.message }, 'Delete failed');
                        resetState(from);
                        return msg.reply(`❌ Gagal menghapus: ${e.message}`);
                    }
                }
                resetState(from);
                return msg.reply(MSG.cancelled());
            }

            // ── AWAIT EDIT SELECT ────────────────────────────────────
            case 'await_edit_select': {
                const { rows, intent } = cur.data;

                // "hapus N" langsung
                const hapusMatch = lower.match(/^hapus\s+(\d+)$/);
                if (hapusMatch) {
                    const hIdx = parseInt(hapusMatch[1]) - 1;
                    if (hIdx >= 0 && hIdx < rows.length) {
                        setState(from, 'await_delete_confirm', { trx: rows[hIdx] });
                        return msg.reply(MSG.deleteConfirm(rows[hIdx]));
                    }
                }

                // "hapus" saja → tanya nomor
                if (lower === 'hapus') {
                    setState(from, 'await_edit_select', { rows, intent: 'delete' });
                    return msg.reply(`❓ Nomor berapa yang ingin dihapus? (1–${rows.length})\nKetik *batal* untuk kembali.`);
                }

                const idx = parseInt(lower) - 1;
                if (isNaN(idx) || idx < 0 || idx >= rows.length) {
                    return msg.reply(`❓ Pilih nomor *1–${rows.length}* atau ketik *batal*.`);
                }

                if (intent === 'delete') {
                    setState(from, 'await_delete_confirm', { trx: rows[idx] });
                    return msg.reply(MSG.deleteConfirm(rows[idx]));
                }

                setState(from, 'await_edit_action', { trx: rows[idx] });
                return msg.reply(MSG.editMenu(rows[idx]));
            }

            // ── AWAIT EDIT ACTION ────────────────────────────────────
            case 'await_edit_action': {
                const { trx } = cur.data;
                if (lower.includes('hapus') || lower === 'delete') {
                    setState(from, 'await_delete_confirm', { trx });
                    return msg.reply(MSG.deleteConfirm(trx));
                }
                const fieldMap = {
                    '1': 'judul', '2': 'nominal', '3': 'kategori', '4': 'catatan'
                };
                const fieldName = fieldMap[lower];
                if (!fieldName) {
                    return msg.reply(`❓ Pilih 1–4 untuk mengubah, atau ketik *hapus*.\nKetik *batal* untuk kembali.`);
                }
                setState(from, 'await_edit_value', { trx, field: fieldName });
                if (fieldName === 'kategori') {
                    return msg.reply(
                        `🏷️ *Pilih Kategori Baru:*\n━━━━━━━━━━━━━━━━━\n` +
                        `1. Makanan & Minuman\n2. Transportasi\n3. Kebutuhan Pokok\n` +
                        `4. Kesehatan\n5. Hiburan\n6. Belanja Online\n7. Fashion\n` +
                        `8. Tagihan\n9. Pendidikan\n10. Rumah Tangga\n11. Perjalanan\n` +
                        `12. Investasi\n13. Lain-lain\n\n_Balas angka 1–13_`
                    );
                }
                return msg.reply(
                    `✏️ *Ubah ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}*\n\n` +
                    `Nilai saat ini: *${trx[fieldName] || '-'}*\n\nKetik nilai baru:`
                );
            }

            // ── AWAIT EDIT VALUE ─────────────────────────────────────
            case 'await_edit_value': {
                const { trx, field } = cur.data;
                let newValue = text;
                if (field === 'nominal') {
                    newValue = parseInt(text.replace(/\D/g, ''));
                    if (isNaN(newValue) || newValue <= 0)
                        return msg.reply(`❌ Nominal tidak valid.\nContoh: \`75000\`\n\nCoba lagi:`);
                } else if (field === 'kategori') {
                    const kMap = {
                        '1': 'Makanan & Minuman', '2': 'Transportasi', '3': 'Kebutuhan Pokok',
                        '4': 'Kesehatan', '5': 'Hiburan', '6': 'Belanja Online', '7': 'Fashion',
                        '8': 'Tagihan', '9': 'Pendidikan', '10': 'Rumah Tangga',
                        '11': 'Perjalanan', '12': 'Investasi', '13': 'Lain-lain'
                    };
                    newValue = kMap[lower] || text;
                }
                try {
                    await this.db.updateTransaction(from, trx.id, { [field]: newValue });
                    resetState(from);
                    return msg.reply(
                        `✅ *Transaksi Diperbarui!*\n\n` +
                        `${field.charAt(0).toUpperCase() + field.slice(1)}: ` +
                        `${trx[field] || '-'} → *${newValue}*\n\n` +
                        `Ketik *menu* untuk kembali.`
                    );
                } catch (e) {
                    this.logger.error({ from, err: e.message }, 'Update transaction failed');
                    return msg.reply(`❌ Gagal mengubah: ${e.message}\n\nKetik *batal* untuk kembali.`);
                }
            }

            // ── AWAIT KATEGORI KOREKSI ───────────────────────────────
            case 'await_kategori_koreksi': {
                const d = cur.data;
                const kMap = {
                    '1': 'Makanan & Minuman', '2': 'Transportasi', '3': 'Kebutuhan Pokok',
                    '4': 'Kesehatan', '5': 'Hiburan', '6': 'Belanja Online', '7': 'Fashion',
                    '8': 'Tagihan', '9': 'Pendidikan', '10': 'Rumah Tangga',
                    '11': 'Perjalanan', '12': 'Investasi', '13': 'Lain-lain'
                };
                const kategori = kMap[lower] || text;
                if (!kategori || kategori.length < 3)
                    return msg.reply(`❌ Pilih angka 1–13.\nKetik *batal* untuk kembali.`);
                setState(from, 'await_sub_koreksi', { ...d, newKategori: kategori });
                return msg.reply(
                    `✅ Kategori: *${kategori}*\n\n` +
                    `Ketik sub-kategori:\n` +
                    `_Contoh: Fast Food, BBM, Ojek Online, Streaming_\n\n` +
                    `_Ketik *skip* untuk otomatis_`
                );
            }

            // ── AWAIT SUB KOREKSI ────────────────────────────────────
            case 'await_sub_koreksi': {
                const d = cur.data;
                const sub = lower === 'skip' ? d.newKategori : text;
                const correctedAI = {
                    ...d.ai,
                    kategori: d.newKategori,
                    sub,
                    confidence: 99.0,
                    status: '✅ Dikoreksi',
                    method: 'User Feedback'
                };
                this.ai.saveFeedback(from, d.toko, d.newKategori, sub).catch(() => {});
                setState(from, 'await_confirm', { ...d, ai: correctedAI });
                return msg.reply(
                    `✅ *Kategori diperbarui!*\n` +
                    `🧠 AI akan belajar dari koreksi ini.\n\n` +
                    MSG.confirm({ ...d, ai: correctedAI })
                );
            }

            // ── DEFAULT ──────────────────────────────────────────────
            default:
                this.logger.warn({ from, step: cur.step }, 'Unknown state');
                resetState(from);
                return msg.reply(MSG.menu(from));
        }
    }

    // ================================================================
    // ROUTE BY COMMAND
    // Dipanggil saat user di state idle. State sudah di-set ke 'menu' sebelumnya.
    // Juga handle angka 1-10 agar user yang baru saja melihat menu bisa langsung pilih.
    // ================================================================
    async routeByCommand(msg, from, text, lower, namaUser, cur) {
        this.logger.debug({ from, command: lower }, 'Routing by command');

        // --- Angka menu 1-10: redirect ke routeByState dengan state 'menu' ---
        // Ini fix agar user yang idle tapi ketik angka tetap ter-handle
        if (/^([1-9]|10)$/.test(lower.trim())) {
            const fakeMenuState = { step: 'menu', data: {}, lastActive: Date.now() };
            return await this.routeByState(msg, from, fakeMenuState, text, lower, namaUser);
        }

        // --- Global command aliases ---
        if (['laporan', 'report', 'laporan bulan', 'laporan bulanan'].includes(lower)) {
            await msg.reply('📊 _Mengambil laporan bulan ini..._');
            return msg.reply(
                await this.reportService.getMonthlyReport(from).catch(e => '❌ ' + e.message)
            );
        }
        if (['saldo', 'balance', 'ringkasan'].includes(lower)) {
            await msg.reply('💰 _Menghitung saldo..._');
            return await this.report.showSaldo(msg, from);
        }
        if (['riwayat', 'history'].includes(lower)) {
            await msg.reply('📜 _Mengambil riwayat..._');
            return await this.report.showRiwayat(msg, from);
        }
        if (['budget', 'anggaran'].includes(lower))
            return await this.budget.showMenu(msg, from);
        if (['kategori', 'category'].includes(lower))
            return await this.category.showMenu(msg, from);
        if (['export', 'unduh', 'download', 'excel'].includes(lower))
            return await this.routeExport(msg, from);
        if (['help', 'bantuan', 'panduan'].includes(lower))
            return msg.reply(MSG.help());
        if (['edit', 'hapus', 'ubah'].includes(lower)) {
            const rows = await this.db.getHistory(from, 8);
            setState(from, 'await_edit_select', { rows });
            return msg.reply(MSG.editList(rows));
        }
        if (['notif on', 'notif off'].includes(lower)) {
            const isEnable = lower === 'notif on';
            if (this.scheduler) this.scheduler.toggleNotif(from, isEnable);
            return msg.reply(isEnable
                ? `🔔 *Notifikasi AKTIF!*\n\nKetik *menu* untuk kembali.`
                : `🔕 *Notifikasi DIMATIKAN.*\n\nKetik *menu* untuk kembali.`
            );
        }
        if (['notif', 'notifikasi'].includes(lower)) {
            const isActive = this.scheduler && this.scheduler.checkNotif ? this.scheduler.checkNotif(from) : (this.scheduler && this.scheduler.isNotifActive ? this.scheduler.isNotifActive(from) : false);
            setState(from, 'menu', {});
            return msg.reply(
                `🔔 *Pengaturan Notifikasi*\n━━━━━━━━━━━━━━━━━\n` +
                `Status: *${isActive ? '✅ AKTIF' : '❌ NONAKTIF'}*\n\n` +
                `Ketik *notif on* untuk aktifkan\n` +
                `Ketik *notif off* untuk matikan\n\n` +
                `Ketik *menu* untuk kembali.`
            );
        }
        if (['dashboard', 'web'].includes(lower))
            return msg.reply(MSG.dashboard(from));

        // --- Phrase laporan ---
        if (lower.includes('laporan hari ini'))  return msg.reply(await this.reportService.getDailyReport(from));
        if (lower.includes('laporan minggu'))    return msg.reply(await this.reportService.getWeeklyReport(from));
        if (lower.includes('laporan bulan'))     return msg.reply(await this.reportService.getMonthlyReport(from));
        if (lower.includes('saldo'))             return await this.report.showSaldo(msg, from);

        // --- Advanced commands ---
        if (lower === '/stats') {
            const stats  = await this.statsService.getStats(from);
            const health = await this.healthService.calculateScore(from);
            return msg.reply(`${stats}\n\n❤️ *Health Score:* ${health.score}/100 — ${health.label}`);
        }
        if (lower === '/coach')  return msg.reply(await this.coachService.getAdvice(from));
        if (lower === '/pola') {
            const pattern     = await this.patternService.getAnomalies(from);
            const predictions = await this.predictionService.predictPatterns(from);
            let response = pattern || '✅ Pola pengeluaran masih stabil.';
            if (predictions && predictions.length > 0) {
                response += `\n\n🔮 *Prediksi Kebiasaan:*\n` + predictions.join('\n');
            }
            return msg.reply(response);
        }

        // --- Quick input: "Toko Nominal" ---
        if (text.match(/^(.+?)\s+([\d.,]+[kmbrtjuta]*)$/i)) {
            return await this.transaction.handleManualInput(msg, from, text, { data: {} }, namaUser);
        }

        // --- Notif toggle langsung ---
        if (lower.startsWith('notif')) {
            const isEnable = lower.includes('on');
            if (this.scheduler) this.scheduler.toggleNotif(from, isEnable);
            return msg.reply(isEnable
                ? `🔔 *Notifikasi AKTIF!*`
                : `🔕 *Notifikasi DIMATIKAN.*`
            );
        }

        // --- Fallback → Welcome / Menu ---
        const isNew = await this.db.isNewUser(from).catch(() => false);
        setState(from, 'menu', {});
        if (isNew) {
            return msg.reply(MSG.welcome(namaUser, from));
        }
        return msg.reply(`${MSG.fallback()}\n\n${MSG.menu(from)}`);
    }

    // ================================================================
    // ROUTE EXPORT
    // ================================================================
    async routeExport(msg, from) {
        this.logger.info({ from }, 'Handling export request');
        await msg.reply('⏳ _Menyiapkan file Excel..._');

        try {
            const os   = require('os');
            const path = require('path');
            const fs   = require('fs');
            const { MessageMedia } = require('whatsapp-web.js');

            const now      = new Date();
            const bulanKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const tmpPath  = path.join(os.tmpdir(), `transaksi_${Date.now()}.xlsx`);

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
                caption:
                    `📊 *Export Data Transaksi*\n` +
                    `━━━━━━━━━━━━━━━━━\n` +
                    `✅ File Excel siap diunduh!\n\n` +
                    `• Baris kuning = pengeluaran\n` +
                    `• Baris hijau  = pemasukan\n` +
                    `• Kolom nominal sudah format Rp\n` +
                    `• Filter & freeze header otomatis`
            });

            try {
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            } catch (_) {}

        } catch (e) {
            this.logger.error({ from, err: e.message }, 'Export failed');
            await msg.reply('❌ Gagal export. Coba lagi nanti.\n\nKetik *menu* untuk kembali.');
        }
    }
}

module.exports = MessageHandler;