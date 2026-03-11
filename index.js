const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
const Tesseract = require('tesseract.js');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

require('dotenv').config();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getOrCreateProfile(waNumber, nama) {
    const { data } = await supabase.from('user_profiles').select('*').eq('wa_number', waNumber).single();
    if (data) {
        await supabase.from('user_profiles').update({ last_active: new Date().toISOString(), nama }).eq('wa_number', waNumber);
        return data;
    }
    await supabase.from('user_profiles').insert({ wa_number: waNumber, nama });
    return { wa_number: waNumber, nama, is_new: true };
}

async function isNewUser(waNumber) {
    const { count } = await supabase.from('transaksi').select('id', { count: 'exact', head: true }).eq('wa_number', waNumber);
    return count === 0;
}

async function saveTransaction(waNumber, namaUser, data) {
    const { toko, nominal, ai, sumber, catatan, judul, tipe } = data;
    const { error } = await supabase.from('transaksi').insert({
        wa_number:       waNumber,
        nama_user:       namaUser,
        tanggal:         new Date().toISOString().split('T')[0],
        nama_toko:       toko,
        nominal:         nominal,
        kategori:        ai.kategori,
        sub_kategori:    ai.sub,
        sumber_dokumen:  sumber || 'WA Bot',
        confidence_ai:   Math.round(ai.confidence),
        status_validasi: ai.status,
        catatan:         catatan || '',
        judul:           judul || toko,
        tipe:            tipe || 'keluar',
    });
    if (error) throw new Error(error.message);

    const alert = await checkBudgetAlert(waNumber);
    console.log(`✅ [${tipe}] ${judul || toko} | Rp ${nominal.toLocaleString('id-ID')} | ${ai.kategori}`);
    return alert;
}

function getBulanKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function setBudget(waNumber, nominal) {
    const bulan = getBulanKey();
    const { error } = await supabase.from('user_budgets')
        .upsert({ wa_number: waNumber, bulan, budget: nominal }, { onConflict: 'wa_number,bulan' });
    if (error) throw new Error(error.message);
}

async function getBudget(waNumber) {
    const bulan = getBulanKey();
    const { data } = await supabase.from('user_budgets')
        .select('budget').eq('wa_number', waNumber).eq('bulan', bulan).single();
    return data?.budget || null;
}

async function getTotalKeluar(waNumber) {
    const now = new Date();
    const dari = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const { data } = await supabase.from('transaksi')
        .select('nominal').eq('wa_number', waNumber).eq('tipe', 'keluar').gte('tanggal', dari);
    return (data || []).reduce((s, r) => s + parseInt(r.nominal || 0), 0);
}

async function checkBudgetAlert(waNumber) {
    const budget = await getBudget(waNumber);
    if (!budget) return null;
    const total = await getTotalKeluar(waNumber);
    const pct = Math.round((total / budget) * 100);
    if (pct >= 100) return `🚨 *BUDGET HABIS!*\nPengeluaran Rp ${total.toLocaleString('id-ID')} dari budget Rp ${budget.toLocaleString('id-ID')} (${pct}%)`;
    if (pct >= 90) return `⚠️ *Budget hampir habis!* ${pct}% terpakai\nSisa: Rp ${(budget-total).toLocaleString('id-ID')}`;
    if (pct >= 75) return `📊 Budget ${pct}% terpakai. Sisa: Rp ${(budget-total).toLocaleString('id-ID')}`;
    return null;
}

