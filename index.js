const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
const Tesseract = require('tesseract.js');
const scheduler = require('./scheduler');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

require('dotenv').config();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getOrCreateProfile(waNumber, nama) {
    const { data } = await supabase.from('user_profiles').select('*').eq('wa_number', waNumber).maybeSingle();
    if (data) {
        await supabase.from('user_profiles').update({ last_active: new Date().toISOString(), nama }).eq('wa_number', waNumber);
        return data;
    }
    const { data: newData, error } = await supabase.from('user_profiles').insert({ wa_number: waNumber, nama }).select().single();
    if (error) console.error('Error creating profile:', error.message);
    return newData || { wa_number: waNumber, nama, is_new: true };
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
// READ DETAIL — ambil daftar transaksi + ID, dan detail 1 transaksi
// ═══════════════════════════════════════════════════════════════
async function getRecentWithId(waNumber, limit = 8) {
    const { data } = await supabase.from('transaksi')
        .select('id, judul, nama_toko, nominal, kategori, tipe, tanggal')
        .eq('wa_number', waNumber)
        .order('created_at', { ascending: false })
        .limit(limit);
    return data || [];
}

async function getTransactionDetail(waNumber, trxId) {
    const { data, error } = await supabase.from('transaksi')
        .select('id, judul, nama_toko, nominal, kategori, sub_kategori, tipe, tanggal, catatan, sumber_dokumen, confidence_ai, status_validasi, created_at')
        .eq('wa_number', waNumber)
        .eq('id', trxId)
        .single();
    if (error || !data) return null;
    return data;
}

// ═══════════════════════════════════════════════════════════════
// UPDATE & DELETE TRANSAKSI
// ═══════════════════════════════════════════════════════════════
async function updateTransaction(waNumber, trxId, field, value) {
    const ALLOWED_FIELDS = ['judul', 'nominal', 'kategori', 'catatan'];
    if (!ALLOWED_FIELDS.includes(field)) throw new Error('Field tidak valid');
    const { error } = await supabase.from('transaksi')
        .update({ [field]: value })
        .eq('id', trxId)
        .eq('wa_number', waNumber); // keamanan: hanya bisa edit milik sendiri
    if (error) throw new Error(error.message);
}

async function deleteTransaction(waNumber, trxId) {
    const { error } = await supabase.from('transaksi')
        .delete()
        .eq('id', trxId)
        .eq('wa_number', waNumber); // keamanan: hanya bisa hapus milik sendiri
    if (error) throw new Error(error.message);
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
let idfMap       = {};
let feedbackCache = {};
const KNN_CACHE_MS = 5 * 60 * 1000;
const KNN_K        = 5;

const STOP_WORDS = new Set([
    'di','dan','ke','yang','ini','itu','dengan','untuk','dari','dalam',
    'atau','juga','akan','ada','tidak','bisa','kita','kami','saya','anda',
    'the','a','an','of','in','at','by','to','for','on','is','are','was',
    'toko','warung','kedai','gerai','cabang','outlet','pusat','pt','cv','tb',
]);

function tokenize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function buildIDF(dataset) {
    const N = dataset.length;
    const df = {};
    for (const row of dataset) {
        const tokens = new Set([...tokenize(row.namaToko), ...tokenize(row.keyword)]);
        for (const t of tokens) df[t] = (df[t] || 0) + 1;
    }
    const idf = {};
    for (const [t, freq] of Object.entries(df)) {
        idf[t] = Math.log((N + 1) / (freq + 1)) + 1;
    }
    return idf;
}

function tfidfVector(tokens, idf) {
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const vec = {};
    for (const [t, count] of Object.entries(tf)) {
        vec[t] = (count / tokens.length) * (idf[t] || Math.log(2));
    }
    return vec;
}

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

function combinedScore(inputTokens, inputRaw, row, idf) {
    const rowTokens = [...tokenize(row.namaToko), ...tokenize(row.keyword)];
    if (rowTokens.length === 0) return 0;

    const vecInput = tfidfVector(inputTokens, idf);
    const vecRow   = tfidfVector(rowTokens, idf);
    const cosine   = cosineSimilarity(vecInput, vecRow);

    const editA = editSimilarity(inputRaw, row.namaToko);
    const editB = editSimilarity(inputRaw, row.keyword);
    const editBoost = Math.max(editA, editB);

    return cosine * 0.60 + editBoost * 0.40;
}

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

async function saveFeedback(waNumber, toko, kategori, sub) {
    try {
        await supabase.from('knn_dataset').insert({
            nama_toko:     toko,
            keyword_utama: toko.toLowerCase(),
            kategori,
            sub_kategori:  sub,
            sumber:        `feedback:${waNumber}`,
        });
        lastKnnLoad = 0;
        console.log(`🧠 Feedback learned: ${toko} → ${kategori}/${sub}`);
    } catch (e) {
        console.warn('⚠️ Feedback save failed:', e.message);
    }
}

async function knnAnalysis(tokoInput) {
    await loadKnnDataset();
    if (knnDataset.length === 0) return null;

    const input       = tokoInput.toLowerCase().trim();
    const inputTokens = tokenize(input);

    const scored = knnDataset.map(row => ({
        row,
        score: combinedScore(inputTokens, input, row, idfMap),
    }));

    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, KNN_K).filter(s => s.score >= 0.35);
    if (topK.length === 0) return null;

    const votes = {};
    for (const { row, score } of topK) {
        const key = `${row.kategori}|||${row.sub}`;
        votes[key] = (votes[key] || 0) + score;
    }
    const bestKey   = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
    const [kategori, sub] = bestKey.split('|||');
    const bestScore = topK[0].score;

    const totalVotes   = Object.values(votes).reduce((a, b) => a + b, 0);
    const winnerVotes  = votes[bestKey];
    const consensus    = winnerVotes / totalVotes;
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

async function getAIAnalysis(tokoInput, judul = '') {
    const knnResult = await knnAnalysis(tokoInput);

    if (knnResult && knnResult.confidence >= 80) return knnResult;

    const groqResult = await groqAnalysis(tokoInput, judul);
    if (groqResult) {
        if (!knnResult) return groqResult;
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
// EKSTRAK DETAIL TRANSFER BANK dari teks OCR
// ═══════════════════════════════════════════════════════════════
function extractTransferDetail(rawText) {
    const detail = {
        namaPenerima: '',
        bankTujuan:   '',
        noRekening:   '',
        bankPengirim: '',
    };

    // Deteksi bank pengirim
    const t = rawText.toLowerCase();
    if (t.includes('bca'))                        detail.bankPengirim = 'BCA';
    else if (t.includes('brimo') || t.includes('bri')) detail.bankPengirim = 'BRI';
    else if (t.includes('mandiri') || t.includes('livin')) detail.bankPengirim = 'Mandiri';
    else if (t.includes('bni'))                   detail.bankPengirim = 'BNI';
    else if (t.includes('bsi') || t.includes('bank syariah')) detail.bankPengirim = 'BSI';
    else if (t.includes('cimb') || t.includes('ocbc')) detail.bankPengirim = 'CIMB';
    else if (t.includes('danamon'))               detail.bankPengirim = 'Danamon';
    else if (t.includes('permata'))               detail.bankPengirim = 'Permata';
    else if (t.includes('btn'))                   detail.bankPengirim = 'BTN';
    else if (t.includes('jago'))                  detail.bankPengirim = 'Bank Jago';
    else if (t.includes('seabank'))               detail.bankPengirim = 'SeaBank';
    else                                           detail.bankPengirim = 'Bank';

    // Coba ekstrak nama penerima — berbagai pola struk bank Indonesia
    const penerimaPatterns = [
        // "Penerima : NAMA ORANG"
        /penerima\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$|(?=\s{2,}))/im,
        // "Nama Penerima : NAMA"
        /nama\s+penerima\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$)/im,
        // "Ke : NAMA" atau "Kepada : NAMA"
        /(?:ke|kepada)\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$)/im,
        // "Beneficiary : NAMA"
        /beneficiary\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$)/im,
        // "Nama : NAMA" (baris setelah "Rekening Tujuan")
        /rekening\s+tujuan[\s\S]{0,60}?nama\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$)/im,
        // Pola BCA myBCA — nama muncul setelah nomor rekening
        /\d{10,16}\s*\n\s*([A-Z][A-Z\s]{3,35})\s*\n/m,
    ];

    for (const pat of penerimaPatterns) {
        const m = rawText.match(pat);
        if (m && m[1]) {
            const nama = m[1].trim().replace(/\s+/g, ' ');
            // Filter false positive (jangan ambil label field)
            const blacklist = ['BANK', 'TRANSFER', 'REKENING', 'NOMINAL', 'TANGGAL', 'METODE', 'STATUS', 'BIAYA'];
            if (nama.length >= 3 && !blacklist.some(b => nama.toUpperCase().startsWith(b))) {
                detail.namaPenerima = nama;
                break;
            }
        }
    }

    // Coba ekstrak bank tujuan
    const bankTujuanPatterns = [
        /bank\s+tujuan\s*[:\-]\s*([A-Z][A-Z\s]{2,25}?)(?:\n|$)/im,
        /(?:ke\s+bank|tujuan\s+bank)\s*[:\-]\s*([A-Z][A-Z\s]{2,25}?)(?:\n|$)/im,
        /\b(BCA|BRI|BNI|MANDIRI|BSI|CIMB|DANAMON|PERMATA|BTN|JAGO|SEABANK|OVO|GOPAY|DANA)\b/i,
    ];
    for (const pat of bankTujuanPatterns) {
        const m = rawText.match(pat);
        if (m && m[1]) { detail.bankTujuan = m[1].trim(); break; }
    }

    // Ekstrak nomor rekening tujuan (opsional, untuk catatan)
    const noRekPat = /(?:no\.?\s*rek(?:ening)?|account\s*(?:no|number))\s*[:\-]?\s*(\d[\d\s\-]{8,19}\d)/im;
    const noRekM = rawText.match(noRekPat);
    if (noRekM) detail.noRekening = noRekM[1].replace(/\s+/g, '').trim();

    return detail;
}

