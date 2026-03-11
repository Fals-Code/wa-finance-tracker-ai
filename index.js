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

// ═══════════════════════════════════════════════════════════════
// EXPORT DATA — format XLSX rapi siap buka di Excel/Sheets
// ═══════════════════════════════════════════════════════════════
const { execFile } = require('child_process');

async function generateExportXLSX(waNumber, outPath) {
    const { data, error } = await supabase
        .from('transaksi')
        .select('tanggal,judul,nama_toko,nominal,tipe,kategori,sub_kategori,catatan')
        .eq('wa_number', waNumber)
        .order('tanggal', { ascending: false });

    if (error || !data || data.length === 0) return false;

    const payload = JSON.stringify({ rows: data, outpath: outPath });

    return new Promise((resolve, reject) => {
        // Panggil script Python untuk generate XLSX
        const scriptPath = path.join(__dirname, 'gen_xlsx.py');
        const proc = execFile('python3', [scriptPath], (err, stdout, stderr) => {
            if (err) { console.error('xlsx gen error:', stderr); return reject(err); }
            resolve(true);
        });
        proc.stdin.write(payload);
        proc.stdin.end();
    });
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
// ML ENGINE v2 — TF-IDF + KNN Voting + Feedback Learning
// ═══════════════════════════════════════════════════════════════

let knnDataset   = [];
let lastKnnLoad  = 0;
let idfMap       = {};       // IDF weights per token
let feedbackCache = {};      // wa_number → [{toko, kategori, sub}]
const KNN_CACHE_MS = 5 * 60 * 1000;
const KNN_K        = 5;      // top-K neighbors untuk voting

// ── STOP WORDS Indonesia + Umum ────────────────────────────────
const STOP_WORDS = new Set([
    'di','dan','ke','yang','ini','itu','dengan','untuk','dari','dalam',
    'atau','juga','akan','ada','tidak','bisa','kita','kami','saya','anda',
    'the','a','an','of','in','at','by','to','for','on','is','are','was',
    'toko','warung','kedai','gerai','cabang','outlet','pusat','pt','cv','tb',
]);

// ── TOKENIZER ──────────────────────────────────────────────────
function tokenize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

// ── BUILD IDF dari dataset ──────────────────────────────────────
function buildIDF(dataset) {
    const N = dataset.length;
    const df = {};
    for (const row of dataset) {
        const tokens = new Set([...tokenize(row.namaToko), ...tokenize(row.keyword)]);
        for (const t of tokens) df[t] = (df[t] || 0) + 1;
    }
    const idf = {};
    for (const [t, freq] of Object.entries(df)) {
        idf[t] = Math.log((N + 1) / (freq + 1)) + 1; // smooth IDF
    }
    return idf;
}

// ── TF-IDF VECTOR ──────────────────────────────────────────────
function tfidfVector(tokens, idf) {
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const vec = {};
    for (const [t, count] of Object.entries(tf)) {
        vec[t] = (count / tokens.length) * (idf[t] || Math.log(2));
    }
    return vec;
}

// ── COSINE SIMILARITY ──────────────────────────────────────────
function cosineSimilarity(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    for (const [k, v] of Object.entries(vecA)) {
        dot   += v * (vecB[k] || 0);
        normA += v * v;
    }
    for (const v of Object.values(vecB)) normB += v * v;
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── LEVENSHTEIN (fallback exact-match boost) ───────────────────
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m+1 }, (_, i) =>
        Array.from({ length: n+1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

function editSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.9;
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

// ── COMBINED SCORE: TF-IDF cosine + edit-similarity boost ──────
function combinedScore(inputTokens, inputRaw, row, idf) {
    const rowTokens = [...tokenize(row.namaToko), ...tokenize(row.keyword)];
    if (rowTokens.length === 0) return 0;

    const vecInput = tfidfVector(inputTokens, idf);
    const vecRow   = tfidfVector(rowTokens, idf);
    const cosine   = cosineSimilarity(vecInput, vecRow);

    // Edit similarity sebagai booster untuk nama pendek (e.g. "kfc" vs "kfc")
    const editA = editSimilarity(inputRaw, row.namaToko);
    const editB = editSimilarity(inputRaw, row.keyword);
    const editBoost = Math.max(editA, editB);

    // Weighted combination: 60% TF-IDF + 40% edit distance
    return cosine * 0.60 + editBoost * 0.40;
}

// ── LOAD DATASET ────────────────────────────────────────────────
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

    idfMap      = buildIDF(knnDataset);
    lastKnnLoad = now;
    console.log(`📚 KNN: ${knnDataset.length} entri | IDF vocab: ${Object.keys(idfMap).length} tokens`);
}

// ── FEEDBACK LEARNING: simpan koreksi user ke Supabase ─────────
async function saveFeedback(waNumber, toko, kategori, sub) {
    try {
        await supabase.from('knn_dataset').insert({
            nama_toko:     toko,
            keyword_utama: toko.toLowerCase(),
            kategori,
            sub_kategori:  sub,
            sumber:        `feedback:${waNumber}`,
        });
        // Invalidasi cache agar langsung dipakai
        lastKnnLoad = 0;
        console.log(`🧠 Feedback learned: ${toko} → ${kategori}/${sub}`);
    } catch (e) {
        console.warn('⚠️ Feedback save failed:', e.message);
    }
}

// ── KNN ANALYSIS: top-K voting dengan TF-IDF ───────────────────
async function knnAnalysis(tokoInput) {
    await loadKnnDataset();
    if (knnDataset.length === 0) return null;

    const input       = tokoInput.toLowerCase().trim();
    const inputTokens = tokenize(input);

    // Hitung score semua row
    const scored = knnDataset.map(row => ({
        row,
        score: combinedScore(inputTokens, input, row, idfMap),
    }));

    // Ambil top-K
    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, KNN_K).filter(s => s.score >= 0.35);
    if (topK.length === 0) return null;

    // Majority voting berbobot score
    const votes = {};
    for (const { row, score } of topK) {
        const key = `${row.kategori}|||${row.sub}`;
        votes[key] = (votes[key] || 0) + score;
    }
    const bestKey   = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
    const [kategori, sub] = bestKey.split('|||');
    const bestScore = topK[0].score;

    // Confidence: gabungkan score tertinggi + konsistensi voting
    const totalVotes   = Object.values(votes).reduce((a, b) => a + b, 0);
    const winnerVotes  = votes[bestKey];
    const consensus    = winnerVotes / totalVotes; // 0-1: seberapa sepakat top-K
    const rawConf      = bestScore * 0.7 + consensus * 0.3;
    const confidence   = Math.min(99.9, Math.round(rawConf * 1000) / 10);

    if (confidence < 35) return null;

    return {
        kategori,
        sub,
        confidence,
        status:  confidence >= 80 ? '✅ Valid' : '🔶 Review',
        matched: topK[0].row.namaToko,
        method:  `KNN-${topK.length}`,
    };
}

// ── GROQ ANALYSIS: prompt kontekstual + contoh few-shot ────────
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
                model:       'llama3-8b-8192',
                max_tokens:  120,
                temperature: 0.05,
                messages: [
                    {
                        role: 'system',
                        content:
`Kamu AI kategorisasi transaksi keuangan Indonesia.
Jawab HANYA format JSON: {"kategori":"...","sub_kategori":"...","confidence":0-100}
Daftar kategori VALID: Makanan & Minuman, Transportasi, Kebutuhan Pokok, Kesehatan, Hiburan, Belanja Online, Fashion, Tagihan, Pendidikan, Rumah Tangga, Perjalanan, Investasi, Lain-lain.
Sub-kategori: isi spesifik misal "Fast Food", "Kafe", "BBM", "Ojek Online", "Minimarket", "Apotek", "Streaming", dll.
Contoh:
- "KFC" → {"kategori":"Makanan & Minuman","sub_kategori":"Fast Food","confidence":98}
- "Gojek perjalanan" → {"kategori":"Transportasi","sub_kategori":"Ojek Online","confidence":96}
- "Pertamina" → {"kategori":"Transportasi","sub_kategori":"BBM","confidence":97}
- "Transfer BCA" → {"kategori":"Tagihan","sub_kategori":"Perbankan","confidence":97}
- "PLN token" → {"kategori":"Tagihan","sub_kategori":"Listrik","confidence":98}
- "Shopee" → {"kategori":"Belanja Online","sub_kategori":"E-Commerce","confidence":95}`,
                    },
                    {
                        role: 'user',
                        content: `Nama toko: "${tokoInput}"${judul && judul !== tokoInput ? `, Judul: "${judul}"` : ''}`,
                    },
                ],
            }),
        });
        const data   = await res.json();
        const text   = data.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        const conf   = Math.min(95, Math.max(50, parsed.confidence || 72));
        return {
            kategori:   parsed.kategori     || 'Lain-lain',
            sub:        parsed.sub_kategori || 'Uncategorized',
            confidence: conf,
            status:     conf >= 80 ? '🤖 AI' : '🤖 AI (Review)',
            matched:    null,
            method:     'Groq LLM',
        };
    } catch (e) {
        console.warn('⚠️ Groq fallback error:', e.message);
        return null;
    }
}