async function getLaporan(waNumber) {
    const now  = new Date();
    const dari = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const bulanNama = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' });

    const { data } = await supabase.from('transaksi')
        .select('nominal, kategori, tipe, judul, nama_toko, tanggal')
        .eq('wa_number', waNumber).gte('tanggal', dari)
        .order('tanggal', { ascending: false });

    if (!data || data.length === 0) return `📭 Belum ada transaksi di ${bulanNama}.`;

    const keluar = data.filter(r => r.tipe !== 'masuk');
    const masuk  = data.filter(r => r.tipe === 'masuk');
    const totalKeluar = keluar.reduce((s, r) => s + parseInt(r.nominal || 0), 0);
    const totalMasuk  = masuk.reduce((s, r) => s + parseInt(r.nominal || 0), 0);

    const byKat = {};
    for (const r of keluar) {
        const kat = r.kategori || 'Lain-lain';
        byKat[kat] = (byKat[kat] || 0) + parseInt(r.nominal || 0);
    }

    const sorted = Object.entries(byKat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxVal = sorted[0]?.[1] || 1;
    const BAR_LEN = 10;

    let msg = `📊 *Laporan ${bulanNama}*\n━━━━━━━━━━━━━━━━━\n`;
    msg += `💸 Keluar : Rp ${totalKeluar.toLocaleString('id-ID')}\n`;
    msg += `💰 Masuk  : Rp ${totalMasuk.toLocaleString('id-ID')}\n`;
    msg += `📝 Total  : ${data.length} transaksi\n\n`;

    // Budget info
    const budget = await getBudget(waNumber);
    if (budget) {
        const pct = Math.min(100, Math.round((totalKeluar / budget) * 100));
        const filled = Math.round((pct / 100) * BAR_LEN);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
        msg += `🎯 *Budget:* [${bar}] ${pct}%\n`;
        msg += `   Rp ${totalKeluar.toLocaleString('id-ID')} / Rp ${budget.toLocaleString('id-ID')}\n\n`;
    }

    msg += `*📈 Top Kategori:*\n`;
    for (const [kat, nom] of sorted) {
        const filled = Math.round((nom / maxVal) * BAR_LEN);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
        msg += `${kat}\n[${bar}] Rp ${nom.toLocaleString('id-ID')}\n`;
    }

    // 5 transaksi terakhir
    msg += `\n*🕐 Terakhir:*\n`;
    for (const r of data.slice(0, 5)) {
        const tgl = new Date(r.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        const icon = r.tipe === 'masuk' ? '💰' : '💸';
        const label = r.judul || r.nama_toko || '-';
        msg += `${icon} ${tgl} ${label} — Rp ${parseInt(r.nominal).toLocaleString('id-ID')}\n`;
    }

    msg += `\n━━━━━━━━━━━━━━━━━\nKetik *menu* untuk kembali`;
    return msg;
}

async function getSaldo(waNumber) {
    const now  = new Date();
    const dari = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const bulanNama = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' });

    const { data } = await supabase.from('transaksi')
        .select('nominal, tipe').eq('wa_number', waNumber).gte('tanggal', dari);

    const totalKeluar = (data||[]).filter(r=>r.tipe!=='masuk').reduce((s,r)=>s+parseInt(r.nominal||0),0);
    const totalMasuk  = (data||[]).filter(r=>r.tipe==='masuk').reduce((s,r)=>s+parseInt(r.nominal||0),0);
    const saldo       = totalMasuk - totalKeluar;
    const rataHari    = now.getDate() > 0 ? Math.round(totalKeluar / now.getDate()) : 0;

    let msg = `💳 *Saldo ${bulanNama}*\n━━━━━━━━━━━━━━━━━\n`;
    msg += `📅 Hari ke-${now.getDate()}\n`;
    msg += `🧾 Transaksi: ${(data||[]).length}\n`;
    msg += `💸 Total Keluar : Rp ${totalKeluar.toLocaleString('id-ID')}\n`;
    msg += `💰 Total Masuk  : Rp ${totalMasuk.toLocaleString('id-ID')}\n`;
    msg += `📊 Saldo Bersih : Rp ${saldo.toLocaleString('id-ID')}${saldo < 0 ? ' ⚠️' : ' ✅'}\n`;
    msg += `📈 Rata-rata keluar/hari: Rp ${rataHari.toLocaleString('id-ID')}\n`;

    const budget = await getBudget(waNumber);
    if (budget) {
        const sisa = budget - totalKeluar;
        const pct  = Math.round((totalKeluar / budget) * 100);
        msg += `\n🎯 *Budget Bulan Ini:*\n`;
        msg += `   Total  : Rp ${budget.toLocaleString('id-ID')}\n`;
        msg += `   Terpakai: ${pct}%\n`;
        msg += `   Sisa   : Rp ${Math.max(0, sisa).toLocaleString('id-ID')}\n`;
    }

    msg += `\nKetik *menu* untuk kembali`;
    return msg;
}

async function getRiwayat(waNumber, limit = 10) {
    const { data } = await supabase.from('transaksi')
        .select('judul, nama_toko, nominal, kategori, tipe, tanggal')
        .eq('wa_number', waNumber)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (!data || data.length === 0) return `📭 Belum ada transaksi.`;

    let msg = `🕐 *Riwayat ${limit} Transaksi Terakhir*\n━━━━━━━━━━━━━━━━━\n`;
    for (const r of data) {
        const tgl   = new Date(r.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        const icon  = r.tipe === 'masuk' ? '💰' : '💸';
        const label = r.judul || r.nama_toko || '-';
        msg += `${icon} *${label}*\n`;
        msg += `   ${tgl} | ${r.kategori} | Rp ${parseInt(r.nominal).toLocaleString('id-ID')}\n`;
    }
    msg += `\nKetik *menu* untuk kembali`;
    return msg;
}

// Export via link (Supabase public URL)
function getExportLink(waNumber) {
    const encoded = encodeURIComponent(waNumber);
    return `${SUPABASE_URL}/rest/v1/transaksi?wa_number=eq.${encoded}&select=tanggal,judul,nama_toko,nominal,tipe,kategori,sub_kategori,catatan&apikey=${SUPABASE_KEY}`;
}

// ═══════════════════════════════════════════════════════════════
// KATEGORI CUSTOM
// ═══════════════════════════════════════════════════════════════
async function getUserCategories(waNumber) {
    const { data } = await supabase.from('user_categories')
        .select('nama, emoji').eq('wa_number', waNumber).order('nama');
    return data || [];
}

async function addUserCategory(waNumber, nama, emoji = '🏷️') {
    const { error } = await supabase.from('user_categories')
        .insert({ wa_number: waNumber, nama, emoji });
    if (error) throw new Error('Kategori sudah ada atau gagal ditambah');
}

// ═══════════════════════════════════════════════════════════════
// KNN DATASET
// ═══════════════════════════════════════════════════════════════
let knnDataset  = [];
let lastKnnLoad = 0;
const KNN_CACHE_MS = 5 * 60 * 1000;

async function loadKnnDataset() {
    const now = Date.now();
    if (knnDataset.length > 0 && (now - lastKnnLoad) < KNN_CACHE_MS) return;
    const { data, error } = await supabase.from('knn_dataset')
        .select('nama_toko, keyword_utama, kategori, sub_kategori');
    if (error) { console.error('❌ KNN load error:', error.message); return; }
    knnDataset = (data || []).map(r => ({
        namaToko: (r.nama_toko     || '').toLowerCase().trim(),
        keyword:  (r.keyword_utama || '').toLowerCase().trim(),
        kategori:  r.kategori      || 'Lain-lain',
        sub:       r.sub_kategori  || 'Uncategorized',
    }));
    lastKnnLoad = now;
    console.log(`📚 KNN: ${knnDataset.length} entri`);
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m+1 }, (_, i) =>
        Array.from({ length: n+1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

function similarityScore(input, target) {
    if (!target || !input) return 0;
    if (input === target) return 1.00;
    if (input.includes(target) || target.includes(input)) return 0.92;
    const ti = input.split(/\s+/), tt = target.split(/\s+/);
    const hits = ti.filter(w => tt.some(tw => tw.includes(w) || w.includes(tw))).length;
    if (hits > 0) return 0.75 + (hits / ti.length) * 0.15;
    const maxLen = Math.max(input.length, target.length);
    return maxLen === 0 ? 1 : 1 - levenshtein(input, target) / maxLen;
}

async function knnAnalysis(tokoInput) {
    await loadKnnDataset();
    const input = tokoInput.toLowerCase().trim();
    let bestScore = 0, bestMatch = null;
    for (const row of knnDataset) {
        const score = Math.max(similarityScore(input, row.namaToko), similarityScore(input, row.keyword));
        if (score > bestScore) { bestScore = score; bestMatch = row; }
    }
    if (bestMatch && bestScore >= 0.55) {
        const confidence = Math.min(99.9, Math.round(bestScore * 1000) / 10);
        return { kategori: bestMatch.kategori, sub: bestMatch.sub, confidence, status: confidence >= 85 ? '✅ Valid' : '🔶 Review', matched: bestMatch.namaToko };
    }
    return null;
}

async function groqAnalysis(tokoInput, judul) {
    if (!GROQ_API_KEY) return null;
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'llama3-8b-8192',
                max_tokens: 80,
                temperature: 0.1,
                messages: [
                    {
                        role: 'system',
                        content: 'Kamu asisten kategorisasi transaksi keuangan Indonesia. Jawab HANYA dalam format JSON tanpa teks lain: {"kategori":"...","sub_kategori":"..."}. Pilih kategori dari: Makanan & Minuman, Transportasi, Kebutuhan Pokok, Kesehatan, Hiburan, Belanja Online, Fashion, Tagihan, Pendidikan, Rumah Tangga, Perjalanan, Lain-lain.',
                    },
                    {
                        role: 'user',
                        content: `Nama toko: "${tokoInput}", Judul: "${judul || tokoInput}". Kategori apa?`,
                    },
                ],
            }),
        });
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        return {
            kategori:   parsed.kategori    || 'Lain-lain',
            sub:        parsed.sub_kategori || 'Uncategorized',
            confidence: 78.0,
            status:     '🤖 Groq AI',
            matched:    null,
        };
    } catch (e) {
        console.warn('⚠️ Groq fallback error:', e.message);
        return null;
    }
}