// ═══════════════════════════════════════════════════════════════
// EKSTRAK NAMA TOKO dari baris atas struk (heuristik OCR)
// ═══════════════════════════════════════════════════════════════
function extractNamaToko(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    // Blacklist: baris yang pasti bukan nama toko
    const blacklistPatterns = [
        /^\d+$/, /^https?/i, /[.]{3,}/, /^\*+$/, /^[-=_]+$/,
        /^(total|subtotal|grand total|jumlah|bayar|tunai|kembali|kembalian|diskon|ppn|pajak|tax|dpp|service charge)/i,
        /^(no\.?\s*(struk|faktur|invoice|order|trx|ref|nota|bon|kasir|tanda terima))/i,
        /^(tanggal|tgl|date|waktu|time|jam|kasir|operator|cashier|served by)/i,
        /^(qty|pcs|satuan|unit|harga|price|jml|jumlah)/i,
        /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,    // tanggal
        /^\d{13,}$/,                                   // barcode
        /^(terima kasih|thank you|selamat datang|welcome|terimakasih)/i,
        /^(jl\.|jalan|rt\/rw|no\.\s*\d+|kel\.|kec\.|kota|kab\.)/i,  // alamat
        /^(telp|tel|phone|fax|www\.|@)/i,
        /^(struk|nota|invoice|kwitansi|receipt|bon|faktur)/i,
        /^\(?\+?62[\d\s\-]+$/,  // nomor telepon
        /^0\d{8,}$/,            // nomor telepon lokal
    ];

    const isBlacklisted = (line) => blacklistPatterns.some(p => p.test(line));

    // Cari nama toko: baris pertama yang tidak di-blacklist, punya huruf, panjang 2-60
    const candidates = lines.slice(0, 12).filter(l =>
        l.length >= 2 && l.length <= 60 &&
        /[a-zA-Z]/.test(l) &&
        !isBlacklisted(l)
    );

    if (candidates.length === 0) return null;

    // Gabung 1-2 baris pertama yang cocok (nama toko bisa 2 baris)
    let namaToko = candidates[0];
    if (candidates[1] && candidates[1].length <= 40 &&
        !candidates[1].match(/\d{5,}/) && candidates.indexOf(candidates[1]) <= 3) {
        // Cek apakah baris ke-2 masih kemungkinan nama/cabang
        const isBranchLine = /\b(cab\.|cabang|branch|outlet|store|toko|warung|resto|cafe|kafe)\b/i.test(candidates[1]);
        if (isBranchLine || candidates[1].length <= 25) {
            namaToko = `${candidates[0]} ${candidates[1]}`.trim().substring(0, 60);
        }
    }

    return namaToko.replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════
// EKSTRAK NOMINAL dari teks OCR — multi-pola Indonesia
// ═══════════════════════════════════════════════════════════════
function extractNominal(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    // Urutan prioritas pattern (lebih spesifik dulu)
    const totalPatterns = [
        // Pola SPBU: "TOTAL Rp 100.000" atau "TOTAL: 100000"
        /(?:total\s*(?:harga|bayar|tagihan|pembayaran|pembelian|penjualan|transaksi)?)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        // Pola minimarket: "GRAND TOTAL", "TOTAL BELANJA"
        /(?:grand\s*total|total\s*belanja)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        // "TOTAL Rp" tanpa kata lain
        /^total\s*rp\.?\s*([\d.,]+)/im,
        // Struk restoran: "TOTAL TAGIHAN" atau "TOTAL BILL"
        /(?:total\s*(?:tagihan|bill)|tagihan\s*total)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        // Struk transfer/bank: "Nominal" atau "Jumlah"
        /(?:nominal|jumlah\s*(?:transfer|pengiriman|transaksi)?)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        // "TUNAI" / "CASH" — uang yang dibayar
        /(?:tunai|cash(?:\s*payment)?)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        // Pola struk PLN: "Rp XXXXXX" standalone
        /^rp\.?\s*([\d.,]{4,})\s*$/im,
        // "Jumlah Bayar" (e-wallet, tagihan)
        /(?:jumlah\s*bayar|total\s*dibayar|dibayar)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        // Angka setelah "Rp" di baris mana saja
        /rp\.?\s*([\d.,]{4,})/i,
        // Pola lama: subtotal, total biasa
        /(?:subtotal|sub\s*total)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        // Angka 4+ digit yang ada di baris "TOTAL" apapun
        /total[^\d]*([\d.,]{4,})/i,
    ];

    // Cek per baris dulu (lebih presisi)
    for (const pat of totalPatterns) {
        for (const line of lines) {
            const m = line.match(pat);
            if (m && m[1]) {
                const raw = m[1].replace(/\./g, '').replace(/,/g, '');
                const val = parseInt(raw);
                if (val >= 500 && val <= 500_000_000) return val;
            }
        }
    }

    // Fallback: cari semua angka >= 1000, ambil yang paling besar (kemungkinan total)
    const allNums = [...rawText.matchAll(/\b(\d[\d.,]{2,})\b/g)]
        .map(m => parseInt(m[1].replace(/[.,]/g, '')))
        .filter(n => !isNaN(n) && n >= 1000 && n <= 500_000_000);

    if (allNums.length === 0) return 0;

    // Jika ada banyak angka, ambil yang paling sering muncul di "area bawah" struk
    // Strategi: ambil 40% baris bawah, cari angka terbesar di situ
    const bottomLines = lines.slice(Math.floor(lines.length * 0.6));
    const bottomNums = [...bottomLines.join('\n').matchAll(/\b(\d[\d.,]{2,})\b/g)]
        .map(m => parseInt(m[1].replace(/[.,]/g, '')))
        .filter(n => !isNaN(n) && n >= 1000 && n <= 500_000_000);

    if (bottomNums.length > 0) return Math.max(...bottomNums);
    return Math.max(...allNums);
}

// ═══════════════════════════════════════════════════════════════
// PRE-DETECTION: Deteksi jenis struk dengan pengetahuan lengkap
// (berdasarkan riset format struk nyata Indonesia 2024-2025)
// ═══════════════════════════════════════════════════════════════
function preDetectReceiptType(rawText) {
    if (!rawText) return null;
    const t = rawText.toLowerCase();

    // Helper: ekstrak nama toko dari OCR (digunakan di beberapa kategori)
    const extractedToko = () => extractNamaToko(rawText);

    // ═══════════════════════════════════════════════════════════════
    // 1. TRANSFER BANK
    // Pola nyata: BCA myBCA, BRI BRImo, Mandiri Livin, BNI Mobile,
    //             BSI Mobile, CIMB Octo, Jago, SeaBank, Jenius, dll.
    // ═══════════════════════════════════════════════════════════════
    const isBCATransfer = (
        t.includes('biz id') || t.includes('bizid') ||
        (t.includes('bi-fast') || t.includes('bifast')) ||
        (t.includes('m-transfer') && t.includes('berhasil')) ||
        (t.includes('transfer berhasil') && t.includes('bca')) ||
        (t.includes('sumber dana') && t.includes('penerima')) ||
        (t.includes('klikbca') && t.includes('transfer')) ||
        (t.includes('mybca') && t.includes('transfer')) ||
        (t.includes('detail transfer') && t.includes('nominal')) ||
        (t.includes('metode transfer') && (t.includes('bi-fast') || t.includes('rtgs') || t.includes('online')))
    );
    const isBRITransfer = (
        (t.includes('brimo') && t.includes('transfer')) ||
        (t.includes('bri') && t.includes('transfer berhasil')) ||
        (t.includes('no. referensi') && t.includes('bri')) ||
        (t.includes('rekening tujuan') && t.includes('bri')) ||
        (t.includes('bri') && t.includes('pengiriman berhasil'))
    );
    const isMandiriTransfer = (
        (t.includes('livin') && t.includes('transfer')) ||
        (t.includes('mandiri') && t.includes('transfer berhasil')) ||
        (t.includes('mandiri') && t.includes('rekening tujuan')) ||
        (t.includes('no. transaksi') && t.includes('mandiri')) ||
        (t.includes('mandiri online') && t.includes('transfer'))
    );
    const isBNITransfer = (
        (t.includes('bni') && t.includes('transfer berhasil')) ||
        (t.includes('bni mobile') && t.includes('transfer')) ||
        /bni-\d+/.test(t) ||
        (t.includes('bni') && t.includes('rekening tujuan'))
    );
    const isBSITransfer = (
        (t.includes('bsi') && t.includes('transfer')) ||
        (t.includes('bank syariah indonesia') && t.includes('transfer')) ||
        (t.includes('hasanah') && t.includes('transfer'))
    );
    const isJenius = (
        (t.includes('jenius') && t.includes('kirim')) ||
        (t.includes('jenius') && t.includes('send'))
    );
    const isSeaBankTransfer = (
        (t.includes('seabank') || t.includes('sea bank')) && t.includes('transfer')
    );
    const isJagoTransfer = (
        (t.includes('bank jago') || t.includes('jago')) &&
        (t.includes('kirim uang') || t.includes('transfer'))
    );
    const isOVOTransfer = (
        t.includes('ovo') && (t.includes('kirim') || t.includes('transfer'))
    );
    const isGopayTransfer = (
        t.includes('gopay') && t.includes('kirim')
    );
    const isDANATransfer = (
        t.includes('dana') && (t.includes('kirim') || t.includes('transfer'))
    );
    const isGenericTransfer = (
        (t.includes('transfer berhasil') || t.includes('pengiriman berhasil') ||
         t.includes('transaksi berhasil') && t.includes('rekening')) ||
        (t.includes('rekening tujuan') && (t.includes('nominal') || t.includes('jumlah'))) ||
        (t.includes('penerima') && t.includes('sumber dana')) ||
        (t.includes('no. rekening') && t.includes('transfer')) ||
        (t.includes('tujuan transaksi') && t.includes('nominal')) ||
        (t.includes('biaya transaksi') && t.includes('nominal') && t.includes('penerima')) ||
        (t.includes('no. ref') && t.includes('penerima') && t.includes('nominal'))
    );

    if (isBCATransfer || isBRITransfer || isMandiriTransfer || isBNITransfer ||
        isBSITransfer || isJenius || isSeaBankTransfer || isJagoTransfer ||
        isOVOTransfer || isGopayTransfer || isDANATransfer || isGenericTransfer) {
        const detail = extractTransferDetail(rawText);
        const namaToko = detail.namaPenerima || 'Penerima Tidak Diketahui';
        const catatanParts = [];
        if (detail.bankPengirim) catatanParts.push(`dari ${detail.bankPengirim}`);
        if (detail.bankTujuan && detail.bankTujuan.toLowerCase() !== detail.bankPengirim.toLowerCase())
            catatanParts.push(`ke ${detail.bankTujuan}`);
        if (detail.noRekening) catatanParts.push(`rek: ${detail.noRekening}`);
        const catatan = catatanParts.length ? `Transfer ${catatanParts.join(', ')}` : `Transfer ${detail.bankPengirim}`;
        return {
            toko: namaToko, kategori: 'Tagihan', sub: 'Transfer',
            confidence: 97.0, status: '✅ Valid',
            isTransfer: true, bankPengirim: detail.bankPengirim,
            namaPenerima: detail.namaPenerima, catatanTransfer: catatan,
            isPreDetected: true,
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. TAGIHAN UTILITAS — PLN, PDAM, BPJS, Telepon, dll.
    // ═══════════════════════════════════════════════════════════════
    // PLN Token / Prabayar / Pascabayar
    const isPLNToken = t.includes('pln') && (
        t.includes('token') || t.includes('stroom') || t.includes('kwh') ||
        t.includes('no. meter') || t.includes('nomor meter') || t.includes('id pelanggan')
    );
    const isPLNPasca = t.includes('pln') && (
        t.includes('listrik pascabayar') || t.includes('tagihan listrik') ||
        t.includes('rekening listrik') || t.includes('lembar tagihan')
    );
    if (isPLNToken) {
        // Coba ekstrak daya/tarif dari struk PLN
        const dayaMatch = rawText.match(/(\d+)\s*(?:va|watt|kwh)/i);
        const daya = dayaMatch ? ` ${dayaMatch[1]}VA` : '';
        return { toko: `PLN Token Listrik${daya}`, kategori: 'Tagihan', sub: 'Listrik', confidence: 98.0, status: '✅ Valid', isPreDetected: true };
    }
    if (isPLNPasca) return { toko: 'PLN Pascabayar', kategori: 'Tagihan', sub: 'Listrik', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    // PDAM / Air
    const isPDAM = t.includes('pdam') || (t.includes('tagihan air') && t.includes('pelanggan'));
    if (isPDAM) {
        const pdamMatch = rawText.match(/pdam\s+(?:tirta\s+)?([a-z\s]+?)(?:\n|$)/i);
        const pdamNama = pdamMatch ? `PDAM ${pdamMatch[1].trim().substring(0,20)}` : 'PDAM';
        return { toko: pdamNama, kategori: 'Tagihan', sub: 'Air', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    // BPJS
    const isBPJSKes = t.includes('bpjs kesehatan') || (t.includes('bpjs') && t.includes('kesehatan'));
    const isBPJSTK  = t.includes('bpjs ketenagakerjaan') || (t.includes('bpjs') && t.includes('ketenagakerjaan'));
    if (isBPJSKes) return { toko: 'BPJS Kesehatan', kategori: 'Tagihan', sub: 'Asuransi Kesehatan', confidence: 98.0, status: '✅ Valid', isPreDetected: true };
    if (isBPJSTK)  return { toko: 'BPJS Ketenagakerjaan', kategori: 'Tagihan', sub: 'Asuransi', confidence: 98.0, status: '✅ Valid', isPreDetected: true };
    // Internet / TV Kabel
    const isIndihome  = t.includes('indihome') || (t.includes('telkom') && (t.includes('tagihan') || t.includes('invoice')));
    const isFirstMedia = t.includes('first media') || t.includes('firstmedia');
    const isMNC       = t.includes('mnc vision') || t.includes('mncvision');
    const isIndiHome2 = t.includes('speedy') && t.includes('tagihan');
    const isByoN      = t.includes('byon') && t.includes('internet');
    const isMyRepublic = t.includes('myrepublic');
    const isBiznet    = t.includes('biznet');
    const isIconnet   = t.includes('iconnet') || t.includes('icon+');
    if (isIndihome || isIndiHome2)  return { toko: 'IndiHome / Telkom', kategori: 'Tagihan', sub: 'Internet & TV', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isFirstMedia) return { toko: 'First Media', kategori: 'Tagihan', sub: 'Internet & TV', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isMNC)        return { toko: 'MNC Vision', kategori: 'Tagihan', sub: 'Internet & TV', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isMyRepublic) return { toko: 'MyRepublic', kategori: 'Tagihan', sub: 'Internet', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isBiznet)     return { toko: 'Biznet', kategori: 'Tagihan', sub: 'Internet', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isIconnet)    return { toko: 'Iconnet / Icon+', kategori: 'Tagihan', sub: 'Internet', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    // Tagihan Virtual Account / PPOB
    const isVA = (
        (t.includes('virtual account') || /\bva\b/.test(t)) &&
        (t.includes('berhasil') || t.includes('sukses') || t.includes('lunas') || t.includes('pembayaran'))
    );
    const isSamsat = t.includes('samsat') && (t.includes('pajak') || t.includes('pkb') || t.includes('kendaraan'));
    const isPBB    = t.includes('pbb') && (t.includes('pajak bumi') || t.includes('bangunan') || t.includes('nop'));
    if (isSamsat) return { toko: 'SAMSAT Pajak Kendaraan', kategori: 'Tagihan', sub: 'Pajak', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isPBB)    return { toko: 'PBB Pajak Bumi & Bangunan', kategori: 'Tagihan', sub: 'Pajak', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isVA)     return { toko: 'Bayar Tagihan Virtual Account', kategori: 'Tagihan', sub: 'Perbankan', confidence: 90.0, status: '✅ Valid', isPreDetected: true };

    // ═══════════════════════════════════════════════════════════════
    // 3. TOP UP / ISI SALDO E-WALLET & KARTU PREPAID
    // ═══════════════════════════════════════════════════════════════
    const topUpKeywords = ['top up', 'topup', 'isi saldo', 'tambah saldo', 'pengisian saldo', 'refill saldo'];
    const isAnyTopUp = topUpKeywords.some(k => t.includes(k));
    if (isAnyTopUp || (t.includes('saldo') && (t.includes('berhasil') || t.includes('sukses')))) {
        let wallet = 'E-Wallet';
        let sub = 'Dompet Digital';
        if (t.includes('ovo'))        { wallet = 'OVO'; }
        else if (t.includes('gopay')) { wallet = 'GoPay'; }
        else if (t.includes('dana'))  { wallet = 'DANA'; }
        else if (t.includes('shopeepay') || t.includes('spay')) { wallet = 'ShopeePay'; }
        else if (t.includes('linkaja'))  { wallet = 'LinkAja'; }
        else if (t.includes('flazz'))    { wallet = 'Flazz BCA'; sub = 'Kartu Prepaid'; }
        else if (t.includes('tapcash'))  { wallet = 'TapCash BNI'; sub = 'Kartu Prepaid'; }
        else if (t.includes('e-money') || t.includes('emoney')) { wallet = 'Mandiri e-Money'; sub = 'Kartu Prepaid'; }
        else if (t.includes('brizzi'))   { wallet = 'BRI Brizzi'; sub = 'Kartu Prepaid'; }
        else if (t.includes('jakcard'))  { wallet = 'JakCard'; sub = 'Kartu Prepaid'; }
        return { toko: `Top Up ${wallet}`, kategori: 'Tagihan', sub, confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. MINIMARKET & SUPERMARKET
    // Format Indomaret: header nama toko, alamat, NPWP, tgl, item list,
    //   SUBTOTAL, DISKON, DPP, PPN, TOTAL, TUNAI, KEMBALI
    // Format Alfamart: mirip, kadang ada "PROMO", "POINT", "NO STRUK"
    // ═══════════════════════════════════════════════════════════════
    if (t.includes('indomaret')) {
        // Coba ekstrak cabang
        const cabangMatch = rawText.match(/indomaret\s+([^\n]{1,40})/i);
        const cabang = cabangMatch ? cabangMatch[1].trim() : '';
        return { toko: `Indomaret${cabang ? ' ' + cabang.substring(0,30) : ''}`, kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    if (t.includes('alfamart')) {
        const cabangMatch = rawText.match(/alfamart\s+([^\n]{1,40})/i);
        const cabang = cabangMatch ? cabangMatch[1].trim() : '';
        return { toko: `Alfamart${cabang ? ' ' + cabang.substring(0,30) : ''}`, kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    if (t.includes('alfamidi'))    return { toko: 'Alfamidi', kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('circle k'))    return { toko: 'Circle K', kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('lawson'))      return { toko: 'Lawson', kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('familymart'))  return { toko: 'FamilyMart', kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('superindo'))   return { toko: 'Superindo', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('hypermart'))   return { toko: 'Hypermart', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('transmart'))   return { toko: 'Transmart Carrefour', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('lottemart'))   return { toko: 'LotteMart', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('giant'))       return { toko: 'Giant', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('hero supermarket') || (t.includes('hero') && t.includes('supermarket')))
        return { toko: 'Hero Supermarket', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('ranch market') || t.includes('ranchmarket'))
        return { toko: 'Ranch Market', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('farmers market'))
        return { toko: "Farmer's Market", kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('papaya fresh gallery'))
        return { toko: 'Papaya Fresh Gallery', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('tip top'))
        return { toko: 'Tip Top', kategori: 'Kebutuhan Pokok', sub: 'Supermarket', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    // Deteksi generic struk kasir minimarket (punya TUNAI + KEMBALI + item list)
    const hasKasirPattern = (
        (t.includes('tunai') || t.includes('cash')) &&
        (t.includes('kembali') || t.includes('kembalian') || t.includes('change')) &&
        (t.includes('total') || t.includes('subtotal')) &&
        (t.includes('ppn') || t.includes('dpp') || /\d+\s*x\s*[\d.,]+/.test(t))
    );
    if (hasKasirPattern) {
        const namaTokoExtract = extractedToko();
        return { toko: namaTokoExtract, kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 85.0, status: '🔶 Review', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. RESTORAN & FAST FOOD
    // Format: nama resto di atas, item + qty + harga, subtotal,
    //   tax/pb1 (10%), total, metode bayar
    // ═══════════════════════════════════════════════════════════════
    // Fast Food chains
    const fastFoodMap = {
        'mcdonald': "McDonald's", "mcd": "McDonald's",
        'kfc': 'KFC', 'kentucky': 'KFC',
        'burger king': 'Burger King', 'bk ': 'Burger King',
        'pizza hut': 'Pizza Hut',
        "domino's": "Domino's Pizza", 'dominos': "Domino's Pizza",
        'subway': 'Subway',
        'a&w': 'A&W', 'a & w': 'A&W',
        'texas chicken': 'Texas Chicken',
        'popeyes': 'Popeyes',
        'wingstop': 'Wingstop',
        'hokben': 'HokBen', 'hoka hoka': 'HokBen',
        'yoshinoya': 'Yoshinoya',
        'richeese': 'Richeese Factory',
        'jollibee': 'Jollibee',
        'wendys': "Wendy's", "wendy's": "Wendy's",
        'carl\'s jr': "Carl's Jr",
        'five guys': 'Five Guys',
        'marugame': 'Marugame Udon',
        'yoshikin': 'Yoshikin',
        'lotteria': 'Lotteria',
        'sushi tei': 'Sushi Tei',
        'sushi groove': 'Sushi Groove',
        'genki sushi': 'Genki Sushi',
        'grill express': 'Grill Express',
        'solaria': 'Solaria',
        'hanamasa': 'Hanamasa',
        'pochajjang': 'Pochajjang',
        'platinum waffle': 'Platinum Waffle',
    };
    for (const [key, val] of Object.entries(fastFoodMap)) {
        if (t.includes(key)) return { toko: val, kategori: 'Makanan & Minuman', sub: 'Fast Food', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    // Struk Restoran Generic (ada PB1/tax restoran + item makanan)
    const hasPB1 = t.includes('pb1') || t.includes('pajak restoran') || t.includes('service charge');
    const hasMenuItems = (t.includes('nasi') || t.includes('ayam') || t.includes('mie') || t.includes('sop') ||
        t.includes('soto') || t.includes('bakso') || t.includes('makan') || t.includes('minum') ||
        t.includes('minuman') || t.includes('makanan') || t.includes('paket'));
    if (hasPB1 && hasMenuItems && t.includes('total')) {
        const namaResto = extractedToko();
        return { toko: namaResto, kategori: 'Makanan & Minuman', sub: 'Restoran', confidence: 88.0, status: '🔶 Review', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 6. KAFE & MINUMAN
    // ═══════════════════════════════════════════════════════════════
    const kafeMap = {
        'starbucks': 'Starbucks', 'sbux': 'Starbucks',
        'kopi kenangan': 'Kopi Kenangan',
        'janji jiwa': 'Janji Jiwa', 'jiwa juice': 'Jiwa Juice',
        'fore coffee': 'Fore Coffee',
        'j.co': 'J.CO Donuts & Coffee', 'jco': 'J.CO',
        'excelso': 'Excelso',
        'anomali coffee': 'Anomali Coffee', 'anomali': 'Anomali Coffee',
        'tomoro coffee': 'Tomoro Coffee', 'tomoro': 'Tomoro Coffee',
        'djournal': 'Djournal Coffee',
        'chatime': 'Chatime',
        'gong cha': 'Gong Cha',
        'mixue': 'Mixue',
        'xing fu tang': 'Xing Fu Tang',
        'the alley': 'The Alley',
        'tealive': 'Tealive',
        'sharetea': 'ShareTea',
        'es teh indonesia': 'Es Teh Indonesia',
        'kopi lain hati': 'Kopi Lain Hati',
        'kopi soe': 'Kopi Soe',
        'filosopi kopi': 'Filosofi Kopi',
        'titik koma': 'Titik Koma',
        'upnormal': 'Upnormal',
        'common grounds': 'Common Grounds',
        'tanamera': 'Tanamera Coffee',
        'kopitiam': 'Kopitiam',
        'bengawan solo': 'Bengawan Solo',
        'boncafe': 'Boncafe',
        'liberica': 'Liberica',
        'crema': 'Crema',
        'black canyon': 'Black Canyon',
        'coffee bean': 'Coffee Bean',
        'caribou coffee': 'Caribou Coffee',
        'pablo': 'Pablo Cheese Tart',
        'bakerzin': 'Bakerzin',
        'tous les jours': 'Tous Les Jours',
        'paul bakery': 'Paul Bakery',
        'breadtalk': 'BreadTalk',
        'great harvest': 'Great Harvest',
        'hokkaido baked': 'Hokkaido Baked',
        'roti boy': 'Roti Boy',
        'beard papa': 'Beard Papa',
        'dapur cokelat': 'Dapur Cokelat',
        'dapurlah': 'Dapurlah',
        'almondtree': 'Almondtree',
    };
    for (const [key, val] of Object.entries(kafeMap)) {
        if (t.includes(key)) return { toko: val, kategori: 'Makanan & Minuman', sub: 'Kafe', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    // Kafe generic — ada kata kopi/tea + kasir/receipt + total
    const isKafeGeneric = (
        (t.includes('kopi') || t.includes('coffee') || t.includes('tea') || t.includes('boba') || t.includes('bubble')) &&
        (t.includes('kasir') || t.includes('receipt') || t.includes('cashier') || t.includes('total')) &&
        t.includes('total')
    );
    if (isKafeGeneric) {
        const namaCafe = extractedToko();
        return { toko: namaCafe, kategori: 'Makanan & Minuman', sub: 'Kafe', confidence: 85.0, status: '🔶 Review', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. SPBU / BBM
    // Format Pertamina: NO SERI, ID PELANGGAN/KODE TRANSAKSI,
    //   NOMOR POMPA, JENIS BBM, VOLUME (liter), HARGA/LITER, TOTAL
    // ═══════════════════════════════════════════════════════════════
    const bbmJenis = ['pertamax', 'pertalite', 'solar', 'biosolar', 'dexlite', 'pertadex', 'premium', 'pertamina dex'];
    const hasBBMJenis = bbmJenis.some(j => t.includes(j));
    const hasBBMKeyword = (
        (t.includes('pertamina') || t.includes('spbu') || t.includes('shell') || t.includes('vivo') || t.includes('bp station') || t.includes('total oil')) &&
        (t.includes('liter') || t.includes('lt') && /\d+[.,]\d+\s*lt/.test(t) || hasBBMJenis)
    );
    const isOnlyBBMJenis = hasBBMJenis && (t.includes('liter') || t.includes('/ltr') || t.includes('harga/liter') || t.includes('volume'));
    if (hasBBMKeyword || isOnlyBBMJenis) {
        let nama = 'SPBU Pertamina';
        const noSPBU = rawText.match(/spbu\s*([\d\.]+)/i) || rawText.match(/no\.?\s*spbu\s*[:\-]?\s*([\d\.]+)/i);
        if (t.includes('shell'))         nama = 'Shell';
        else if (t.includes('vivo'))     nama = 'Vivo Energy';
        else if (t.includes('bp station') || t.includes('bp oil')) nama = 'BP';
        else if (t.includes('total oil') || t.includes('total energies')) nama = 'TotalEnergies';
        else if (noSPBU) nama = `SPBU Pertamina ${noSPBU[1]}`;
        // Coba ekstrak jenis BBM yang dibeli
        const jenisDibeli = bbmJenis.find(j => t.includes(j));
        if (jenisDibeli) nama += ` (${jenisDibeli.charAt(0).toUpperCase() + jenisDibeli.slice(1)})`;
        return { toko: nama, kategori: 'Transportasi', sub: 'BBM', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 8. OJEK ONLINE, RIDE-HAILING, FOOD DELIVERY
    // ═══════════════════════════════════════════════════════════════
    const isGojekRide = t.includes('gojek') && (t.includes('goride') || t.includes('gocar') || t.includes('goxtra') || t.includes('perjalanan') || t.includes('fare'));
    const isGojekFood = t.includes('gojek') && (t.includes('gofood') || t.includes('go-food') || t.includes('makanan'));
    const isGrabRide  = t.includes('grab') && (t.includes('grabcar') || t.includes('grabike') || t.includes('grabexpress') || t.includes('perjalanan') || t.includes('fare'));
    const isGrabFood  = t.includes('grab') && (t.includes('grabfood') || t.includes('grab food'));
    const isMaxim     = t.includes('maxim') && (t.includes('perjalanan') || t.includes('fare') || t.includes('order'));
    const isInDriver  = t.includes('indrive') && (t.includes('perjalanan') || t.includes('fare'));
    const isBluebird  = t.includes('blue bird') || t.includes('bluebird');
    const isExpress   = t.includes('express taxi') || t.includes('exprestax');
    if (isGojekRide) return { toko: 'Gojek (GoRide/GoCar)', kategori: 'Transportasi', sub: 'Ojek Online', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isGojekFood) return { toko: 'GoFood', kategori: 'Makanan & Minuman', sub: 'Delivery Makanan', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (isGrabRide)  return { toko: 'Grab (GrabCar/GrabBike)', kategori: 'Transportasi', sub: 'Ojek Online', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isGrabFood)  return { toko: 'GrabFood', kategori: 'Makanan & Minuman', sub: 'Delivery Makanan', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (isMaxim)     return { toko: 'Maxim', kategori: 'Transportasi', sub: 'Ojek Online', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (isInDriver)  return { toko: 'inDriver', kategori: 'Transportasi', sub: 'Ojek Online', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (isBluebird)  return { toko: 'Blue Bird Taxi', kategori: 'Transportasi', sub: 'Taksi', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (isExpress)   return { toko: 'Express Taxi', kategori: 'Transportasi', sub: 'Taksi', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    // ShopeeFood
    if (t.includes('shopeefood') || (t.includes('shopee') && t.includes('pengiriman makanan')))
        return { toko: 'ShopeeFood', kategori: 'Makanan & Minuman', sub: 'Delivery Makanan', confidence: 96.0, status: '✅ Valid', isPreDetected: true };

    // ═══════════════════════════════════════════════════════════════
    // 9. PARKIR & TOL
    // ═══════════════════════════════════════════════════════════════
    const isTol = (
        t.includes('jasa marga') || t.includes('lintas marga') || t.includes('citra marga') ||
        t.includes('hutama karya') || t.includes('waskita toll') ||
        t.includes('gerbang tol') || (t.includes('tol') && t.includes('ruas')) ||
        t.includes('e-toll') || t.includes('etoll') ||
        (t.includes('tol') && (t.includes('plat') || t.includes('kendaraan') || t.includes('transaksi')))
    );
    const isParkir = (
        t.includes('parkir') && (
            t.includes('masuk') || t.includes('keluar') || t.includes('tiket') ||
            t.includes('tarif') || t.includes('durasi') || t.includes('jam') ||
            t.includes('kendaraan') || t.includes('plat')
        )
    );
    if (isTol)    return { toko: 'Jalan Tol', kategori: 'Transportasi', sub: 'Tol', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isParkir) return { toko: 'Parkir', kategori: 'Transportasi', sub: 'Parkir', confidence: 95.0, status: '✅ Valid', isPreDetected: true };

    // ═══════════════════════════════════════════════════════════════
    // 10. KERETA / TRANSPORTASI UMUM
    // ═══════════════════════════════════════════════════════════════
    const isKAI = (
        t.includes('kai') || t.includes('kereta api indonesia') ||
        t.includes('krl') || t.includes('commuter line') ||
        (t.includes('kereta') && (t.includes('tiket') || t.includes('penumpang') || t.includes('gerbong')))
    );
    const isMRT    = (t.includes('mrt jakarta') || t.includes('mrt') && t.includes('stasiun'));
    const isLRT    = (t.includes('lrt jakarta') || t.includes('lrt') && t.includes('stasiun'));
    const isTransJ = t.includes('transjakarta') || (t.includes('trans jakarta') && t.includes('bus'));
    const isBusway = (t.includes('busway') || t.includes('brt')) && t.includes('tiket');
    if (isKAI)    return { toko: 'KAI / Commuter Line', kategori: 'Transportasi', sub: 'Kereta', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isMRT)    return { toko: 'MRT Jakarta', kategori: 'Transportasi', sub: 'MRT', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isLRT)    return { toko: 'LRT Jakarta', kategori: 'Transportasi', sub: 'LRT', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isTransJ) return { toko: 'TransJakarta', kategori: 'Transportasi', sub: 'Bus', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (isBusway) return { toko: 'Bus Rapid Transit', kategori: 'Transportasi', sub: 'Bus', confidence: 94.0, status: '✅ Valid', isPreDetected: true };

    // ═══════════════════════════════════════════════════════════════
    // 11. TIKET PESAWAT
    // ═══════════════════════════════════════════════════════════════
    const airlinesMap = {
        'garuda indonesia': 'Garuda Indonesia', 'garuda': 'Garuda Indonesia',
        'lion air': 'Lion Air', 'lion': 'Lion Air',
        'citilink': 'Citilink',
        'airasia': 'AirAsia',
        'batik air': 'Batik Air',
        'sriwijaya': 'Sriwijaya Air',
        'nam air': 'NAM Air',
        'wings air': 'Wings Air',
        'super air jet': 'Super Air Jet',
        'pelita air': 'Pelita Air',
        'transnusa': 'TransNusa',
    };
    const hasFlightKeyword = t.includes('pnr') || t.includes('boarding pass') || t.includes('penerbangan') || t.includes('flight');
    for (const [key, val] of Object.entries(airlinesMap)) {
        if (t.includes(key)) return { toko: val, kategori: 'Perjalanan', sub: 'Tiket Pesawat', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    if (hasFlightKeyword) {
        const namaMaskapai = extractedToko();
        return { toko: namaMaskapai, kategori: 'Perjalanan', sub: 'Tiket Pesawat', confidence: 88.0, status: '🔶 Review', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 12. APOTEK & TOKO KESEHATAN
    // ═══════════════════════════════════════════════════════════════
    const apotekMap = {
        'kimia farma': 'Kimia Farma',
        'k-24': 'K-24', 'k24': 'K-24',
        'guardian': 'Guardian',
        'century': 'Century Drugstore',
        'watsons': 'Watsons', 'watson': 'Watsons',
        'apotik sehat': 'Apotek Sehat',
        'klinikfarma': 'KlinikFarma',
        'healthy world': 'Healthy World',
    };
    for (const [key, val] of Object.entries(apotekMap)) {
        if (t.includes(key)) return { toko: val, kategori: 'Kesehatan', sub: 'Apotek', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    // Apotek generic
    const isApotekGeneric = (
        t.includes('apotek') || t.includes('apotik') ||
        (t.includes('obat') && (t.includes('resep') || t.includes('apoteker') || t.includes('farmasi'))) ||
        (t.includes('obat') && t.includes('tablet') && t.includes('total'))
    );
    if (isApotekGeneric) {
        const namaApotek = extractedToko() || 'Apotek';
        return { toko: namaApotek, kategori: 'Kesehatan', sub: 'Apotek', confidence: 93.0, status: '✅ Valid', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 13. RUMAH SAKIT, KLINIK, LABORATORIUM
    // ═══════════════════════════════════════════════════════════════
    const isRS = (
        t.includes('rumah sakit') || t.includes('rs umum') || t.includes('rsia') ||
        t.includes('rsup') || t.includes('rsud') || t.includes('rskb') ||
        (t.includes(' rs ') && (t.includes('dokter') || t.includes('pasien')))
    );
    const isKlinik = (
        t.includes('klinik') || t.includes('puskesmas') ||
        (t.includes('dokter') && (t.includes('konsultasi') || t.includes('biaya periksa') || t.includes('poliklinik')))
    );
    const isLab = (
        t.includes('laboratorium') || t.includes('lab medis') ||
        t.includes('prodia') || t.includes('cito') || t.includes('pramita') ||
        (t.includes('lab') && (t.includes('darah') || t.includes('urin') || t.includes('pemeriksaan')))
    );
    const isDrg = t.includes('dokter gigi') || t.includes('dental') || t.includes('drg.');
    if (isRS)     { const nama = extractedToko() || 'Rumah Sakit'; return { toko: nama, kategori: 'Kesehatan', sub: 'Rumah Sakit', confidence: 94.0, status: '✅ Valid', isPreDetected: true }; }
    if (isLab)    { const nama = extractedToko() || 'Laboratorium'; return { toko: nama, kategori: 'Kesehatan', sub: 'Laboratorium', confidence: 95.0, status: '✅ Valid', isPreDetected: true }; }
    if (isDrg)    { const nama = extractedToko() || 'Klinik Gigi'; return { toko: nama, kategori: 'Kesehatan', sub: 'Dokter Gigi', confidence: 94.0, status: '✅ Valid', isPreDetected: true }; }
    if (isKlinik) { const nama = extractedToko() || 'Klinik'; return { toko: nama, kategori: 'Kesehatan', sub: 'Klinik', confidence: 93.0, status: '✅ Valid', isPreDetected: true }; }
    // Optik
    if (t.includes('optik') || t.includes('optical') || (t.includes('kacamata') && t.includes('lensa')))
        { const nama = extractedToko() || 'Optik'; return { toko: nama, kategori: 'Kesehatan', sub: 'Optik', confidence: 93.0, status: '✅ Valid', isPreDetected: true }; }

    // ═══════════════════════════════════════════════════════════════
    // 14. E-COMMERCE / BELANJA ONLINE
    // ═══════════════════════════════════════════════════════════════
    const ecommerceMap = {
        'tokopedia': 'Tokopedia',
        'shopee': 'Shopee',
        'lazada': 'Lazada',
        'bukalapak': 'Bukalapak',
        'blibli': 'Blibli',
        'tiktok shop': 'TikTok Shop', 'tiktokshop': 'TikTok Shop',
        'zalora': 'Zalora',
        'jd.id': 'JD.ID', 'jd id': 'JD.ID',
        'bhinneka': 'Bhinneka',
        'orami': 'Orami',
        'sociolla': 'Sociolla',
        'tiket.com': 'Tiket.com',
        'traveloka': 'Traveloka',
        'pegipegi': 'PegiPegi',
        'booking.com': 'Booking.com',
        'agoda': 'Agoda',
        'trivago': 'Trivago',
    };
    const hasOrderKeyword = t.includes('pesanan') || t.includes('order id') || t.includes('order #') || t.includes('invoice') || t.includes('no. pemesanan');
    for (const [key, val] of Object.entries(ecommerceMap)) {
        if (t.includes(key)) return { toko: val, kategori: 'Belanja Online', sub: 'E-Commerce', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 15. PULSA, PAKET DATA, NOMOR TELEPON
    // ═══════════════════════════════════════════════════════════════
    const operatorMap = {
        'telkomsel': 'Telkomsel', 'simpati': 'Telkomsel', 'kartu as': 'Telkomsel', 'by.u': 'Telkomsel (by.U)', 'loop': 'Telkomsel (LOOP)',
        'xl axiata': 'XL Axiata', ' xl ': 'XL Axiata', 'xtracombo': 'XL Axiata',
        'indosat': 'Indosat Ooredoo', 'im3': 'Indosat Ooredoo', 'ooredoo': 'Indosat Ooredoo', 'mentari': 'Indosat Ooredoo',
        'tri ': 'Tri', '3 indonesia': 'Tri', 'hutchison': 'Tri',
        'smartfren': 'Smartfren',
        'axis': 'Axis (XL)',
    };
    const hasPulsaKeyword = t.includes('pulsa') || t.includes('paket data') || t.includes('kuota') ||
        t.includes('masa aktif') || /\d+\s*gb/i.test(t) || t.includes('internet\s*\d+');
    for (const [key, val] of Object.entries(operatorMap)) {
        if (t.includes(key) && hasPulsaKeyword) return { toko: `${val} - Pulsa/Data`, kategori: 'Tagihan', sub: 'Pulsa & Data', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 16. BIOSKOP & HIBURAN
    // ═══════════════════════════════════════════════════════════════
    const bioskopMap = {
        'cgv': 'CGV Cinemas',
        'cinema xxi': 'Cinema XXI', 'xxi': 'Cinema XXI', '21 cineplex': 'Cinema XXI',
        'cinepolis': 'Cinépolis',
        'platinum cineplex': 'Platinum Cineplex',
        'cinemaxx': 'CinemaXX',
        'imax': 'IMAX Theatre',
        'sf cinema': 'SF Cinema',
    };
    const hasBioskopKeyword = t.includes('studio') || t.includes('seat') || t.includes('kursi') || t.includes('film') || t.includes('movie');
    for (const [key, val] of Object.entries(bioskopMap)) {
        if (t.includes(key)) return { toko: val, kategori: 'Hiburan', sub: 'Bioskop', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }
    if (hasBioskopKeyword && (t.includes('tiket') || t.includes('ticket'))) {
        const namaBioskop = extractedToko() || 'Bioskop';
        return { toko: namaBioskop, kategori: 'Hiburan', sub: 'Bioskop', confidence: 88.0, status: '🔶 Review', isPreDetected: true };
    }
    // Game / Hiburan lain
    if (t.includes('timezone') || t.includes('fun world') || t.includes('amazone') || t.includes('arena games') || t.includes('timezone'))
        return { toko: extractedToko() || 'Wahana Hiburan', kategori: 'Hiburan', sub: 'Wahana Hiburan', confidence: 94.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('karaoke') && (t.includes('nav') || t.includes('inul vizta') || t.includes('emperor')))
        return { toko: extractedToko() || 'Karaoke', kategori: 'Hiburan', sub: 'Karaoke', confidence: 94.0, status: '✅ Valid', isPreDetected: true };

    // ═══════════════════════════════════════════════════════════════
    // 17. FASHION & PAKAIAN
    // ═══════════════════════════════════════════════════════════════
    const fashionMap = {
        'zara': 'Zara', 'h&m': 'H&M', 'uniqlo': 'Uniqlo',
        'mango': 'Mango', 'cotton on': 'Cotton On',
        'pull & bear': 'Pull & Bear', 'bershka': 'Bershka',
        'stradivarius': 'Stradivarius',
        'marks & spencer': "Marks & Spencer",
        'banana republic': 'Banana Republic',
        'gap ': 'GAP', 'old navy': 'Old Navy',
        'levi\'s': "Levi's", 'levis': "Levi's",
        'guess': 'Guess',
        'polo ralph': 'Polo Ralph Lauren',
        'lacoste': 'Lacoste',
        'matahari': 'Matahari Dept Store',
        'centro': 'Centro Dept Store',
        'ramayana': 'Ramayana',
        'sport station': 'Sport Station',
        'planet sports': 'Planet Sports',
        'nike': 'Nike',
        'adidas': 'Adidas',
        'new era': 'New Era',
        'converse': 'Converse',
        'vans': 'Vans',
        'skechers': 'Skechers',
        'sophie paris': 'Sophie Paris',
        'anne avantie': 'Anne Avantie',
    };
    for (const [key, val] of Object.entries(fashionMap)) {
        if (t.includes(key) && (t.includes('total') || t.includes('size') || t.includes('qty') || t.includes('ukuran')))
            return { toko: val, kategori: 'Fashion', sub: 'Pakaian & Aksesoris', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 18. ELEKTRONIK & GADGET
    // ═══════════════════════════════════════════════════════════════
    const elektrMap = {
        'ibox': 'iBox (Apple Reseller)',
        'istyle': 'iStyle',
        'digimap': 'Digimap',
        'samsung store': 'Samsung Store',
        'samsung experience': 'Samsung Store',
        'erafone': 'Erafone',
        'iphone': 'Apple', 'macbook': 'Apple', 'airpods': 'Apple',
        'courts': 'Courts Megastore',
        'electronic city': 'Electronic City',
        'Best Denki': 'Best Denki',
        'medicomp': 'Medicomp',
        'datascrip': 'Datascrip',
        'hartono elektronik': 'Hartono Elektronik',
        'galaxy store': 'Samsung Galaxy Store',
        'playstation store': 'PlayStation Store', 'ps store': 'PlayStation Store',
        'nintendo eshop': 'Nintendo eShop',
        'steam': 'Steam',
        'google play': 'Google Play Store',
        'app store': 'Apple App Store',
    };
    for (const [key, val] of Object.entries(elektrMap)) {
        if (t.includes(key)) return { toko: val, kategori: 'Belanja Online', sub: 'Elektronik & Gadget', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // 19. BENGKEL & OTOMOTIF
    // ═══════════════════════════════════════════════════════════════
    const isBengkel = (
        t.includes('bengkel') ||
        t.includes('auto 2000') || t.includes('auto2000') ||
        t.includes('astramoto') || t.includes('ahass') ||
        t.includes('yamaha ') && (t.includes('servis') || t.includes('parts')) ||
        t.includes('honda dealer') ||
        t.includes('suzuki dealer') ||
        t.includes('gaikindo') ||
        ((t.includes('servis') || t.includes('service')) &&
         (t.includes('motor') || t.includes('mobil') || t.includes('kendaraan') ||
          t.includes('oli') || t.includes('sparepart') || t.includes('ban') || t.includes('rem')))
    );
    if (isBengkel) {
        const namaBengkel = extractedToko() || 'Bengkel';
        return { toko: namaBengkel, kategori: 'Transportasi', sub: 'Perawatan Kendaraan', confidence: 93.0, status: '✅ Valid', isPreDetected: true };
    }
    // Car wash
    if (t.includes('cuci motor') || t.includes('cuci mobil') || t.includes('car wash') || t.includes('detailing'))
        return { toko: extractedToko() || 'Car Wash', kategori: 'Transportasi', sub: 'Perawatan Kendaraan', confidence: 93.0, status: '✅ Valid', isPreDetected: true };

    // ═══════════════════════════════════════════════════════════════
    // 20. HOTEL, AKOMODASI, PENGINAPAN
    // ═══════════════════════════════════════════════════════════════
    const isHotel = (
        (t.includes('hotel') || t.includes('resort') || t.includes('villa') || t.includes('inn') || t.includes('lodge') || t.includes('guest house')) &&
        (t.includes('check in') || t.includes('check out') || t.includes('check-in') || t.includes('check-out') ||
         t.includes('kamar') || t.includes('room') || t.includes('menginap') || t.includes('nights') ||
         t.includes('malam') || t.includes('night'))
    );
    const isKost = t.includes('kos') && (t.includes('sewa') || t.includes('bulan') || t.includes('kontrakan'));
    if (isHotel) { const nama = extractedToko() || 'Hotel'; return { toko: nama, kategori: 'Perjalanan', sub: 'Akomodasi Hotel', confidence: 94.0, status: '✅ Valid', isPreDetected: true }; }
    if (isKost)  { const nama = extractedToko() || 'Kos/Kontrakan'; return { toko: nama, kategori: 'Rumah Tangga', sub: 'Sewa Tempat Tinggal', confidence: 93.0, status: '✅ Valid', isPreDetected: true }; }

    // ═══════════════════════════════════════════════════════════════
    // 21. LAUNDRY & JASA RUMAH TANGGA
    // ═══════════════════════════════════════════════════════════════
    const isLaundry = (
        t.includes('laundry') || t.includes('laundrette') || t.includes('laundromat') ||
        (t.includes('cuci') && (t.includes('kg') || t.includes('kilo') || t.includes('kilogram') || t.includes('pakaian') || t.includes('baju'))) ||
        (t.includes('setrika') && (t.includes('kg') || t.includes('baju')))
    );
    const isJasaRumah = (
        t.includes('cleaning service') || t.includes('maid service') ||
        (t.includes('jasa') && (t.includes('bersih') || t.includes('bersih-bersih') || t.includes('berbenah'))) ||
        t.includes('jasa cuci')
    );
    if (isLaundry)    { const nama = extractedToko() || 'Laundry'; return { toko: nama, kategori: 'Rumah Tangga', sub: 'Laundry', confidence: 94.0, status: '✅ Valid', isPreDetected: true }; }
    if (isJasaRumah)  { const nama = extractedToko() || 'Jasa Rumah Tangga'; return { toko: nama, kategori: 'Rumah Tangga', sub: 'Jasa Rumah', confidence: 92.0, status: '✅ Valid', isPreDetected: true }; }

    // ═══════════════════════════════════════════════════════════════
    // 22. SALON, SPA, KECANTIKAN
    // ═══════════════════════════════════════════════════════════════
    const isSalon = (
        t.includes('salon') || t.includes('barbershop') || t.includes('barber') || t.includes('gunting rambut') ||
        t.includes('creambath') || t.includes('hair treatment') || t.includes('blow dry') ||
        t.includes('spa') && (t.includes('massage') || t.includes('pijat') || t.includes('treatment') || t.includes('body'))
    );
    if (isSalon) { const nama = extractedToko() || 'Salon/Barbershop'; return { toko: nama, kategori: 'Kesehatan', sub: 'Salon & Kecantikan', confidence: 93.0, status: '✅ Valid', isPreDetected: true }; }

    // ═══════════════════════════════════════════════════════════════
    // 23. GYM & OLAHRAGA
    // ═══════════════════════════════════════════════════════════════
    const gymMap = {
        'celebrity fitness': 'Celebrity Fitness',
        'gold\'s gym': "Gold's Gym",
        'fitness first': 'Fitness First',
        'anytime fitness': 'Anytime Fitness',
        'jigsports': 'JigSports',
        'superpark': 'SuperPark',
        'fit hub': 'Fit Hub',
        'platinum gym': 'Platinum Gym',
    };
    for (const [key, val] of Object.entries(gymMap)) {
        if (t.includes(key)) return { toko: val, kategori: 'Kesehatan', sub: 'Gym & Olahraga', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    }
    const isGym = (
        (t.includes('gym') || t.includes('fitness center') || t.includes('fitness')) &&
        (t.includes('membership') || t.includes('member') || t.includes('keanggotaan') || t.includes('bulanan') || t.includes('sesi'))
    );
    if (isGym) { const nama = extractedToko() || 'Gym / Fitness Center'; return { toko: nama, kategori: 'Kesehatan', sub: 'Gym & Olahraga', confidence: 92.0, status: '✅ Valid', isPreDetected: true }; }

    // ═══════════════════════════════════════════════════════════════
    // 24. PENDIDIKAN / KURSUS
    // ═══════════════════════════════════════════════════════════════
    const isPendidikan = (
        t.includes('spp') || t.includes('biaya pendidikan') || t.includes('biaya sekolah') ||
        t.includes('uang kuliah') || t.includes('ukt') || t.includes('herregistrasi') ||
        (t.includes('kursus') && (t.includes('bayar') || t.includes('total'))) ||
        (t.includes('les') && (t.includes('bayar') || t.includes('biaya') || t.includes('bulan'))) ||
        t.includes('bimbingan belajar') || t.includes('bimbel') ||
        t.includes('ruangguru') || t.includes('zenius') || t.includes('quipper') ||
        t.includes('coursera') || t.includes('udemy')
    );
    if (isPendidikan) { const nama = extractedToko() || 'Biaya Pendidikan'; return { toko: nama, kategori: 'Pendidikan', sub: 'Biaya Pendidikan', confidence: 93.0, status: '✅ Valid', isPreDetected: true }; }

    // ═══════════════════════════════════════════════════════════════
    // 25. STRUK PENARIKAN / SETOR ATM
    // ═══════════════════════════════════════════════════════════════
    const isATMWithdraw = (
        (t.includes('tarik tunai') || t.includes('penarikan') || t.includes('withdrawal')) &&
        (t.includes('atm') || t.includes('no. rekening') || t.includes('saldo'))
    );
    const isATMDeposit = (
        (t.includes('setor tunai') || t.includes('setoran') || t.includes('deposit')) &&
        (t.includes('atm') || t.includes('no. rekening'))
    );
    if (isATMWithdraw) return { toko: 'Tarik Tunai ATM', kategori: 'Tagihan', sub: 'Perbankan', confidence: 95.0, status: '✅ Valid', isPreDetected: true };
    if (isATMDeposit)  return { toko: 'Setor Tunai ATM', kategori: 'Tagihan', sub: 'Perbankan', confidence: 95.0, status: '✅ Valid', isPreDetected: true };

    // ═══════════════════════════════════════════════════════════════
    // 26. STRUK BELANJA MATERIAL / BANGUNAN
    // ═══════════════════════════════════════════════════════════════
    const isMaterial = (
        t.includes('ace hardware') || t.includes('mitra 10') || t.includes('depo bangunan') ||
        t.includes('kawan lama') || t.includes('informa') || t.includes('ikea') ||
        t.includes('courts furniture') ||
        (t.includes('material') && (t.includes('bangunan') || t.includes('total') || t.includes('besi') || t.includes('semen')))
    );
    if (t.includes('ace hardware'))    return { toko: 'ACE Hardware', kategori: 'Rumah Tangga', sub: 'Perkakas & Material', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('mitra 10'))        return { toko: 'Mitra 10', kategori: 'Rumah Tangga', sub: 'Material Bangunan', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('depo bangunan'))   return { toko: 'Depo Bangunan', kategori: 'Rumah Tangga', sub: 'Material Bangunan', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('ikea'))            return { toko: 'IKEA', kategori: 'Rumah Tangga', sub: 'Furnitur & Dekorasi', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('informa'))         return { toko: 'Informa', kategori: 'Rumah Tangga', sub: 'Furnitur & Dekorasi', confidence: 96.0, status: '✅ Valid', isPreDetected: true };
    if (isMaterial) { const nama = extractedToko() || 'Toko Material'; return { toko: nama, kategori: 'Rumah Tangga', sub: 'Material Bangunan', confidence: 90.0, status: '🔶 Review', isPreDetected: true }; }

    return null;
}

// ═══════════════════════════════════════════════════════════════
// PARSE RECEIPT TEXT — ekstrak toko + nominal + tanggal dari OCR
// ═══════════════════════════════════════════════════════════════
function parseReceiptText(rawText) {
    const nominal = extractNominal(rawText);
    const toko    = extractNamaToko(rawText) || 'Unknown';

    // Ekstrak tanggal — berbagai format Indonesia
    const tglPatterns = [
        /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,                    // DD/MM/YYYY
        /(\d{1,2})\s+(jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)\w*\s+(\d{4})/i, // DD Januari YYYY
        /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,                          // YYYY-MM-DD (ISO)
        /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/,                            // DD.MM.YYYY
    ];
    let tanggal = null;
    for (const pat of tglPatterns) {
        const m = rawText.match(pat);
        if (m) { tanggal = m[0]; break; }
    }

    return { toko, nominal, tanggal };
}

// ═══════════════════════════════════════════════════════════════
// DETEKSI APAKAH FOTO ADALAH STRUK
// ═══════════════════════════════════════════════════════════════
function isLikelyReceipt(rawText) {
    if (!rawText || rawText.trim().length < 20) return false;

    const receiptKeywords = [
        // Kata kunci umum struk belanja
        /total/i, /bayar/i, /tagihan/i, /rp\.?\s*[\d.,]+/i,
        /struk/i, /nota/i, /receipt/i, /invoice/i, /kuitansi/i,
        /qty/i, /pcs/i, /item/i, /harga/i, /subtotal/i,
        /kasir/i, /cashier/i, /terima kasih/i, /thank you/i,
        /no\.?\s*trx/i, /no\.?\s*faktur/i, /no\.?\s*order/i,
        /diskon/i, /discount/i, /ppn/i, /tax/i, /dpp/i,
        /tunai/i, /kembali/i, /kembalian/i,
        // Struk transfer/bank
        /transfer/i, /penerima/i, /rekening/i, /nominal/i,
        /bi-fast/i, /rtgs/i, /sumber dana/i,
        // Struk SPBU
        /liter/i, /pertamax/i, /pertalite/i, /solar/i, /spbu/i,
        // Struk e-wallet & tagihan
        /saldo/i, /token/i, /kwh/i, /id pelanggan/i,
        // Angka 4+ digit (bisa nominal)
        /[\d.,]{4,}/,
        // Struk online/delivery
        /order id/i, /pesanan/i, /pengiriman/i, /ongkos kirim/i,
    ];

    const matches = receiptKeywords.filter(pat => pat.test(rawText));
    // Lebih toleran: cukup 2 keyword (bisa struk simpel)
    return matches.length >= 2;
}

const MSG_BUKAN_STRUK =
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
    welcome: (nama, from) =>
        `👋 Halo *${nama}*! Selamat datang di *Finance Tracker Bot* 🤖\n\n` +
        `Catat semua transaksi kamu dengan mudah!\n\n` +
        `🌐 *Web Dashboard:* https://wa-finance-tracker-dashboard.vercel.app/?id=${from}\n\n` +
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
        `🌐  *11. Web Dashboard*\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `_Balas angka 1-11 atau ketik perintah_\n\n` +
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

    // ── BARU: Pesan khusus untuk transfer bank ────────────────────
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
        `🏪 Toko  : ${toko}\n` +
        `💰 Nominal: Rp ${parseInt(nominal).toLocaleString('id-ID')}\n\n` +
        `Ketik judul/keterangan singkat:\n` +
        `_Contoh: Makan siang, Bensin motor, Beli sabun_\n\n` +
        `_(ketik *skip* untuk pakai nama toko sebagai judul)_`,

    confirm: (d) => {
        let msg = `🔍 *Konfirmasi Transaksi*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `${d.tipe === 'masuk' ? '💰' : '💸'} *Tipe   :* ${d.tipe === 'masuk' ? 'Pemasukan' : 'Pengeluaran'}\n`;
        msg += `📌 *Judul  :* ${d.judul}\n`;
        // Untuk transfer, tampilkan "Penerima" bukan "Toko"
        if (d.isTransfer) {
            msg += `👤 *Penerima:* ${d.toko}\n`;
        } else {
            msg += `🏪 *Toko   :* ${d.toko}\n`;
        }
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
        if (d.isTransfer) {
            msg += `👤 ${d.toko}\n`;
        } else {
            msg += `🏪 ${d.toko}\n`;
        }
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
};

// ═══════════════════════════════════════════════════════════════
// PROSES FOTO
// ═══════════════════════════════════════════════════════════════
async function handlePhoto(msg, from, namaUser) {
    const media = await msg.downloadMedia().catch(() => null);
    if (!media || !media.mimetype.startsWith('image/')) return false;

    await msg.reply('🔍 *Membaca foto...*\n⏳ _(5-15 detik)_');

    try {
        const ocrText = await extractTextFromImage(media.data);

        if (!ocrText || ocrText.trim().length < 10) {
            resetState(from);
            await msg.reply(
                `❌ *Teks tidak terbaca.*\n\n` +
                `📋 *Tips:*\n` +
                `• Foto *lebih dekat* ke struk\n` +
                `• Pastikan *cahaya cukup terang*\n` +
                `• Jangan sampai *buram atau miring*\n\n` +
                `💡 Atau ketik manual: \`Nama Toko Nominal\`\n` +
                `Ketik *menu* untuk kembali.`
            );
            return true;
        }

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
                `• Pastikan area *TOTAL* terlihat jelas & tidak terpotong\n\n` +
                `💡 Atau ketik manual: \`${tokoRaw} [nominal]\``
            );
            return true;
        }

        const preDetected = preDetectReceiptType(ocrText);

        // ── FLOW KHUSUS TRANSFER BANK ─────────────────────────────
        if (preDetected?.isTransfer) {
            const toko = preDetected.namaPenerima || 'Penerima Tidak Diketahui';
            const ai = {
                kategori:   'Tagihan',
                sub:        'Transfer',
                confidence: preDetected.confidence,
                status:     preDetected.status,
                matched:    toko,
                method:     'PreDetect-Transfer',
            };
            setState(from, 'await_tujuan_transfer', {
                toko,
                nominal,
                ai,
                isTransfer:      true,
                bankPengirim:    preDetected.bankPengirim,
                namaPenerima:    preDetected.namaPenerima,
                catatan:         preDetected.catatanTransfer,
                sumber:          'Foto Bukti Transfer',
                tipe:            'keluar',
                namaUser,
            });
            await msg.reply(MSG.askTujuanTransfer(preDetected.namaPenerima, preDetected.bankPengirim, nominal));
            return true;
        }

        // ── FLOW NORMAL STRUK BELANJA ─────────────────────────────
        const toko = (preDetected?.toko) || tokoRaw;
        const ai = preDetected
            ? { kategori: preDetected.kategori, sub: preDetected.sub, confidence: preDetected.confidence, status: preDetected.status, matched: toko }
            : await getAIAnalysis(tokoRaw, tokoRaw);

        setState(from, 'await_judul', {
            toko, nominal, ai,
            sumber:  'Foto Struk',
            catatan: tanggal ? `Struk tgl ${tanggal}` : 'OCR Tesseract.js',
            tipe:    'keluar',
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
    puppeteer: {
        headless: true,
        timeout: 60000,   // 60 detik — toleran untuk koneksi lambat
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    },
});

let qrCount = 0;
client.on('qr', qr => {
    qrCount++;
    console.log(`\n📱 Scan QR Code (percobaan ke-${qrCount}):\n`);
    qrcode.generate(qr, { small: true });
    if (qrCount >= 3) {
        console.warn('⚠️  QR sudah di-refresh 3x dan tidak di-scan. Bot akan berhenti.');
        console.warn('   Jalankan ulang: node index.js');
        process.exit(0);
    }
});

client.on('auth_failure', errMsg => {
    console.error('❌ Auth gagal:', errMsg);
    console.error('   Hapus folder .wwebjs_auth lalu jalankan ulang.');
    process.exit(1);
});

client.on('disconnected', reason => {
    console.warn('⚠️ Bot terputus:', reason);
    console.warn('   Menghentikan proses. Jalankan ulang: node index.js');
    process.exit(0);
});

client.on('ready', async () => {
    qrCount = 0;
    console.log('✅ Finance Tracker Bot v6.2 Online!');
    scheduler.initScheduler(client, supabase, getLaporan);
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
    if (['menu','mulai','start'].includes(lower)) { setState(from,'menu',{}); return msg.reply(MSG.menu(from)); }
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
    if (['detail','lihat'].includes(lower)) {
        const rows = await getRecentWithId(from);
        setState(from, 'await_detail_pick', { rows });
        return msg.reply(MSG.detailList(rows));
    }
    if (['edit','hapus','ubah'].includes(lower)) {
        const rows = await getRecentWithId(from);
        setState(from, 'await_edit_select', { rows });
        return msg.reply(MSG.editList(rows));
    }
    if (lower === 'notif on' || lower === 'notif off') {
        const isEnable = lower === 'notif on';
        scheduler.toggleNotif(from, isEnable);
        if (isEnable) {
            return msg.reply(`🔔 *Notifikasi Otomatis DIAKTIFKAN*\n━━━━━━━━━━━━━━━━━\nKamu akan menerima:\n• Ringkasan Harian (Pukul 21:00)\n• Ringkasan Mingguan (Tiap Senin Pukul 07:00)\n• Laporan Bulanan (Tiap Tanggal 1 Pukul 08:00)`);
        } else {
            return msg.reply(`🔕 *Notifikasi Otomatis DIMATIKAN*`);
        }
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
        return msg.reply(newUser ? MSG.welcome(namaKontak, from) : MSG.menu(from));
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
        if (['9','edit','hapus','ubah'].includes(lower)) {
            const rows = await getRecentWithId(from);
            setState(from, 'await_edit_select', { rows });
            return msg.reply(MSG.editList(rows));
        }
        if (['10','notif','pengaturan notif','notifikasi'].includes(lower)) {
            const isEnable = scheduler.checkNotif(from);
            return msg.reply(
                `🔔 *Pengaturan Notifikasi*\n━━━━━━━━━━━━━━━━━\n` +
                `Status saat ini: *${isEnable ? 'AKTIF ✅' : 'NONAKTIF ❌'}*\n\n` +
                `Jika aktif, bot akan mengirim:\n` +
                `• Ringkasan Harian (21:00)\n` +
                `• Laporan Mingguan (Senin 07:00)\n` +
                `• Laporan Bulanan (Tgl 1 08:00)\n\n` +
                `_Ketik *notif on* untuk mengaktifkan._\n` +
                `_Ketik *notif off* untuk mematikan._\n\n` +
                `Ketik *menu* untuk kembali.`
            );
        }
        if (['11','dashboard','web'].includes(lower)) {
            return msg.reply(`🌐 *Web Dashboard Finance Tracker*\n━━━━━━━━━━━━━━━━━\n\nDashboard kamu sekarang online! Buka link berikut dari browser PC atau HP:\n\n👉 https://wa-finance-tracker-dashboard.vercel.app/?id=${from}\n\n_Nomor kamu akan terisi otomatis._`);
        }
        return msg.reply(`❓ Pilih 1-11.\n\n${MSG.menu(from)}`);
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
            return msg.reply(`📸 Kirim foto struk atau bukti transfer.\n💡 Bot otomatis deteksi tipe transaksi.\n\n_ketik *batal* untuk kembali_`);
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
        return msg.reply(`📸 Kirim foto struk atau bukti transfer, atau ketik *batal* untuk kembali.`);
    }

    // ── AWAIT DETAIL PICK ────────────────────────────────────
    if (cur.step === 'await_detail_pick') {
        const { rows } = cur.data;
        const idx = parseInt(lower) - 1;

        if (isNaN(idx) || idx < 0 || idx >= rows.length) {
            return msg.reply(
                `❓ Pilih nomor *1–${rows.length}*.\n` +
                `_Atau ketik *batal* untuk kembali._`
            );
        }

        const chosen = rows[idx];
        const detail = await getTransactionDetail(from, chosen.id);
        resetState(from);

        if (!detail) {
            return msg.reply(`❌ Transaksi tidak ditemukan atau sudah dihapus.\n\nKetik *menu* untuk kembali.`);
        }

        return msg.reply(MSG.detailTrx(detail));
    }

    // ── AWAIT EDIT SELECT ────────────────────────────────────
    if (cur.step === 'await_edit_select') {
        const { rows, intent } = cur.data;
        
        // 1. Cek format "hapus [angka]"
        const hapusMatch = lower.match(/^hapus\s+(\d+)$/);
        if (hapusMatch) {
            const idx = parseInt(hapusMatch[1]) - 1;
            if (idx >= 0 && idx < rows.length) {
                const chosen = rows[idx];
                setState(from, 'await_delete_confirm', { trx: chosen });
                return msg.reply(MSG.deleteConfirm(chosen));
            }
        }

        // 2. Jika user cuma ketik "hapus", set intent jadi delete
        if (lower === 'hapus') {
            setState(from, 'await_edit_select', { rows, intent: 'delete' });
            return msg.reply(`❓ Transaksi nomor berapa yang ingin dihapus? (1-${rows.length})\nKetik nomornya saja, contoh: \`1\`\nAtau ketik *batal* untuk kembali.`);
        }

        const idx = parseInt(lower) - 1;

        if (isNaN(idx) || idx < 0 || idx >= rows.length) {
            return msg.reply(
                `❓ Pilih nomor *1–${rows.length}* untuk ${intent === 'delete' ? 'dihapus' : 'diedit'}.\n` +
                `_Atau ketik *batal* untuk kembali._`
            );
        }

        const chosen = rows[idx];
        
        if (intent === 'delete') {
            setState(from, 'await_delete_confirm', { trx: chosen });
            return msg.reply(MSG.deleteConfirm(chosen));
        }

        setState(from, 'await_edit_action', { trx: chosen });
        return msg.reply(MSG.editMenu(chosen));
    }

    // ── AWAIT EDIT ACTION (PILIH FIELD / HAPUS) ──────────────
    if (cur.step === 'await_edit_action') {
        const { trx } = cur.data;

        if (lower.includes('hapus')) {
            setState(from, 'await_delete_confirm', { trx });
            return msg.reply(MSG.deleteConfirm(trx));
        }

        const fieldMap = { '1': 'judul', '2': 'nominal', '3': 'kategori', '4': 'catatan' };
        const fieldName = fieldMap[lower];

        if (!fieldName) {
            return msg.reply(`❓ Balas 1-4 untuk memilih apa yang diubah, atau ketik *hapus*.\nKetik *batal* untuk kembali.`);
        }

        setState(from, 'await_edit_value', { trx, field: fieldName });

        if (fieldName === 'kategori') {
            return msg.reply(
                `🏷️ *Pilih Kategori Baru*\n━━━━━━━━━━━━━━━━━\n` +
                `1. Makanan & Minuman\n2. Transportasi\n3. Kebutuhan Pokok\n` +
                `4. Kesehatan\n5. Hiburan\n6. Belanja Online\n7. Fashion\n` +
                `8. Tagihan\n9. Pendidikan\n10. Rumah Tangga\n11. Perjalanan\n12. Investasi\n13. Lain-lain\n\n` +
                `_Balas angka 1-13_`
            );
        }

        return msg.reply(`✏️ *Ubah ${fieldName.toUpperCase()}*\n\nNilai lama: *${trx[fieldName] || '-'}*\n\nKetik nilai baru:`);
    }

    // ── AWAIT EDIT VALUE ─────────────────────────────────────
    if (cur.step === 'await_edit_value') {
        const { trx, field } = cur.data;
        let newValue = text;

        if (field === 'nominal') {
            newValue = parseInt(text.replace(/\./g,'').replace(/,/g,'').replace(/[^0-9]/g,''));
            if (isNaN(newValue) || newValue <= 0) return msg.reply(`❌ Nominal tidak valid.\nContoh: \`75000\`\n\nCoba lagi:`);
        } else if (field === 'kategori') {
            const kategoriMap = {
                '1':'Makanan & Minuman','2':'Transportasi','3':'Kebutuhan Pokok',
                '4':'Kesehatan','5':'Hiburan','6':'Belanja Online','7':'Fashion',
                '8':'Tagihan','9':'Pendidikan','10':'Rumah Tangga','11':'Perjalanan',
                '12':'Investasi','13':'Lain-lain',
            };
            newValue = kategoriMap[lower] || text;
            if (!kategoriMap[lower] && newValue.length < 3) {
                return msg.reply(`❌ Kategori tidak valid. Balas angka 1-13.`);
            }
        }

        try {
            await updateTransaction(from, trx.id, field, newValue);
            resetState(from);
            return msg.reply(`✅ *Transaksi Diperbarui!*\n\n${field.toUpperCase()}: ${trx[field] || '-'} ➡️ *${newValue}*\n\nKetik *menu* untuk kembali.`);
        } catch (e) {
            return msg.reply(`❌ Gagal mengubah: ${e.message}`);
        }
    }

    // ── AWAIT DELETE CONFIRM ─────────────────────────────────
    if (cur.step === 'await_delete_confirm') {
        const { trx } = cur.data;
        if (lower === 'ya') {
            try {
                await deleteTransaction(from, trx.id);
                resetState(from);
                return msg.reply(`✅ *Transaksi Berhasil Dihapus*\n\n_${trx.judul || trx.nama_toko}_ (Rp ${parseInt(trx.nominal).toLocaleString('id-ID')}) telah dihapus secara permanen.\n\nKetik *menu* untuk kembali.`);
            } catch (e) {
                return msg.reply(`❌ Gagal menghapus: ${e.message}`);
            }
        }
        resetState(from);
        return msg.reply(MSG.cancelled());
    }

    // ── AWAIT TUJUAN TRANSFER (NEW!) ─────────────────────────
    if (cur.step === 'await_tujuan_transfer') {
        const d = cur.data;
        // "skip" → pakai nama penerima sebagai judul
        const judul = lower === 'skip'
            ? (d.namaPenerima || `Transfer ${d.bankPengirim}`)
            : text;

        if (!judul || judul.length < 1)
            return msg.reply(`Ketik tujuan transfer, atau *skip* untuk pakai nama penerima.`);

        const finalData = { ...d, judul };
        setState(from, 'confirm', finalData);
        return msg.reply(MSG.confirm(finalData));
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

// ═══════════════════════════════════════════════════════════════
// REALTIME LISTENER — untuk notifikasi authcode dashboard
// ═══════════════════════════════════════════════════════════════
function initRealtimeListener(client, supabase) {
    console.log('📡 Realtime listener diinisialisasi...');
    
    const channel = supabase
        .channel('public:user_profiles')
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'user_profiles',
            },
            async (payload) => {
                const { old: oldRow, new: newRow } = payload;
                
                // Jika authcode baru muncul atau berubah
                if (newRow.authcode && newRow.authcode !== oldRow.authcode) {
                    console.log(`🔑 Authcode baru untuk ${newRow.wa_number}: ${newRow.authcode}`);
                    
                    const msg = `🔐 *Kode Autentikasi Dashboard*\n━━━━━━━━━━━━━━━━━\n` +
                                `Kode Anda adalah: *${newRow.authcode}*\n\n` +
                                `_Berlaku untuk 5 menit. Jangan berikan kode ini kepada siapapun._`;
                    
                    try {
                        await client.sendMessage(newRow.wa_number, msg);
                        console.log(`✅ Authcode terkirim ke ${newRow.wa_number}`);
                    } catch (err) {
                        console.error(`❌ Gagal kirim authcode ke ${newRow.wa_number}:`, err.message);
                    }
                }
            }
        )
        .subscribe();

    return channel;
}

client.on('ready', () => {
    console.log('🚀 Client is ready!');
    initRealtimeListener(client, supabase);
});

client.initialize().catch(err => {
    console.error('❌ Gagal menginisialisasi bot:', err.message);
    console.error('   Kemungkinan penyebab:');
    console.error('   1. Tidak ada koneksi internet / tidak bisa akses web.whatsapp.com');
    console.error('   2. QR timeout karena tidak di-scan');
    console.error('   3. Sesi lama corrupt — hapus folder .wwebjs_auth dan coba lagi');
    process.exit(1);
});