/**
 * WhatsApp Message Templates
 */
const MSG = {
    welcome: (nama, from) =>
        `👋 Halo *${nama}*! Selamat datang di *Finance Tracker Bot* 🤖\n\n` +
        `Catat semua transaksi kamu dengan mudah!\n\n` +
        MSG._menuList(from),

    menu: (from) => `📋 *MENU UTAMA*\n━━━━━━━━━━━━━━━━━\n` + MSG._menuList(from),

    _menuList: (from) =>
        `1️⃣  Catat Transaksi\n` +
        `2️⃣  Laporan Bulanan\n` +
        `3️⃣  Saldo & Ringkasan\n` +
        `4️⃣  Riwayat Transaksi\n` +
        `5️⃣  Atur Budget\n` +
        `6️⃣  Kategori Custom\n` +
        `7️⃣  Export Data (CSV)\n` +
        `8️⃣  Bantuan\n` +
        `9️⃣  Edit / Hapus Transaksi\n` +
        `🔟  Pengaturan Notif Otomatis\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `_Balas angka 1-10 atau ketik perintah_\n\n` +
        `💻 *Akses Web:* https://wa-finance-tracker-dashboard.vercel.app/?id=${from}`,

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
        msg += `_Contoh:_\n`;
        msg += `• Bayar kontrakan\n`;
        msg += `• Kasih uang mama\n`;
        msg += `• Bayar utang Andi\n`;
        msg += `• Belanja titip Siti\n`;
        msg += `• Bayar tagihan listrik\n\n`;
        msg += `_(ketik *skip* untuk pakai nama penerima sebagai judul)_`;
        return msg;
    },

    askJudul: (toko, nominal) =>
        `📝 *Beri Judul Transaksi*\n━━━━━━━━━━━━━━━━━\n` +
        `📝 Deskripsi: ${toko}\n` +
        `💰 Nominal  : Rp ${parseInt(nominal).toLocaleString('id-ID')}\n\n` +
        `Ketik judul/keterangan singkat:\n` +
        `_Contoh: Makan siang, Bensin motor, Beli sabun_\n\n` +
        `_(ketik *skip* untuk pakai deskripsi di atas sebagai judul)_`,

    confirm: (d) => {
        let msg = `🔍 *Konfirmasi Transaksi*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `${d.tipe === 'masuk' ? '💰' : '💸'} *Tipe   :* ${d.tipe === 'masuk' ? 'Pemasukan' : 'Pengeluaran'}\n`;
        msg += `📌 *Judul  :* ${d.judul}\n`;
        msg += `💵 *Nominal:* Rp ${parseInt(d.nominal).toLocaleString('id-ID')}\n`;
        msg += `🏷️ *Kategori:* ${d.ai.kategori} › ${d.ai.sub}\n`;
        msg += `🤖 *AI     :* ${d.ai.status} (${d.ai.confidence}%)\n`;
        msg += `━━━━━━━━━━━━━━━━━\n`;
        msg += `1️⃣ Simpan\n`;
        msg += `2️⃣ Ubah Judul\n`;
        msg += `3️⃣ Ubah Nominal\n`;
        msg += `4️⃣ Batal\n`;
        msg += `5️⃣ Koreksi Kategori _(bantu AI belajar)_\n`;
        msg += `_Balas angka 1-5_`;
        return msg;
    },

    saved: (d, alert) => {
        let msg = `✅ *Transaksi Tersimpan!*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `${d.tipe === 'masuk' ? '💰' : '💸'} ${d.tipe === 'masuk' ? 'Pemasukan' : 'Pengeluaran'}\n`;
        msg += `📌 ${d.judul}\n`;
        msg += `💵 Rp ${parseInt(d.nominal).toLocaleString('id-ID')}\n`;
        msg += `🏷️ ${d.ai.kategori}\n\n`;
        if (alert) msg += `${alert}\n\n`;
        msg += `Ketik *menu* untuk lanjut`;
        return msg;
    },

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
        `• \`detail\` — Lihat detail transaksi\n` +
        `• \`budget\` — Atur budget bulanan\n` +
        `• \`export\` — Download data Excel\n` +
        `• \`notif on/off\` — Atur notifikasi otomatis\n` +
        `• \`batal\` — Batalkan proses\n\n` +
        `*📝 Input Cepat:*\n` +
        `\`Indomaret 50000\`\n\n` +
        `*📸 Scan Struk & Bukti Transfer:*\n` +
        `Kirim foto struk atau screenshot bukti transfer\n` +
        `_Bot otomatis baca nama penerima & nominal_\n\n` +
        `*💡 Tips:*\n` +
        `Set budget dulu agar dapat notif kalau hampir habis!\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `_Data tersimpan aman di cloud_ ☁️`,

    detailList: (rows) => {
        if (!rows || rows.length === 0) return `📭 Belum ada transaksi.`;
        let msg = `🔎 *Pilih Transaksi untuk Lihat Detail*\n━━━━━━━━━━━━━━━━━\n`;
        rows.forEach((r, i) => {
            const tgl   = new Date(r.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            const icon  = r.tipe === 'masuk' ? '💰' : '💸';
            const label = r.judul || r.nama_toko || '-';
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
        msg += `📌 *Judul     :* ${r.judul || '-'}\n`;
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
        msg += `💡 Ketik *hapus* atau *edit* untuk mengelola transaksi ini.\n`;
        msg += `Ketik *menu* untuk kembali`;
        return msg;
    },

    editList: (rows) => {
        if (!rows || rows.length === 0) return `📭 Belum ada transaksi.`;
        let msg = `✏️ *Pilih Transaksi untuk Edit / Hapus*\n━━━━━━━━━━━━━━━━━\n`;
        rows.forEach((r, i) => {
            const label = r.judul || r.nama_toko || '-';
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
        msg += `${icon} *${r.judul || r.nama_toko || '-'}* (Rp ${parseInt(r.nominal).toLocaleString('id-ID')})\n`;
        msg += `🏷️ Kategori: ${r.kategori}\n\n`;
        msg += `Mau ubah apa?\n`;
        msg += `1️⃣ Judul\n`;
        msg += `2️⃣ Nominal\n`;
        msg += `3️⃣ Kategori\n`;
        msg += `4️⃣ Catatan\n`;
        msg += `🗑️ Hapus Transaksi Ini\n`;
        msg += `━━━━━━━━━━━━━━━━━\n`;
        msg += `_Balas angka 1-4, atau ketik *hapus*_\n`;
        msg += `_Ketik *batal* untuk kembali_`;
        return msg;
    },

    deleteConfirm: (r) => {
        let msg = `⚠️ *KONFIRMASI HAPUS*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `Apakah kamu yakin ingin MENGHAPUS transaksi ini permanen?\n\n`;
        msg += `*${r.judul || r.nama_toko}* — Rp ${parseInt(r.nominal).toLocaleString('id-ID')}\n\n`;
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
        `• Gunakan *cahaya cukup*, hindari bayangan\n` +
        `• Jangan terlalu jauh — *penuhi frame* dengan struk\n` +
        `• Hindari foto yang *buram atau goyang*\n\n` +
        `💡 Atau ketik manual: \`Nama Toko Nominal\`\n` +
        `_Contoh: Indomaret 45000_\n\n` +
        `Ketik *menu* untuk kembali.`
};

module.exports = MSG;