async function getAIAnalysis(tokoInput, judul = '') {
    // Coba KNN dulu
    const knnResult = await knnAnalysis(tokoInput);
    if (knnResult) return knnResult;

    // Fallback ke Groq AI kalau KNN tidak match
    const groqResult = await groqAnalysis(tokoInput, judul);
    if (groqResult) return groqResult;

    // Default
    return { kategori: 'Lain-lain', sub: 'Uncategorized', confidence: 40.0, status: '⚠️ Review', matched: null };
}

// ═══════════════════════════════════════════════════════════════
// OCR
// ═══════════════════════════════════════════════════════════════
async function extractTextFromImage(base64Image) {
    const tmpFile = path.join(os.tmpdir(), `struk_${Date.now()}.jpg`);
    fs.writeFileSync(tmpFile, Buffer.from(base64Image, 'base64'));
    try {
        const result = await Tesseract.recognize(tmpFile, 'ind+eng');
        return result.data.text;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
}

function parseReceiptText(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    let nominal = 0;

    // Pola total dari struk
    const totalPatterns = [
        /(?:grand\s*total|total\s*bayar|total\s*tagihan|total\s*pembayaran)[^\d]*([\d.,]+)/i,
        /(?:jumlah\s*bayar|tunai|cash\s*payment|bayar)[^\d]*([\d.,]+)/i,
        /(?:total|subtotal|tagihan)[^\d]*([\d.,]+)/i,
        /(?:rp\.?|idr)\s*([\d.,]+)/i,
    ];

    outer: for (const pat of totalPatterns) {
        for (const line of lines) {
            const m = line.match(pat);
            if (m) {
                const val = parseInt(m[1].replace(/[.,]/g, ''));
                if (val >= 1000 && val <= 100_000_000) { nominal = val; break outer; }
            }
        }
    }

    // Fallback: angka terbesar yang masuk akal
    if (nominal === 0) {
        const nums = [...rawText.matchAll(/\b(\d{4,})\b/g)]
            .map(m => parseInt(m[1])).filter(n => n >= 1000 && n <= 100_000_000);
        if (nums.length) nominal = Math.max(...nums);
    }

    // Nama toko dari baris atas (skip baris yang terlalu pendek/angka/URL)
    const tokoLines = lines.slice(0, 8).filter(l =>
        l.length > 2 && l.length < 50 &&
        !/^\d+$/.test(l) &&
        !/^https?/i.test(l) &&
        !/[.]{3,}/.test(l) &&
        !/^\*+$/.test(l) &&
        !/^[-=]+$/.test(l)
    );
    const toko = tokoLines.slice(0, 2).join(' ').substring(0, 60).trim() || 'Unknown';

    // Coba detect tanggal dari struk
    const tglMatch = rawText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    const tanggal = tglMatch ? tglMatch[0] : null;

    return { toko, nominal, tanggal };
}

// ═══════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
const userState = new Map();
const STATE_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit

function getState(from)                { return userState.get(from) || { step: 'idle', data: {}, lastActive: 0 }; }
function setState(from, step, data={}) { userState.set(from, { step, data, lastActive: Date.now() }); }
function resetState(from)              { userState.delete(from); }
function isTimedOut(s)                 { return Date.now() - s.lastActive > STATE_TIMEOUT_MS; }

// ═══════════════════════════════════════════════════════════════
// PESAN TEMPLATE
// ═══════════════════════════════════════════════════════════════
const MSG = {
    welcome: (nama) =>
        `👋 Halo *${nama}*! Selamat datang di *Finance Tracker Bot* 🤖\n\n` +
        `Catat semua transaksi kamu dengan mudah!\n\n` +
        MSG._menuList(),

    menu: () => `📋 *MENU UTAMA*\n━━━━━━━━━━━━━━━━━\n` + MSG._menuList(),

    _menuList: () =>
        `1️⃣  Catat Transaksi\n` +
        `2️⃣  Laporan Bulanan\n` +
        `3️⃣  Saldo & Ringkasan\n` +
        `4️⃣  Riwayat Transaksi\n` +
        `5️⃣  Atur Budget\n` +
        `6️⃣  Kategori Custom\n` +
        `7️⃣  Export Data\n` +
        `8️⃣  Bantuan\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `_Balas angka 1-8_`,

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
        `📸 *2. Foto Struk*\n` +
        `   Kirim foto, bot baca otomatis\n\n` +
        `_Balas 1 atau 2 | ketik *batal* untuk kembali_`,

    askJudul: (toko, nominal) =>
        `📝 *Beri Judul Transaksi*\n━━━━━━━━━━━━━━━━━\n` +
        `🏪 Toko  : ${toko}\n` +
        `💰 Nominal: Rp ${parseInt(nominal).toLocaleString('id-ID')}\n\n` +
        `Ketik judul/keterangan singkat:\n` +
        `_Contoh: Makan siang, Bensin motor, Beli sabun_\n\n` +
        `_(ketik *skip* untuk pakai nama toko sebagai judul)_`,

    confirm: (d) =>
        `🔍 *Konfirmasi Transaksi*\n━━━━━━━━━━━━━━━━━\n` +
        `${d.tipe === 'masuk' ? '💰' : '💸'} *Tipe   :* ${d.tipe === 'masuk' ? 'Pemasukan' : 'Pengeluaran'}\n` +
        `📌 *Judul  :* ${d.judul}\n` +
        `🏪 *Toko   :* ${d.toko}\n` +
        `💵 *Nominal:* Rp ${parseInt(d.nominal).toLocaleString('id-ID')}\n` +
        `🏷️ *Kategori:* ${d.ai.kategori} › ${d.ai.sub}\n` +
        `🤖 *AI     :* ${d.ai.status} (${d.ai.confidence}%)\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `1️⃣ Simpan\n` +
        `2️⃣ Ubah Judul\n` +
        `3️⃣ Ubah Nominal\n` +
        `4️⃣ Batal\n` +
        `_Balas angka 1-4_`,

    saved: (d, alert) => {
        let msg = `✅ *Transaksi Tersimpan!*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `${d.tipe === 'masuk' ? '💰' : '💸'} ${d.tipe === 'masuk' ? 'Pemasukan' : 'Pengeluaran'}\n`;
        msg += `📌 ${d.judul}\n`;
        msg += `🏪 ${d.toko}\n`;
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
        `ℹ️ *Bantuan Finance Tracker v6.0*\n━━━━━━━━━━━━━━━━━\n\n` +
        `*📌 Perintah Cepat:*\n` +
        `• \`menu\` — Menu utama\n` +
        `• \`laporan\` — Laporan bulan ini\n` +
        `• \`saldo\` — Saldo & ringkasan\n` +
        `• \`riwayat\` — 10 transaksi terakhir\n` +
        `• \`budget\` — Atur budget bulanan\n` +
        `• \`export\` — Link download data\n` +
        `• \`batal\` — Batalkan proses\n\n` +
        `*📝 Input Cepat:*\n` +
        `\`Indomaret 50000\`\n\n` +
        `*📸 Scan Struk:*\n` +
        `Kirim foto struk kapan saja\n\n` +
        `*💡 Tips:*\n` +
        `Set budget dulu agar dapat notif kalau hampir habis!\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `_Data tersimpan aman di cloud_ ☁️`,
};

// ═══════════════════════════════════════════════════════════════
// PROSES FOTO
// ═══════════════════════════════════════════════════════════════
async function handlePhoto(msg, from, namaUser) {
    const media = await msg.downloadMedia().catch(() => null);
    if (!media || !media.mimetype.startsWith('image/')) return false;

    await msg.reply('🔍 *Membaca foto struk...*\n⏳ _(5-15 detik)_');

    try {
        const ocrText = await extractTextFromImage(media.data);
        if (!ocrText || ocrText.trim().length < 5) {
            resetState(from);
            await msg.reply('❌ Teks tidak terdeteksi. Coba foto lebih jelas,\natau ketik *menu* untuk input manual.');
            return true;
        }

        const { toko, nominal, tanggal } = parseReceiptText(ocrText);
        if (nominal === 0) {
            resetState(from);
            await msg.reply(`⚠️ *Nominal tidak terdeteksi.*\nToko: _${toko}_\n\nCoba: \`${toko} [nominal]\``);
            return true;
        }

        const ai = await getAIAnalysis(toko, toko);
        // Masuk ke flow judul
        setState(from, 'await_judul', {
            toko, nominal, ai,
            sumber: 'Foto Struk',
            catatan: tanggal ? `Struk tgl ${tanggal}` : 'OCR Tesseract.js',
            tipe: 'keluar',
            namaUser,
        });
        await msg.reply(MSG.askJudul(toko, nominal));
        return true;
    } catch (err) {
        resetState(from);
        await msg.reply(`❌ Gagal proses foto: ${err.message}\n\nKetik *menu* untuk input manual.`);
        return true;
    }
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP CLIENT
// ═══════════════════════════════════════════════════════════════
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] },
});

