const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'user_settings.json');

function getUserSettings() {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) return {};
        const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('Error reading user_settings.json:', e);
        return {};
    }
}

function saveUserSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4));
    } catch (e) {
        console.error('Error writing user_settings.json:', e);
    }
}

function initScheduler(client, supabase, getLaporan) {
    console.log('⏳ Scheduler diinisialisasi...');

    // Helper untuk mengirim pesan broadcast
    const broadcast = async (msgFunction, type) => {
        const settings = getUserSettings();
        const activeUsers = Object.keys(settings).filter(wa => settings[wa].notif_enabled);
        
        if (activeUsers.length === 0) return;
        console.log(`📡 Broadcast ${type} ke ${activeUsers.length} user...`);

        for (const wa of activeUsers) {
            try {
                // Jangan broadcast group
                if (wa.endsWith('@g.us')) continue;
                
                const msg = await msgFunction(wa);
                if (msg) {
                    await client.sendMessage(wa, msg);
                    // Jeda sedikit untuk menghindari anti-spam WA
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error(`❌ Gagal kirim ${type} ke ${wa}:`, error.message);
            }
        }
    };

    // 1. Notifikasi Harian (Setiap jam 21:00)
    // Ringkasan pengeluaran hari ini
    cron.schedule('0 21 * * *', async () => {
        console.log('⏰ Menjalankan Cron Harian...');
        await broadcast(async (wa) => {
            const today = new Date().toISOString().split('T')[0];
            const { data } = await supabase.from('transaksi')
                .select('nominal, judul, nama_toko')
                .eq('wa_number', wa)
                .eq('tipe', 'keluar')
                .eq('tanggal', today);
            
            if (!data || data.length === 0) return null; // Tidak kirim kalau tidak ada trx hari ini
            
            const total = data.reduce((sum, r) => sum + parseInt(r.nominal), 0);
            
            let msg = `🌙 *Ringkasan Pengeluaran Hari Ini*\n━━━━━━━━━━━━━━━━━\n`;
            msg += `Total Keluar: *Rp ${total.toLocaleString('id-ID')}*\n\n`;
            data.forEach((r, i) => {
                msg += `• ${r.judul || r.nama_toko} (Rp ${parseInt(r.nominal).toLocaleString('id-ID')})\n`;
            });
            msg += `\n_Ketik *notif off* untuk mematikan_`;
            return msg;
        }, 'Harian');
    });

    // 2. Notifikasi Mingguan (Setiap Senin jam 07:00)
    // Ringkasan 7 hari terakhir
    cron.schedule('0 7 * * 1', async () => {
        console.log('⏰ Menjalankan Cron Mingguan...');
        await broadcast(async (wa) => {
            const now = new Date();
            const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const dateStr = lastWeek.toISOString().split('T')[0];

            const { data } = await supabase.from('transaksi')
                .select('nominal')
                .eq('wa_number', wa)
                .eq('tipe', 'keluar')
                .gte('tanggal', dateStr);
            
            if (!data || data.length === 0) return null;
            
            const total = data.reduce((sum, r) => sum + parseInt(r.nominal), 0);
            
            let msg = `🌅 *Selamat Pagi! Ringkasan Minggu Lalu*\n━━━━━━━━━━━━━━━━━\n`;
            msg += `Total Pengeluaran: *Rp ${total.toLocaleString('id-ID')}*\n\n`;
            msg += `_Semoga minggu ini lebih hemat ya!_\n`;
            msg += `_Ketik *notif off* untuk mematikan_`;
            return msg;
        }, 'Mingguan');
    });

    // 3. Notifikasi Bulanan (Setiap tanggal 1 jam 08:00)
    // Laporan bulan kemarin
    cron.schedule('0 8 1 * *', async () => {
        console.log('⏰ Menjalankan Cron Bulanan...');
        await broadcast(async (wa) => {
            // Karena laporan bulan lalu butuh logic spesifik,
            // saat ini kita panggil getLaporan tapi ingat getLaporan membaca bulan berjalan.
            // Kita harus kirim laporan full.
            const report = await getLaporan(wa);
            let msg = `📊 *Laporan Transaksi Awal Bulan*\n━━━━━━━━━━━━━━━━━\n`;
            msg += report;
            msg += `\n_Ketik *notif off* untuk mematikan_`;
            return msg;
        }, 'Bulanan');
    });
}

function toggleNotif(wa, isEnabled) {
    const settings = getUserSettings();
    if (!settings[wa]) settings[wa] = {};
    settings[wa].notif_enabled = isEnabled;
    saveUserSettings(settings);
    return isEnabled;
}

function checkNotif(wa) {
    const settings = getUserSettings();
    if (!settings[wa]) return false; // Default off untuk privasi
    return settings[wa].notif_enabled === true;
}

module.exports = {
    initScheduler,
    toggleNotif,
    checkNotif
};