// ── ENSEMBLE: KNN → Groq → Fallback ────────────────────────────
async function getAIAnalysis(tokoInput, judul = '') {
    const knnResult = await knnAnalysis(tokoInput);

    // Kalau KNN sangat yakin (≥80%), langsung pakai
    if (knnResult && knnResult.confidence >= 80) return knnResult;

    // KNN ragu-ragu → tanya Groq juga, ambil yang lebih yakin
    const groqResult = await groqAnalysis(tokoInput, judul);
    if (groqResult) {
        if (!knnResult) return groqResult;
        // Ensemble: ambil hasil dengan confidence lebih tinggi,
        // tapi kalau keduanya sepakat kategori → boost confidence
        if (knnResult.kategori === groqResult.kategori) {
            return {
                ...groqResult,
                confidence: Math.min(99.9, (knnResult.confidence + groqResult.confidence) / 2 + 5),
                status:     '✅ Ensemble',
                method:     'KNN+Groq',
            };
        }
        return groqResult.confidence >= knnResult.confidence ? groqResult : knnResult;
    }

    if (knnResult) return knnResult;
    return { kategori: 'Lain-lain', sub: 'Uncategorized', confidence: 30.0, status: '⚠️ Review', matched: null, method: 'Fallback' };
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

// ═══════════════════════════════════════════════════════════════
// PRE-DETECTION: Deteksi jenis struk sebelum masuk KNN/AI
// Berdasarkan pola nyata struk bank & transaksi Indonesia
// ═══════════════════════════════════════════════════════════════
function preDetectReceiptType(rawText) {
    if (!rawText) return null;
    const t = rawText.toLowerCase();

    // ─── 1. TRANSFER BANK (prioritas tertinggi) ───────────────────
    // Pola BCA Mobile / myBCA
    const isBCATransfer = (
        (t.includes('biz id') || t.includes('bizid')) ||
        (t.includes('bi-fast') || t.includes('bifast')) ||
        (t.includes('m-transfer') && t.includes('berhasil')) ||
        (t.includes('transfer berhasil') && (t.includes('bca') || t.includes('rekening tujuan'))) ||
        (t.includes('sumber dana') && t.includes('penerima')) ||
        (t.includes('klikbca') && t.includes('transfer')) ||
        (t.includes('detail transfer') && t.includes('nominal')) ||
        (t.includes('metode transfer') && (t.includes('bi-fast') || t.includes('rtgs') || t.includes('online')))
    );

    // Pola BRI Mobile / BRImo
    const isBRITransfer = (
        (t.includes('brimo') && t.includes('transfer')) ||
        (t.includes('bri') && t.includes('transfer berhasil')) ||
        (t.includes('no. referensi') && t.includes('bri')) ||
        (t.includes('rekening tujuan') && t.includes('bri'))
    );

    // Pola Mandiri / Livin
    const isMandiriTransfer = (
        (t.includes('livin') && t.includes('transfer')) ||
        (t.includes('mandiri') && t.includes('transfer berhasil')) ||
        (t.includes('mandiri') && t.includes('rekening tujuan')) ||
        (t.includes('no. transaksi') && t.includes('mandiri'))
    );

    // Pola BNI Mobile
    const isBNITransfer = (
        (t.includes('bni') && t.includes('transfer berhasil')) ||
        (t.includes('bni-') && /bni-\d+/.test(t)) ||
        (t.includes('bni') && t.includes('rekening tujuan'))
    );

    // Pola BSI / Bank Syariah
    const isBSITransfer = (
        (t.includes('bsi') && t.includes('transfer')) ||
        (t.includes('bank syariah') && t.includes('transfer'))
    );

    // Pola umum transfer bank (semua bank)
    const isGenericTransfer = (
        (t.includes('transfer berhasil') || t.includes('pengiriman berhasil')) ||
        (t.includes('rekening tujuan') && (t.includes('nominal') || t.includes('jumlah'))) ||
        (t.includes('penerima') && t.includes('sumber dana')) ||
        (t.includes('no. rekening') && t.includes('transfer')) ||
        (t.includes('tujuan transaksi') && t.includes('nominal')) ||
        (t.includes('biaya transaksi') && t.includes('nominal') && t.includes('penerima'))
    );

    if (isBCATransfer || isBRITransfer || isMandiriTransfer || isBNITransfer || isBSITransfer || isGenericTransfer) {
        // Coba deteksi bank pengirim
        let bankName = 'Bank';
        if (t.includes('bca')) bankName = 'BCA';
        else if (t.includes('bri') || t.includes('brimo')) bankName = 'BRI';
        else if (t.includes('mandiri') || t.includes('livin')) bankName = 'Mandiri';
        else if (t.includes('bni')) bankName = 'BNI';
        else if (t.includes('bsi') || t.includes('bank syariah')) bankName = 'BSI';
        else if (t.includes('cimb') || t.includes('ocbc')) bankName = 'CIMB';
        else if (t.includes('danamon')) bankName = 'Danamon';
        else if (t.includes('permata')) bankName = 'Permata';
        else if (t.includes('btn')) bankName = 'BTN';
        else if (t.includes('jago')) bankName = 'Bank Jago';
        else if (t.includes('neo')) bankName = 'Bank Neo';
        else if (t.includes('seabank')) bankName = 'SeaBank';

        // Coba deteksi nama penerima
        let penerima = '';
        const penerimaMatch = rawText.match(/penerima[^\n:]*[:]\s*([A-Z][A-Z\s]{2,30})/i);
        if (penerimaMatch) penerima = ` ke ${penerimaMatch[1].trim()}`;

        return {
            toko: `Transfer ${bankName}${penerima}`,
            kategori: 'Tagihan',
            sub: 'Perbankan',
            confidence: 97.0,
            status: '✅ Valid',
            isPreDetected: true,
        };
    }

    // ─── 2. TOP UP / ISI SALDO E-WALLET ───────────────────────────
    const isTopUp = (
        (t.includes('top up') || t.includes('topup') || t.includes('isi saldo') || t.includes('tambah saldo')) &&
        (t.includes('ovo') || t.includes('gopay') || t.includes('dana') || t.includes('shopeepay') ||
         t.includes('linkaja') || t.includes('flazz') || t.includes('tapcash') || t.includes('e-money'))
    );
    if (isTopUp) {
        let wallet = 'E-Wallet';
        if (t.includes('ovo')) wallet = 'OVO';
        else if (t.includes('gopay')) wallet = 'GoPay';
        else if (t.includes('dana')) wallet = 'DANA';
        else if (t.includes('shopeepay')) wallet = 'ShopeePay';
        else if (t.includes('linkaja')) wallet = 'LinkAja';
        else if (t.includes('flazz')) wallet = 'Flazz BCA';
        else if (t.includes('tapcash')) wallet = 'TapCash BNI';
        return { toko: `Top Up ${wallet}`, kategori: 'Tagihan', sub: 'Dompet Digital', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    }

    // ─── 3. BAYAR TAGIHAN / VIRTUAL ACCOUNT ───────────────────────
    const isBillPayment = (
        (t.includes('virtual account') || t.includes('va ')) &&
        (t.includes('berhasil') || t.includes('sukses') || t.includes('pembayaran'))
    );
    const isPLN = t.includes('pln') && (t.includes('token') || t.includes('listrik') || t.includes('kwh'));
    const isPDAM = t.includes('pdam') && (t.includes('air') || t.includes('tagihan'));
    const isBPJS = (t.includes('bpjs') && (t.includes('kesehatan') || t.includes('ketenagakerjaan')));
    const isTelkom = (t.includes('indihome') || t.includes('telkom')) && t.includes('tagihan');

    if (isPLN) return { toko: 'PLN Token Listrik', kategori: 'Tagihan', sub: 'Listrik', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isPDAM) return { toko: 'PDAM Air', kategori: 'Tagihan', sub: 'Air', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isBPJS) {
        const sub = t.includes('ketenagakerjaan') ? 'Asuransi' : 'Asuransi';
        return { toko: 'BPJS', kategori: 'Tagihan', sub, confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    if (isTelkom) return { toko: 'Indihome / Telkom', kategori: 'Tagihan', sub: 'Internet', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    if (isBillPayment) return { toko: 'Bayar Tagihan Virtual Account', kategori: 'Tagihan', sub: 'Perbankan', confidence: 90.0, status: '✅ Valid', isPreDetected: true };

    // ─── 4. STRUK BELANJA MINIMARKET / SUPERMARKET ────────────────
    const isMinimarket = (
        t.includes('indomaret') || t.includes('alfamart') || t.includes('alfamidi') ||
        t.includes('circle k') || t.includes('lawson') || t.includes('familymart') ||
        t.includes('superindo') || t.includes('hypermart') || t.includes('lottemart') ||
        t.includes('carrefour') || t.includes('transmart') || t.includes('giant')
    );
    if (isMinimarket) {
        let nama = 'Minimarket';
        if (t.includes('indomaret')) nama = 'Indomaret';
        else if (t.includes('alfamart')) nama = 'Alfamart';
        else if (t.includes('alfamidi')) nama = 'Alfamidi';
        else if (t.includes('circle k')) nama = 'Circle K';
        else if (t.includes('superindo')) nama = 'Superindo';
        else if (t.includes('hypermart')) nama = 'Hypermart';
        else if (t.includes('transmart')) nama = 'Transmart';
        return { toko: nama, kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    }

    // ─── 5. STRUK RESTORAN FAST FOOD ──────────────────────────────
    const isFastFood = (
        t.includes('mcdonald') || t.includes('kfc') || t.includes('burger king') ||
        t.includes('pizza hut') || t.includes("domino's") || t.includes('subway') ||
        t.includes('a&w') || t.includes('texas chicken') || t.includes('popeyes') ||
        t.includes('wingstop') || t.includes('hokben') || t.includes('hoka hoka') ||
        t.includes('yoshinoya') || t.includes('richeese') || t.includes('jollibee') ||
        t.includes('carl\'s jr') || t.includes('five guys') || t.includes('shake shack')
    );
    if (isFastFood) return { toko: null, kategori: 'Makanan & Minuman', sub: 'Fast Food', confidence: 95.0, status: '✅ Valid', isPreDetected: true };

    // ─── 6. STRUK KAFE ────────────────────────────────────────────
    const isKafe = (
        t.includes('starbucks') || t.includes('kopi kenangan') || t.includes('janji jiwa') ||
        t.includes('fore coffee') || t.includes('j.co') || t.includes('excelso') ||
        t.includes('anomali') || t.includes('tomoro') || t.includes('djournal') ||
        t.includes('chatime') || t.includes('gong cha') || t.includes('mixue') ||
        t.includes('xing fu tang') || t.includes('the alley') || t.includes('tealive') ||
        t.includes('sharetea') || t.includes('es teh indonesia') ||
        (t.includes('kopi') && (t.includes('receipt') || t.includes('total') || t.includes('kasir')))
    );
    if (isKafe) return { toko: null, kategori: 'Makanan & Minuman', sub: 'Kafe', confidence: 93.0, status: '✅ Valid', isPreDetected: true };

    // ─── 7. STRUK BBM / SPBU ──────────────────────────────────────
    const isBBM = (
        (t.includes('pertamina') || t.includes('spbu') || t.includes('shell') || t.includes('vivo energy') || t.includes('bp')) &&
        (t.includes('liter') || t.includes('bbm') || t.includes('bensin') || t.includes('pertamax') || t.includes('pertalite') || t.includes('solar') || t.includes('dexlite'))
    );
    if (isBBM) {
        let nama = 'SPBU';
        if (t.includes('pertamina')) nama = 'Pertamina';
        else if (t.includes('shell')) nama = 'Shell';
        else if (t.includes('vivo')) nama = 'Vivo';
        return { toko: nama, kategori: 'Transportasi', sub: 'BBM', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }

    // ─── 8. STRUK PARKIR / TOL ────────────────────────────────────
    const isTol = (t.includes('jasa marga') || t.includes('tol ') || (t.includes('e-toll') || t.includes('etoll')));
    const isParkir = (t.includes('parkir') && (t.includes('masuk') || t.includes('keluar') || t.includes('tiket') || t.includes('tarif')));
    if (isTol) return { toko: 'Jalan Tol', kategori: 'Transportasi', sub: 'Tol', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (isParkir) return { toko: 'Parkir', kategori: 'Transportasi', sub: 'Parkir', confidence: 95.0, status: '✅ Valid', isPreDetected: true };

    // ─── 9. STRUK OJEK ONLINE / RIDE ──────────────────────────────
    const isOjol = (
        (t.includes('gojek') || t.includes('grab') || t.includes('maxim') || t.includes('indrive')) &&
        (t.includes('goride') || t.includes('gocar') || t.includes('grabcar') || t.includes('grabike') ||
         t.includes('perjalanan') || t.includes('fare') || t.includes('biaya perjalanan'))
    );
    if (isOjol) {
        let nama = 'Ojek Online';
        if (t.includes('gojek')) nama = 'Gojek';
        else if (t.includes('grab')) nama = 'Grab';
        else if (t.includes('maxim')) nama = 'Maxim';
        return { toko: nama, kategori: 'Transportasi', sub: 'Ojek Online', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    }

    // ─── 10. STRUK APOTEK / OBAT ──────────────────────────────────
    const isApotek = (
        t.includes('apotek') || t.includes('kimia farma') || t.includes('k-24') ||
        t.includes('guardian') || t.includes('century') || t.includes('watsons') ||
        (t.includes('obat') && (t.includes('resep') || t.includes('apoteker')))
    );
    if (isApotek) return { toko: null, kategori: 'Kesehatan', sub: 'Apotek', confidence: 95.0, status: '✅ Valid', isPreDetected: true };

    // ─── 11. STRUK RUMAH SAKIT / KLINIK ───────────────────────────
    const isRS = (
        t.includes('rumah sakit') || t.includes(' rs ') || t.includes('rsia') ||
        t.includes('klinik') || t.includes('puskesmas') ||
        (t.includes('dokter') && (t.includes('konsultasi') || t.includes('biaya periksa')))
    );
    if (isRS) return { toko: null, kategori: 'Kesehatan', sub: 'Rumah Sakit', confidence: 93.0, status: '✅ Valid', isPreDetected: true };

    // ─── 12. STRUK E-COMMERCE / BELANJA ONLINE ────────────────────
    const isEcommerce = (
        (t.includes('tokopedia') || t.includes('shopee') || t.includes('lazada') ||
         t.includes('bukalapak') || t.includes('blibli') || t.includes('tiktok shop')) &&
        (t.includes('pesanan') || t.includes('order') || t.includes('invoice') || t.includes('pembayaran'))
    );
    if (isEcommerce) return { toko: null, kategori: 'Belanja Online', sub: 'E-Commerce', confidence: 94.0, status: '✅ Valid', isPreDetected: true };

    // ─── 13. STRUK PULSA / PAKET DATA ─────────────────────────────
    const isPulsa = (
        (t.includes('telkomsel') || t.includes('xl axiata') || t.includes('indosat') ||
         t.includes('tri') || t.includes('smartfren') || t.includes('by.u') || t.includes('axis')) &&
        (t.includes('pulsa') || t.includes('paket data') || t.includes('mb') || t.includes('gb') ||
         t.includes('masa aktif') || t.includes('kuota'))
    );
    if (isPulsa) return { toko: null, kategori: 'Tagihan', sub: 'Pulsa & Data', confidence: 95.0, status: '✅ Valid', isPreDetected: true };

    // ─── 14. STRUK LAUNDRY ────────────────────────────────────────
    const isLaundry = (
        t.includes('laundry') || t.includes('cuci') &&
        (t.includes('kg') || t.includes('kilogram') || t.includes('kilo'))
    );
    if (isLaundry) return { toko: 'Laundry', kategori: 'Rumah Tangga', sub: 'Jasa Rumah', confidence: 93.0, status: '✅ Valid', isPreDetected: true };

    // ─── 15. STRUK BIOSKOP / TIKET HIBURAN ───────────────────────
    const isBioskop = (
        t.includes('cgv') || t.includes('cinema xxi') || t.includes('cinepolis') ||
        (t.includes('tiket') && (t.includes('studio') || t.includes('kursi') || t.includes('seat') || t.includes('film')))
    );
    if (isBioskop) return { toko: null, kategori: 'Hiburan', sub: 'Bioskop', confidence: 95.0, status: '✅ Valid', isPreDetected: true };

    // ─── 16. STRUK HOTEL / PENGINAPAN ─────────────────────────────
    const isHotel = (
        (t.includes('hotel') || t.includes('inn') || t.includes('resort') || t.includes('villa')) &&
        (t.includes('check in') || t.includes('check out') || t.includes('kamar') ||
         t.includes('room') || t.includes('menginap') || t.includes('nights'))
    );
    if (isHotel) return { toko: null, kategori: 'Perjalanan', sub: 'Akomodasi', confidence: 93.0, status: '✅ Valid', isPreDetected: true };

    // ─── 17. STRUK TIKET PESAWAT / KAI ───────────────────────────
    const isTiket = (
        (t.includes('garuda') || t.includes('lion air') || t.includes('citilink') ||
         t.includes('airasia') || t.includes('batik air') || t.includes('sriwijaya')) ||
        (t.includes('kai') || t.includes('kereta api')) &&
        (t.includes('pnr') || t.includes('tiket') || t.includes('penumpang') || t.includes('boarding'))
    );
    if (isTiket) return { toko: null, kategori: 'Perjalanan', sub: 'Pesawat', confidence: 94.0, status: '✅ Valid', isPreDetected: true };

    // ─── 18. STRUK BENGKEL / SERVIS KENDARAAN ─────────────────────
    const isBengkel = (
        t.includes('bengkel') ||
        (t.includes('servis') || t.includes('service')) &&
        (t.includes('motor') || t.includes('mobil') || t.includes('kendaraan') ||
         t.includes('oli') || t.includes('sparepart') || t.includes('ban'))
    );
    if (isBengkel) return { toko: null, kategori: 'Transportasi', sub: 'Perawatan Kendaraan', confidence: 92.0, status: '✅ Valid', isPreDetected: true };

    // Tidak terdeteksi → lanjut ke KNN / AI
    return null;
}

function parseReceiptText(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    let nominal = 0;

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

    if (nominal === 0) {
        const nums = [...rawText.matchAll(/\b(\d{4,})\b/g)]
            .map(m => parseInt(m[1])).filter(n => n >= 1000 && n <= 100_000_000);
        if (nums.length) nominal = Math.max(...nums);
    }

    const tokoLines = lines.slice(0, 8).filter(l =>
        l.length > 2 && l.length < 50 &&
        !/^\d+$/.test(l) &&
        !/^https?/i.test(l) &&
        !/[.]{3,}/.test(l) &&
        !/^\*+$/.test(l) &&
        !/^[-=]+$/.test(l)
    );
    const toko = tokoLines.slice(0, 2).join(' ').substring(0, 60).trim() || 'Unknown';

    const tglMatch = rawText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    const tanggal = tglMatch ? tglMatch[0] : null;

    return { toko, nominal, tanggal };
}

// ═══════════════════════════════════════════════════════════════
// DETEKSI APAKAH FOTO ADALAH STRUK
// ═══════════════════════════════════════════════════════════════
function isLikelyReceipt(rawText) {
    if (!rawText || rawText.trim().length < 20) return false;

    const receiptKeywords = [
        /total/i, /bayar/i, /tagihan/i, /rp\.?\s*[\d.,]+/i,
        /struk/i, /nota/i, /receipt/i, /invoice/i,
        /qty/i, /pcs/i, /item/i, /harga/i, /subtotal/i,
        /kasir/i, /cashier/i, /terima kasih/i, /thank you/i,
        /no\.?\s*trx/i, /no\.?\s*faktur/i, /kode/i,
        /diskon/i, /discount/i, /ppn/i, /tax/i,
        /[\d.,]{4,}/,  // ada angka panjang (nominal)
    ];

    const matches = receiptKeywords.filter(pat => pat.test(rawText));
    return matches.length >= 3;
}

const MSG_BUKAN_STRUK =
    `❌ *Foto bukan struk transaksi.*\n\n` +
    `📋 *Tips foto struk yang baik:*\n` +
    `• Pastikan foto adalah *struk/nota belanja*\n` +
    `• Posisikan kamera *tepat di atas struk*, jangan miring\n` +
    `• Pastikan area *TOTAL* terbaca jelas\n` +
    `• Gunakan *cahaya cukup*, hindari bayangan\n` +
    `• Jangan terlalu jauh — *penuhi frame* dengan struk\n` +
    `• Hindari foto yang *buram atau goyang*\n\n` +
    `💡 Atau ketik manual: \`Nama Toko Nominal\`\n` +
    `_Contoh: Indomaret 45000_\n\n` +
    `Ketik *menu* untuk kembali.`;

// ═══════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
const userState = new Map();
const STATE_TIMEOUT_MS = 10 * 60 * 1000;

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
        `7️⃣  Export Data (CSV)\n` +
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
        `5️⃣ Koreksi Kategori _(bantu AI belajar)_\n` +
        `_Balas angka 1-5_`,

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
        `ℹ️ *Bantuan Finance Tracker v6.1*\n━━━━━━━━━━━━━━━━━\n\n` +
        `*📌 Perintah Cepat:*\n` +
        `• \`menu\` — Menu utama\n` +
        `• \`laporan\` — Laporan bulan ini\n` +
        `• \`saldo\` — Saldo & ringkasan\n` +
        `• \`riwayat\` — 10 transaksi terakhir\n` +
        `• \`budget\` — Atur budget bulanan\n` +
        `• \`export\` — Download data CSV\n` +
        `• \`batal\` — Batalkan proses\n\n` +
        `*📝 Input Cepat:*\n` +
        `\`Indomaret 50000\`\n\n` +
        `*📸 Scan Struk:*\n` +
        `Kirim foto struk kapan saja\n` +
        `_Pastikan tulisan TOTAL terlihat jelas_\n\n` +
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

        // Cek apakah teks cukup terdeteksi
        if (!ocrText || ocrText.trim().length < 10) {
            resetState(from);
            await msg.reply(
                `❌ *Teks tidak terbaca.*\n\n` +
                `📋 *Tips foto struk yang baik:*\n` +
                `• Foto *lebih dekat* ke struk\n` +
                `• Pastikan *cahaya cukup terang*\n` +
                `• Jangan sampai *buram atau miring*\n` +
                `• Area *TOTAL* harus terlihat jelas\n\n` +
                `💡 Atau ketik manual: \`Nama Toko Nominal\`\n` +
                `Ketik *menu* untuk kembali.`
            );
            return true;
        }

        // Cek apakah gambar kemungkinan struk
        if (!isLikelyReceipt(ocrText)) {
            resetState(from);
            await msg.reply(MSG_BUKAN_STRUK);
            return true;
        }

        const { toko: tokoRaw, nominal, tanggal } = parseReceiptText(ocrText);

        if (nominal === 0) {
            resetState(from);
            await msg.reply(
                `⚠️ *Nominal tidak terdeteksi.*\n` +
                `🏪 Toko terdeteksi: _${tokoRaw}_\n\n` +
                `📋 *Coba:*\n` +
                `• Pastikan area *TOTAL* terlihat jelas & tidak terpotong\n` +
                `• Foto lebih dekat ke bagian bawah struk\n\n` +
                `💡 Atau ketik manual: \`${tokoRaw} [nominal]\``
            );
            return true;
        }

        // Pre-detect jenis struk (transfer, tagihan, BBM, dll) SEBELUM KNN/AI
        const preDetected = preDetectReceiptType(ocrText);
        const toko = (preDetected?.toko) || tokoRaw;
        const ai = preDetected
            ? { kategori: preDetected.kategori, sub: preDetected.sub, confidence: preDetected.confidence, status: preDetected.status, matched: toko }
            : await getAIAnalysis(tokoRaw, tokoRaw);
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
    console.log('✅ Finance Tracker Bot v6.1 Online!');
    await loadKnnDataset().catch(e => console.error('❌ KNN:', e.message));
    if (!GROQ_API_KEY) console.warn('⚠️  GROQ_API_KEY kosong — fallback AI nonaktif.');
});

// ═══════════════════════════════════════════════════════════════
// MAIN MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════
client.on('message', async msg => {
    if (msg.isStatus) return;
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

    await getOrCreateProfile(from, namaKontak).catch(() => {});

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
        await msg.reply('⏳ Menyiapkan file Excel...');
        try {
            const tmpPath = path.join(os.tmpdir(), `transaksi_${Date.now()}.xlsx`);
            const ok = await generateExportXLSX(from, tmpPath);
            if (!ok) return msg.reply('📭 Belum ada data transaksi untuk di-export.');

            const { MessageMedia } = require('whatsapp-web.js');
            const media = MessageMedia.fromFilePath(tmpPath);
            media.filename = `transaksi_${getBulanKey()}.xlsx`;
            media.mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

            await msg.reply(media, undefined, {
                caption: `📊 *Export Data Transaksi*\n━━━━━━━━━━━━━━━━━\n✅ File Excel siap dibuka!\n\n• Baris kuning = pengeluaran\n• Baris hijau = pemasukan\n• Kolom nominal sudah terformat Rp\n• Ada filter & freeze header otomatis`
            });
            fs.unlinkSync(tmpPath);
        } catch (e) {
            console.error('Export error:', e.message);
            await msg.reply('❌ Gagal export. Coba lagi nanti.');
        }
        return;
    }
    if (['kategori','category'].includes(lower)) {
        const cats = await getUserCategories(from);
        setState(from, 'await_category', {});
        return msg.reply(MSG.categoryMenu(cats));
    }

    // ── IDLE ─────────────────────────────────────────────────
    if (cur.step === 'idle') {
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
            await msg.reply('⏳ Menyiapkan file Excel...');
            try {
                const tmpPath = path.join(os.tmpdir(), `transaksi_${Date.now()}.xlsx`);
                const ok = await generateExportXLSX(from, tmpPath);
                if (!ok) return msg.reply('📭 Belum ada data transaksi untuk di-export.');

                const { MessageMedia } = require('whatsapp-web.js');
                const media = MessageMedia.fromFilePath(tmpPath);
                media.filename = `transaksi_${getBulanKey()}.xlsx`;
                media.mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

                await msg.reply(media, undefined, {
                    caption: `📊 *Export Data Transaksi*\n━━━━━━━━━━━━━━━━━\n✅ File Excel siap dibuka!\n\n• Baris kuning = pengeluaran\n• Baris hijau = pemasukan\n• Kolom nominal sudah terformat Rp\n• Ada filter & freeze header otomatis`
                });
                fs.unlinkSync(tmpPath);
                resetState(from);
            } catch (e) {
                await msg.reply('❌ Gagal export. Coba lagi nanti.');
            }
            return;
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
        const ai = await getAIAnalysis(d.toko, judul);
        const finalData = { ...d, judul, ai };
        setState(from, 'confirm', finalData);
        return msg.reply(MSG.confirm(finalData));
    }

    // ── CONFIRM ──────────────────────────────────────────────
    if (cur.step === 'confirm') {
        const d = cur.data;

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

        if (['2'].includes(lower)) {
            setState(from, 'await_judul_edit', d);
            return msg.reply(`✏️ *Ubah Judul*\n\nJudul sekarang: *${d.judul}*\n\nKetik judul baru:`);
        }

        if (['3'].includes(lower)) {
            setState(from, 'await_nominal_edit', d);
            return msg.reply(`✏️ *Ubah Nominal*\n\nNominal sekarang: *Rp ${parseInt(d.nominal).toLocaleString('id-ID')}*\n\nKetik nominal baru:\n_Contoh: \`75000\`_`);
        }

        // ── Koreksi Kategori (Feedback Learning) ─────────────
        if (['5'].includes(lower)) {
            setState(from, 'await_kategori_koreksi', d);
            return msg.reply(
                `🧠 *Koreksi Kategori*\n━━━━━━━━━━━━━━━━━\n` +
                `Kategori saat ini: *${d.ai.kategori} › ${d.ai.sub}*\n\n` +
                `Pilih kategori yang benar:\n` +
                `1. Makanan & Minuman\n2. Transportasi\n3. Kebutuhan Pokok\n` +
                `4. Kesehatan\n5. Hiburan\n6. Belanja Online\n7. Fashion\n` +
                `8. Tagihan\n9. Pendidikan\n10. Rumah Tangga\n11. Perjalanan\n12. Investasi\n13. Lain-lain\n\n` +
                `_Balas angka 1-13 atau ketik nama kategori langsung_`
            );
        }

        if (['4','batal','cancel','tidak','no'].includes(lower)) {
            resetState(from); return msg.reply(MSG.cancelled());
        }

        return msg.reply(`❓ Balas angka:\n1️⃣ Simpan\n2️⃣ Ubah Judul\n3️⃣ Ubah Nominal\n4️⃣ Batal\n5️⃣ Koreksi Kategori _(bantu AI belajar)_`);
    }

    // ── AWAIT KATEGORI KOREKSI ────────────────────────────────
    if (cur.step === 'await_kategori_koreksi') {
        const d = cur.data;
        const kategoriMap = {
            '1':'Makanan & Minuman','2':'Transportasi','3':'Kebutuhan Pokok',
            '4':'Kesehatan','5':'Hiburan','6':'Belanja Online','7':'Fashion',
            '8':'Tagihan','9':'Pendidikan','10':'Rumah Tangga','11':'Perjalanan',
            '12':'Investasi','13':'Lain-lain',
        };
        const kategori = kategoriMap[lower] || text;
        if (!kategori || kategori.length < 3)
            return msg.reply(`❌ Kategori tidak valid. Balas angka 1-13.\nKetik *batal* untuk kembali.`);

        setState(from, 'await_sub_koreksi', { ...d, newKategori: kategori });
        return msg.reply(
            `✏️ *Kategori dipilih: ${kategori}*\n\n` +
            `Sekarang ketik sub-kategori:\n` +
            `_Contoh: Fast Food, Kafe, BBM, Ojek Online, Minimarket, Streaming, dll_\n\n` +
            `_Atau ketik *skip* untuk biarkan otomatis_`
        );
    }

    // ── AWAIT SUB KOREKSI ─────────────────────────────────────
    if (cur.step === 'await_sub_koreksi') {
        const d = cur.data;
        const sub = lower === 'skip' ? d.newKategori : text;
        const correctedAI = { ...d.ai, kategori: d.newKategori, sub, confidence: 99.0, status: '✅ Dikoreksi', method: 'User Feedback' };
        const finalData   = { ...d, ai: correctedAI };

        // Simpan feedback ke dataset agar AI belajar
        saveFeedback(from, d.toko, d.newKategori, sub).catch(() => {});

        setState(from, 'confirm', finalData);
        return msg.reply(
            `✅ *Kategori diperbarui!*\n🧠 AI akan belajar dari koreksi ini.\n\n` +
            MSG.confirm(finalData)
        );
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