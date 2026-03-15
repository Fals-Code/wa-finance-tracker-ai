/**
 * WhatsApp Message Templates — PATCHED
 * Fix: link dashboard ganti ke vercel URL yang benar
 */
const MSG = {
    welcome: (nama, from) =>
        `👋 Halo *${nama}*! Selamat datang di *Finance Assistant* 🤖\n\n` +
        `Asisten pribadi untuk mengelola keuangan kamu langsung dari WhatsApp.\n\n` +
        MSG.menu(from),

    menu: (from) => {
        const waId = from ? from.split('@')[0] : '';
        return (
            `📊 *FINANCE ASSISTANT*\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `*📝 Catat Transaksi:*\n` +
            `1️⃣  Catat Pengeluaran / Pemasukan\n\n` +
            `*📈 Laporan & Data:*\n` +
            `2️⃣  Laporan Bulan Ini\n` +
            `3️⃣  Saldo & Ringkasan\n` +
            `4️⃣  Riwayat Transaksi\n\n` +
            `*⚙️ Pengaturan:*\n` +
            `5️⃣  Atur Budget Bulanan\n` +
            `6️⃣  Kategori Custom\n` +
            `7️⃣  Export Data Excel\n` +
            `8️⃣  Bantuan & Panduan\n` +
            `9️⃣  Edit / Hapus Transaksi\n` +
            `🔟  Pengaturan Notifikasi\n\n` +
            `*🧠 AI Intelligence:*\n` +
            `🧠 *ai* — Tanya Jawab AI (RAG)\n` +
            `❤️ *health* — Skor Kesehatan Keuangan\n` +
            `🔮 *pola* — Prediksi & Insight Pola\n` +
            `🎯 *target* — Atur & Pantau Tabungan\n` +
            `🤖 *persona* — Ubah Kepribadian AI\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `_Balas angka 1-10 atau ketik perintah AI_\n\n` +
            `💡 Langsung ketik transaksi:\n` +
            `_kopi 20k · bensin 50rb · gaji 5jt_\n\n` +
            `🌐 *Dashboard:* https://wa-finance-tracker-dashboard.vercel.app/${waId ? '?id=' + waId : ''}`
        );
    },

    goalMenu: () =>
        `🎯 *Target Tabungan (Saving Goals)*\n━━━━━━━━━━━━━━━━━\n` +
        `Kelola target masa depanmu:\n\n` +
        `1️⃣  Lihat Semua Target\n` +
        `2️⃣  Tambah Target Baru\n\n` +
        `_Balas 1 atau 2 | ketik *batal* untuk kembali_`,

    askGoalName: () =>
        `✏️ *Nama Target Baru*\n━━━━━━━━━━━━━━━━━\n` +
        `Kamu mau nabung buat apa?\n` +
        `_Contoh: Laptop baru, Menikah, HP baru_\n\n` +
        `_ketik *batal* untuk kembali_`,

    askGoalTarget: (name) =>
        `💵 *Nominal Target: ${name}*\n━━━━━━━━━━━━━━━━━\n` +
        `Berapa total dana yang ingin dikumpulkan?\n` +
        `_Contoh: 5000000 (untuk 5 jt)_\n\n` +
        `_ketik *batal* untuk kembali_`,

    saved: (d, saldo, alert, from) => {
        const icon = d.tipe === 'masuk' ? '💰' : '💸';
        const tipeLabel = d.tipe === 'masuk' ? 'Pemasukan' : 'Pengeluaran';
        let msg = `✅ *Transaksi Berhasil Disimpan!*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `${icon} *${d.judul}*\n`;
        msg += `📂 Tipe     : ${tipeLabel}\n`;
        msg += `💵 Nominal  : *Rp ${parseInt(d.nominal).toLocaleString('id-ID')}*\n`;
        msg += `🏷️ Kategori : ${d.ai.kategori}`;
        if (d.ai.sub && d.ai.sub !== 'Uncategorized') msg += ` › ${d.ai.sub}`;
        msg += `\n🤖 AI       : ${d.ai.status} (${Math.round(d.ai.confidence)}%)\n`;
        if (saldo !== undefined) {
            msg += `\n💳 *Saldo Bulan Ini:* Rp ${parseInt(saldo).toLocaleString('id-ID')}\n`;
        }
        if (alert) msg += `\n${alert}\n`;
        msg += `\n━━━━━━━━━━━━━━━━━\n`;
        msg += `*Selanjutnya:*\n`;
        msg += `1️⃣ Catat transaksi lagi\n`;
        msg += `2️⃣ Lihat laporan bulan ini\n`;
        msg += `3️⃣ Cek saldo\n`;
        msg += `4️⃣ Kembali ke menu\n\n`;
        msg += `_atau ketik *menu* untuk pilihan lain_`;
        return msg;
    },

    confirm: (d) => {
        const icon = d.tipe === 'masuk' ? '💰' : '💸';
        let msg = `🔍 *Konfirmasi Transaksi*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `${icon} *${d.judul || d.toko}*\n\n`;
        msg += `┌─ Detail ────────────────\n`;
        msg += `│ Tipe    : ${d.tipe === 'masuk' ? '💰 Pemasukan' : '💸 Pengeluaran'}\n`;
        msg += `│ Judul   : ${d.judul || '-'}\n`;
        if (d.isTransfer) {
            msg += `│ Penerima: ${d.toko}\n`;
        } else {
            msg += `│ Toko    : ${d.toko}\n`;
        }
        msg += `│ Nominal : *Rp ${parseInt(d.nominal).toLocaleString('id-ID')}*\n`;
        msg += `│ Kategori: ${d.ai.kategori}`;
        if (d.ai.sub && d.ai.sub !== 'Uncategorized') msg += ` › ${d.ai.sub}`;
        msg += `\n│ AI Score: ${d.ai.status} ${Math.round(d.ai.confidence)}%\n`;
        msg += `└─────────────────────────\n\n`;
        msg += `1️⃣ ✅ Simpan\n`;
        msg += `2️⃣ ✏️ Ubah Judul\n`;
        msg += `3️⃣ 💵 Ubah Nominal\n`;
        msg += `4️⃣ ❌ Batal\n`;
        msg += `5️⃣ 🧠 Koreksi Kategori _(bantu AI belajar)_\n\n`;
        msg += `_Balas angka 1-5_`;
        return msg;
    },

    chooseTipe: () =>
        `💳 *Catat Transaksi*\n━━━━━━━━━━━━━━━━━\n` +
        `Jenis transaksi:\n\n` +
        `💸 *1. Pengeluaran* (bayar/beli)\n` +
        `💰 *2. Pemasukan* (gaji/transfer masuk)\n\n` +
        `_Balas 1 atau 2 | ketik *batal* untuk kembali_`,

    chooseMethod: (tipe) =>
        `${tipe === 'masuk' ? '💰' : '💸'} *${tipe === 'masuk' ? 'Catat Pemasukan' : 'Catat Pengeluaran'}*\n━━━━━━━━━━━━━━━━━\n` +
        `Input lewat mana?\n\n` +
        `📝 *1. Teks Manual*\n` +
        `   Format: \`Nama Toko Nominal\`\n\n` +
        `📸 *2. Foto Struk / Bukti Transfer*\n` +
        `   Kirim foto, bot baca otomatis\n\n` +
        `_Balas 1 atau 2 | ketik *batal* untuk kembali_`,

    askTujuanTransfer: (namaPenerima, bankPengirim, nominal) => {
        let msg = `🏦 *Terdeteksi: Bukti Transfer Bank*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `💸 Bank      : ${bankPengirim}\n`;
        if (namaPenerima) msg += `👤 Penerima  : ${namaPenerima}\n`;
        msg += `💵 Nominal   : Rp ${parseInt(nominal).toLocaleString('id-ID')}\n`;
        msg += `\n*Transfer ini untuk apa?*\n`;
        msg += `_Contoh: Bayar kontrakan, Kasih uang mama, Bayar utang_\n\n`;
        msg += `_(ketik *skip* untuk pakai nama penerima sebagai judul)_`;
        return msg;
    },

    askJudul: (toko, nominal) =>
        `📝 *Beri Judul Transaksi*\n━━━━━━━━━━━━━━━━━\n` +
        `🏪 Toko   : ${toko}\n` +
        `💵 Nominal: Rp ${parseInt(nominal).toLocaleString('id-ID')}\n\n` +
        `Ketik judul/keterangan singkat:\n` +
        `_Contoh: Makan siang, Bensin motor, Beli sabun_\n\n` +
        `_(ketik *skip* untuk pakai nama toko sebagai judul)_`,

    fallback: () =>
        `❓ *Perintah tidak dikenali.*\n\n` +
        `💡 *Cara menggunakan:*\n` +
        `• Ketik *menu* untuk daftar fitur\n` +
        `• Langsung ketik transaksi, contoh:\n` +
        `  _kopi 20k_  →  pengeluaran Rp 20.000\n` +
        `  _gaji 5jt_  →  pemasukan Rp 5.000.000\n` +
        `  _bensin 50rb_  →  pengeluaran Rp 50.000\n\n` +
        `📸 Atau kirim foto struk/bukti transfer`,

    dashboard: (from) => {
        const waId = from ? from.split('@')[0] : '';
        return (
            `📊 *Dashboard Keuangan*\n━━━━━━━━━━━━━━━━━\n` +
            `Lihat analisis lengkap di web:\n\n` +
            `https://wa-finance-tracker-dashboard.vercel.app/${waId ? '?id=' + waId : ''}`
        );
    },

    dashboardLink: (from) => {
        const waId = from ? (from.includes('@') ? from.split('@')[0] : from) : '';
        return `https://wa-finance-tracker-dashboard.vercel.app/${waId ? '?id=' + waId : ''}`;
    },

    help: () =>
        `❓ *PANDUAN LENGKAP FINANCE BOT*\n━━━━━━━━━━━━━━━━━\n\n` +
        `📝 *1. CATAT MANUAL (Teks)*\n` +
        `Ketik langsung: \`[Nama] [Nominal]\`\n` +
        `_Contoh:_\n` +
        `• gopay 50k\n` +
        `• bensin 25rb\n` +
        `• gaji 5jt\n\n` +
        `📸 *2. CATAT VIA FOTO*\n` +
        `Kirim foto struk belanja otomatis!\n\n` +
        `🧮 *3. SPLIT BILL (Patungan)*\n` +
        `Kirim foto struk dengan caption "split" atau "patungan".\n` +
        `_Contoh caption: "split dong. Aku nasi goreng, andi mie ayam, siska es teh"_\n\n` +
        `🎙️ *4. CATAT VIA VOICE NOTE*\n` +
        `Malas ngetik? Kirim VN ke bot!\n` +
        `_Contoh: "tadi habis beli kopi lima puluh ribu"_\n\n` +
        `🧠 *5. RAG ANALYTICS (Tanya Jawab AI)*\n` +
        `Tanya apapun tentang keuanganmu bulan ini!\n` +
        `_Contoh: "Berapa total jajan kopiku?" atau "Apakah aku masih aman beli sepatu 500rb?"_\n\n` +
        `⚙️ *FITUR LAIN*\n` +
        `• *menu*, *saldo*, *budget*, *laporan*`,

    cancelled: () => `❌ *Dibatalkan.*\n\nKetik *menu* untuk kembali.`,

    budgetMenu: (budget) =>
        `🎯 *Atur Budget Bulanan*\n━━━━━━━━━━━━━━━━━\n` +
        (budget ? `Budget saat ini: Rp ${budget.toLocaleString('id-ID')}\n\n` : `Belum ada budget.\n\n`) +
        `Ketik nominal budget baru:\n_Contoh: \`2000000\` untuk Rp 2 juta_\n\n` +
        `_ketik *batal* untuk kembali_`,

    categoryMenu: (cats) => {
        let msg = `🏷️ *Kategori Custom*\n━━━━━━━━━━━━━━━━━\n`;
        if (cats.length === 0) {
            msg += `Belum ada kategori custom.\n\n`;
        } else {
            msg += `Kategorimu:\n`;
            cats.forEach((c, i) => msg += `${i+1}. ${c.emoji} ${c.nama}\n`);
            msg += `\n`;
        }
        msg += `Ketik nama kategori baru untuk menambah:\n_Contoh: \`Hobi\` atau \`🎮 Gaming\`_\n\n`;
        msg += `_ketik *batal* untuk kembali_`;
        return msg;
    },

    help: () =>
        `ℹ️ *Bantuan Finance Tracker v6.2*\n━━━━━━━━━━━━━━━━━\n\n` +
        `*📌 Perintah Cepat:*\n` +
        `• \`menu\` — Menu utama\n` +
        `• \`laporan\` — Laporan bulan ini\n` +
        `• \`saldo\` — Saldo & ringkasan\n` +
        `• \`riwayat\` — 10 transaksi terakhir\n` +
        `• \`budget\` — Atur budget bulanan\n` +
        `• \`export\` — Download data Excel\n` +
        `• \`notif on/off\` — Atur notifikasi otomatis\n` +
        `• \`batal\` — Batalkan proses\n\n` +
        `*📝 Input Cepat:*\n` +
        `\`Indomaret 50000\` atau \`kopi 20k\`\n\n` +
        `*📸 Scan Struk & Bukti Transfer:*\n` +
        `Kirim foto struk atau screenshot bukti transfer\n` +
        `_Bot otomatis baca nama penerima & nominal_\n\n` +
        `*💡 Tips:*\n` +
        `Set budget dulu agar dapat notif kalau hampir habis!\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `_Data tersimpan aman di cloud_ ☁️`,

    otpMessage: (code) =>
        `🔐 *Kode login dashboard kamu*\n\n` +
        `*${code}*\n\n` +
        `⏳ Kode ini berlaku 5 menit`,

    detailList: (rows) => {
        if (!rows || rows.length === 0) return `📭 Belum ada transaksi.`;
        let msg = `🔎 *Pilih Transaksi untuk Lihat Detail*\n━━━━━━━━━━━━━━━━━\n`;
        rows.forEach((r, i) => {
            const tgl   = new Date(r.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            const icon  = r.tipe === 'masuk' ? '💰' : '💸';
            const label = r.judul || r.deskripsi || r.nama_toko || 'Transaksi';
            const nom   = parseInt(r.nominal).toLocaleString('id-ID');
            msg += `*${i + 1}.* ${icon} ${label}\n`;
            msg += `    ${tgl} | ${r.kategori} | Rp ${nom}\n`;
        });
        msg += `\n_Balas nomor (1-${rows.length}) untuk lihat detail_\n`;
        msg += `_Ketik *batal* untuk kembali_`;
        return msg;
    },

    detailTrx: (r) => {
        const tgl = new Date(r.tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const createdAt = new Date(r.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const icon = r.tipe === 'masuk' ? '💰' : '💸';
        let msg = `${icon} *Detail Transaksi*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `📌 *Judul     :* ${r.judul || r.deskripsi || '-'}\n`;
        msg += `🏪 *Toko      :* ${r.nama_toko || '-'}\n`;
        msg += `💵 *Nominal   :* Rp ${parseInt(r.nominal).toLocaleString('id-ID')}\n`;
        msg += `🔄 *Tipe      :* ${r.tipe === 'masuk' ? 'Pemasukan 💰' : 'Pengeluaran 💸'}\n`;
        msg += `🏷️ *Kategori  :* ${r.kategori || '-'}\n`;
        msg += `   *Sub       :* ${r.sub_kategori || '-'}\n`;
        msg += `📅 *Tanggal   :* ${tgl}\n`;
        msg += `📝 *Catatan   :* ${r.catatan || '-'}\n`;
        msg += `📄 *Sumber    :* ${r.sumber_dokumen || '-'}\n`;
        msg += `🤖 *AI Status :* ${r.status_validasi || '-'} (${r.confidence_ai || 0}%)\n`;
        msg += `🕐 *Dicatat   :* ${createdAt}\n`;
        msg += `🔑 *ID        :* \`${r.id}\`\n`;
        msg += `━━━━━━━━━━━━━━━━━\n`;
        msg += `💡 Ketik *hapus* atau *edit* untuk mengelola.\n`;
        msg += `Ketik *menu* untuk kembali`;
        return msg;
    },

    editList: (rows) => {
        if (!rows || rows.length === 0) return `📭 Belum ada transaksi.`;
        let msg = `✏️ *Pilih Transaksi untuk Edit / Hapus*\n━━━━━━━━━━━━━━━━━\n`;
        rows.forEach((r, i) => {
            const label = r.judul || r.deskripsi || r.nama_toko || 'Transaksi';
            const nom   = parseInt(r.nominal).toLocaleString('id-ID');
            msg += `*${i + 1}.* ${label} (Rp ${nom})\n`;
        });
        msg += `\n_Balas nomor (1-${rows.length})_\n`;
        msg += `_Ketik *batal* untuk kembali_`;
        return msg;
    },

    editMenu: (r) => {
        const icon = r.tipe === 'masuk' ? '💰' : '💸';
        let msg = `✏️ *Edit Transaksi*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `${icon} *${r.judul || r.deskripsi || r.nama_toko || 'Transaksi'}* (Rp ${parseInt(r.nominal).toLocaleString('id-ID')})\n`;
        msg += `🏷️ Kategori: ${r.kategori}\n\n`;
        msg += `Mau ubah apa?\n`;
        msg += `1️⃣ Judul\n2️⃣ Nominal\n3️⃣ Kategori\n4️⃣ Catatan\n`;
        msg += `🗑️ Ketik *hapus* untuk menghapus\n`;
        msg += `━━━━━━━━━━━━━━━━━\n`;
        msg += `_Balas angka 1-4 atau ketik *hapus*_\n`;
        msg += `_Ketik *batal* untuk kembali_`;
        return msg;
    },

    deleteConfirm: (r) => {
        let msg = `⚠️ *KONFIRMASI HAPUS*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `Apakah kamu yakin ingin MENGHAPUS transaksi ini permanen?\n\n`;
        msg += `*${r.judul || r.deskripsi || r.nama_toko || 'Transaksi'}* — Rp ${parseInt(r.nominal).toLocaleString('id-ID')}\n\n`;
        msg += `Ketik *YA* untuk menghapus.\n`;
        msg += `Ketik *BATAL* untuk membatalkan.`;
        return msg;
    },

    MSG_BUKAN_STRUK:
        `❌ *Foto bukan struk transaksi.*\n\n` +
        `📋 *Tips foto struk yang baik:*\n` +
        `• Pastikan foto adalah *struk/nota belanja* atau *bukti transfer*\n` +
        `• Posisikan kamera *tepat di atas struk*, jangan miring\n` +
        `• Pastikan area *TOTAL* terbaca jelas\n` +
        `• Gunakan *cahaya cukup*, hindari bayangan\n\n` +
        `💡 Atau ketik manual: \`Nama Toko Nominal\`\n` +
        `_Contoh: Indomaret 45000_\n\n` +
        `Ketik *menu* untuk kembali.`
};

module.exports = MSG;