client.on('qr', qr => { console.log('📱 Scan QR:'); qrcode.generate(qr, { small: true }); });
client.on('auth_failure', msg => console.error('❌ Auth gagal:', msg));
client.on('disconnected', reason => console.warn('⚠️ Terputus:', reason));

client.on('ready', async () => {
    console.log('✅ Finance Tracker Bot v6.0 Online!');
    await loadKnnDataset().catch(e => console.error('❌ KNN:', e.message));
    if (!GROQ_API_KEY) console.warn('⚠️  GROQ_API_KEY kosong — fallback AI nonaktif. Isi di baris 25.');
});

// ═══════════════════════════════════════════════════════════════
// MAIN MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════
client.on('message', async msg => {
    const from      = msg.from;
    if (from.endsWith('@g.us')) return;

    const text  = (msg.body || '').trim();
    const lower = text.toLowerCase();

    let namaKontak = '';
    try {
        const contact = await msg.getContact();
        namaKontak = contact.pushname || contact.name || from.split('@')[0];
    } catch (_) { namaKontak = from.split('@')[0]; }

    console.log(`📩 ${namaKontak}: "${text.substring(0, 60)}"`);

    // Profile
    await getOrCreateProfile(from, namaKontak).catch(() => {});

    // State timeout
    const stateObj = getState(from);
    if (stateObj.step !== 'idle' && isTimedOut(stateObj)) resetState(from);
    const cur = getState(from);

    // ── FOTO ─────────────────────────────────────────────────
    if (msg.hasMedia) {
        if (['idle','menu','await_method','await_photo'].includes(cur.step))
            await handlePhoto(msg, from, namaKontak);
        else if (cur.step === 'await_text')
            await msg.reply('📝 Mode teks aktif. Ketik *batal* dulu lalu pilih foto.');
        return;
    }

    // ── PERINTAH GLOBAL ──────────────────────────────────────
    if (['batal','cancel'].includes(lower))     { resetState(from); return msg.reply(MSG.cancelled()); }
    if (['menu','mulai','start'].includes(lower)) { setState(from,'menu',{}); return msg.reply(MSG.menu()); }
    if (['laporan','report'].includes(lower))    return msg.reply(await getLaporan(from).catch(e=>'❌ '+e.message));
    if (['saldo','balance'].includes(lower))     return msg.reply(await getSaldo(from).catch(e=>'❌ '+e.message));
    if (['riwayat','history'].includes(lower))   return msg.reply(await getRiwayat(from).catch(e=>'❌ '+e.message));
    if (['help','bantuan'].includes(lower))      return msg.reply(MSG.help());
    if (['budget','anggaran'].includes(lower)) {
        const b = await getBudget(from);
        setState(from, 'await_budget', {});
        return msg.reply(MSG.budgetMenu(b));
    }
    if (['export','unduh','download'].includes(lower)) {
        const link = getExportLink(from);
        return msg.reply(`📤 *Export Data Transaksi*\n━━━━━━━━━━━━━━━━━\nBuka link ini di browser:\n\n${link}\n\n_Format: JSON — bisa dibuka di Excel via Data → From Web_`);
    }
    if (['kategori','category'].includes(lower)) {
        const cats = await getUserCategories(from);
        setState(from, 'await_category', {});
        return msg.reply(MSG.categoryMenu(cats));
    }

    // ── IDLE ─────────────────────────────────────────────────
    if (cur.step === 'idle') {
        // Quick input: "Indomaret 50000"
        const q = text.match(/^(.+?)\s+([\d.,]+)\s*$/);
        if (q) {
            const toko    = q[1].trim();
            const nominal = parseInt(q[2].replace(/\./g,'').replace(/,/g,''), 10);
            if (!isNaN(nominal) && nominal > 0) {
                const ai = await getAIAnalysis(toko, toko);
                setState(from, 'await_judul', { toko, nominal, ai, tipe: 'keluar', sumber: 'WA Bot', catatan: 'Input cepat', namaUser: namaKontak });
                return msg.reply(MSG.askJudul(toko, nominal));
            }
        }
        const newUser = await isNewUser(from);
        setState(from, 'menu', {});
        return msg.reply(newUser ? MSG.welcome(namaKontak) : MSG.menu());
    }

    // ── MENU ─────────────────────────────────────────────────
    if (cur.step === 'menu') {
        if (['1','catat','transaksi','input'].includes(lower)) {
            setState(from, 'await_tipe', {}); return msg.reply(MSG.chooseTipe());
        }
        if (['2','laporan','report'].includes(lower))  return msg.reply(await getLaporan(from).catch(e=>'❌ '+e.message));
        if (['3','saldo','balance'].includes(lower))   return msg.reply(await getSaldo(from).catch(e=>'❌ '+e.message));
        if (['4','riwayat','history'].includes(lower)) return msg.reply(await getRiwayat(from).catch(e=>'❌ '+e.message));
        if (['5','budget','anggaran'].includes(lower)) {
            const b = await getBudget(from);
            setState(from, 'await_budget', {});
            return msg.reply(MSG.budgetMenu(b));
        }
        if (['6','kategori','category'].includes(lower)) {
            const cats = await getUserCategories(from);
            setState(from, 'await_category', {});
            return msg.reply(MSG.categoryMenu(cats));
        }
        if (['7','export','unduh'].includes(lower)) {
            const link = getExportLink(from);
            return msg.reply(`📤 *Export Data*\n\n${link}\n\n_Buka di browser → save as JSON_`);
        }
        if (['8','help','bantuan'].includes(lower)) return msg.reply(MSG.help());
        return msg.reply(`❓ Pilih 1-8.\n\n${MSG.menu()}`);
    }

    // ── AWAIT TIPE ───────────────────────────────────────────
    if (cur.step === 'await_tipe') {
        let tipe = null;
        if (['1','keluar','bayar','beli','pengeluaran'].includes(lower)) tipe = 'keluar';
        if (['2','masuk','pemasukan','gaji','terima'].includes(lower))   tipe = 'masuk';
        if (!tipe) return msg.reply(`❓ Pilih *1* Pengeluaran atau *2* Pemasukan.\nKetik *batal* untuk kembali.`);
        setState(from, 'await_method', { tipe });
        return msg.reply(MSG.chooseMethod(tipe));
    }

    // ── AWAIT METHOD ─────────────────────────────────────────
    if (cur.step === 'await_method') {
        const { tipe } = cur.data;
        if (['1','teks','manual','ketik'].includes(lower)) {
            setState(from, 'await_text', { tipe });
            return msg.reply(`📝 Ketik: *Nama Toko Nominal*\nContoh: \`Indomaret 25000\`\n\n_ketik *batal* untuk kembali_`);
        }
        if (['2','foto','photo','struk','gambar'].includes(lower)) {
            setState(from, 'await_photo', { tipe });
            return msg.reply(`📸 Kirim foto struk sekarang.\n💡 Pastikan area TOTAL terlihat jelas.\n\n_ketik *batal* untuk kembali_`);
        }
        return msg.reply(`❓ Pilih *1* teks atau *2* foto.\nKetik *batal* untuk kembali.`);
    }

    // ── AWAIT TEXT ───────────────────────────────────────────
    if (cur.step === 'await_text') {
        const { tipe } = cur.data;
        const m = text.match(/^(.+?)\s+([\d.,]+)\s*$/);
        if (!m) return msg.reply(`❓ Format salah.\nGunakan: *Nama Toko Nominal*\nContoh: \`Indomaret 50000\`\n\nKetik *batal* untuk kembali.`);
        const toko    = m[1].trim();
        const nominal = parseInt(m[2].replace(/\./g,'').replace(/,/g,''), 10);
        if (isNaN(nominal) || nominal <= 0) return msg.reply('❌ Nominal tidak valid.');
        const ai = await getAIAnalysis(toko, toko);
        setState(from, 'await_judul', { toko, nominal, ai, tipe, sumber: 'WA Bot', catatan: 'Input manual', namaUser: namaKontak });
        return msg.reply(MSG.askJudul(toko, nominal));
    }

    // ── AWAIT PHOTO ──────────────────────────────────────────
    if (cur.step === 'await_photo') {
        return msg.reply(`📸 Kirim foto struk, atau ketik *batal* untuk kembali.`);
    }

    // ── AWAIT JUDUL ──────────────────────────────────────────
    if (cur.step === 'await_judul') {
        const d = cur.data;
        const judul = lower === 'skip' ? d.toko : text;
        if (!judul || judul.length < 1) return msg.reply(`Ketik judul transaksi, atau *skip* untuk pakai nama toko.`);

        // Re-analisis dengan judul
        const ai = await getAIAnalysis(d.toko, judul);
        const finalData = { ...d, judul, ai };
        setState(from, 'confirm', finalData);
        return msg.reply(MSG.confirm(finalData));
    }

    // ── CONFIRM ──────────────────────────────────────────────
    if (cur.step === 'confirm') {
        const d = cur.data;

        // 1 = Simpan
        if (['1','ya','yes','ok','oke','simpan'].includes(lower)) {
            try {
                const alert = await saveTransaction(from, d.namaUser || namaKontak, d);
                resetState(from);
                return msg.reply(MSG.saved(d, alert));
            } catch (err) {
                console.error('❌ Save error:', err.message);
                return msg.reply('❌ Gagal menyimpan. Balas *1* lagi untuk retry atau *4* untuk batal.');
            }
        }

        // 2 = Ubah Judul
        if (['2'].includes(lower)) {
            setState(from, 'await_judul_edit', d);
            return msg.reply(`✏️ *Ubah Judul*\n\nJudul sekarang: *${d.judul}*\n\nKetik judul baru:`);
        }

        // 3 = Ubah Nominal
        if (['3'].includes(lower)) {
            setState(from, 'await_nominal_edit', d);
            return msg.reply(`✏️ *Ubah Nominal*\n\nNominal sekarang: *Rp ${parseInt(d.nominal).toLocaleString('id-ID')}*\n\nKetik nominal baru:\n_Contoh: \`75000\`_`);
        }

        // 4 = Batal
        if (['4','batal','cancel','tidak','no'].includes(lower)) {
            resetState(from); return msg.reply(MSG.cancelled());
        }

        return msg.reply(`❓ Balas angka:\n1️⃣ Simpan\n2️⃣ Ubah Judul\n3️⃣ Ubah Nominal\n4️⃣ Batal`);
    }

    // ── AWAIT JUDUL EDIT ─────────────────────────────────────
    if (cur.step === 'await_judul_edit') {
        const d = cur.data;
        if (!text || text.length < 1) return msg.reply(`Ketik judul baru, atau *4* untuk batal.`);
        const updated = { ...d, judul: text };
        setState(from, 'confirm', updated);
        return msg.reply(MSG.confirm(updated));
    }

    // ── AWAIT NOMINAL EDIT ───────────────────────────────────
    if (cur.step === 'await_nominal_edit') {
        const d = cur.data;
        const nominal = parseInt(text.replace(/\./g,'').replace(/,/g,'').replace(/[^0-9]/g,''));
        if (isNaN(nominal) || nominal <= 0)
            return msg.reply(`❌ Nominal tidak valid.\nContoh: \`75000\`\n\nCoba lagi:`);
        const updated = { ...d, nominal };
        setState(from, 'confirm', updated);
        return msg.reply(MSG.confirm(updated));
    }

    // ── AWAIT BUDGET ─────────────────────────────────────────
    if (cur.step === 'await_budget') {
        const nominal = parseInt(text.replace(/\./g,'').replace(/,/g,'').replace(/[^0-9]/g,''));
        if (isNaN(nominal) || nominal <= 0) return msg.reply(`❌ Nominal tidak valid.\nContoh: \`2000000\`\n\nKetik *batal* untuk kembali.`);
        await setBudget(from, nominal);
        resetState(from);
        setState(from, 'menu', {});
        return msg.reply(`✅ *Budget berhasil diset!*\n\n🎯 Budget bulan ini: Rp ${nominal.toLocaleString('id-ID')}\n\nKamu akan dapat notif saat 75%, 90%, dan 100% terpakai.\n\nKetik *menu* untuk kembali.`);
    }

    // ── AWAIT CATEGORY ───────────────────────────────────────
    if (cur.step === 'await_category') {
        let emoji = '🏷️', nama = text;
        const emojiMatch = text.match(/^(\p{Emoji})\s+(.+)$/u);
        if (emojiMatch) { emoji = emojiMatch[1]; nama = emojiMatch[2]; }
        try {
            await addUserCategory(from, nama, emoji);
            const cats = await getUserCategories(from);
            setState(from, 'await_category', {});
            return msg.reply(`✅ Kategori *${emoji} ${nama}* ditambahkan!\n\n${MSG.categoryMenu(cats)}`);
        } catch (e) {
            return msg.reply(`❌ ${e.message}\n\nKetik *batal* untuk kembali.`);
        }
    }

    // Fallback
    resetState(from);
    setState(from, 'menu', {});
    return msg.reply(MSG.menu());
});

client.initialize();