/**
 * Receipt Parser using heuristics for Indonesian receipts
 */

const { extractTransferDetail } = require('./transferParser');

/**
 * Extract Shop Name from raw text
 * @param {string} rawText 
 * @returns {string|null}
 */
function extractNamaToko(rawText) {
    // ═══════════════════════════════════════════════
    // PRE-DETECTION: E-Commerce platforms
    // ═══════════════════════════════════════════════
    const t = rawText.toLowerCase();
    
    // Shopee
    if (t.includes('shopee') || t.includes('shopee mall') || 
        t.includes('voucher shopee') || t.includes('biaya layanan') && t.includes('subtotal produk')) {
        const tokoMatch = rawText.match(/(?:Toko|Store|Seller)[:\s]+([^\n]{3,40})/i) ||
                          rawText.match(/(?:Mall\s*\|?\s*ORI|Official Store)\s*\n?\s*([^\n]{3,40})/i) ||
                          rawText.match(/([A-Za-z0-9\s]{3,30}(?:Official Store|Store|Shop))/i);
        if (tokoMatch) return tokoMatch[1].trim();
        return 'Shopee';
    }
    if (t.includes('tokopedia') || t.includes('toped')) return 'Tokopedia';
    if (t.includes('lazada')) return 'Lazada';
    if (t.includes('tiktok') || t.includes('tik tok shop')) return 'TikTok Shop';
    if (t.includes('blibli')) return 'Blibli';

    // ═══════════════════════════════════════════════
    // FILTER STATUS BAR HP & NAVIGATION
    // ═══════════════════════════════════════════════
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean).filter(l => {
        if (/^\d{1,2}[.:]\d{2}/.test(l)) return false; // Jam
        if (/^[\d.:]+ ?[🔋📶🛜]/.test(l)) return false; // Icons
        if (/^(safari|chrome|firefox|edge|browser)$/i.test(l)) return false; 
        if (/^[‹›←→<>]\s*(safari|back|kembali)$/i.test(l)) return false;
        if (/^[\d.:\s«»‹›←→<>]{1,8}$/.test(l)) return false;
        return true;
    });

    const blacklistPatterns = [
        /^\d+$/, /^https?/i, /[.]{3,}/, /^\*+$/, /^[-=_]+$/,
        /^(total|subtotal|grand total|jumlah|bayar|tunai|kembali|kembalian|diskon|ppn|pajak|tax|dpp|service charge)/i,
        /^(rincian|pesanan|order|invoice|tagihan)/i,
        /^(no\.?\s*(struk|faktur|invoice|order|trx|ref|nota|bon|kasir|tanda terima))/i,
        /^(tanggal|tgl|date|waktu|time|jam|kasir|operator|cashier|served by)/i,
        /^(qty|pcs|satuan|unit|harga|price|jml|jumlah)/i,
        /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
        /^\d{13,}$/,
        /^(terima kasih|thank you|selamat datang|welcome|terimakasih)/i,
        /^(jl\.|jalan|rt\/rw|no\.\s*\d+|kel\.|kec\.|kota|kab\.)/i,
        /^(telp|tel|phone|fax|www\.|@)/i,
        /^(struk|nota|invoice|kwitansi|receipt|bon|faktur)/i,
        /^\?\(?\+?62[\d\s\-]+$/,
        /^0\d{8,}$/,
        /^\d{1,2}[.:]\d{2}(\s|$)/,
        /^(live|tonton|sekarang|sedang)/i,
        /pengguna sedang/i,
        /^(batalkan|hubungi|penjual|pusat bantuan)/i,
        /^(back|kembali|lanjut|next|prev)/i,
        /^butuh bantuan/i,
        /^(ready stock|voucher|promo|diskon)/i,
        /\[TOP \d+\]/i,
        /rp[\d.,]+/i,
    ];

    const isBlacklisted = (line) => blacklistPatterns.some(p => p.test(line));

    const candidates = lines.slice(0, 15).filter(l =>
        l.length >= 3 && l.length <= 60 &&
        /[a-zA-Z]/.test(l) &&
        !isBlacklisted(l)
    );

    if (candidates.length === 0) return null;

    let namaToko = candidates[0];
    if (candidates[1] && candidates[1].length <= 40 &&
        !candidates[1].match(/\d{5,}/) && candidates.indexOf(candidates[1]) <= 3) {
        const isBranchLine = /\b(cab\.|cabang|branch|outlet|store|toko|warung|resto|cafe|kafe)\b/i.test(candidates[1]);
        if (isBranchLine || candidates[1].length <= 25) {
            namaToko = `${candidates[0]} ${candidates[1]}`.trim().substring(0, 60);
        }
    }

    return namaToko.replace(/\s+/g, ' ').trim();
}

/**
 * Extract Nominal from raw text
 * @param {string} rawText 
 * @returns {number}
 */
function extractNominal(rawText) {
    // ═══════════════════════════════════════════════════════════
    // PRIORITAS 0: E-COMMERCE TOTAL PATTERNS
    // ═══════════════════════════════════════════════════════════
    const ecommercePatterns = [
        /total\s*pesanan\s*[:\s]*rp\.?\s*([\d.,]+)/i,
        /total\s*pembayaran\s*[:\s]*rp\.?\s*([\d.,]+)/i,
        /total\s*harga\s*[:\s]*rp\.?\s*([\d.,]+)/i,
        /total\s*belanja\s*[:\s]*rp\.?\s*([\d.,]+)/i,
        /(?:harga yang harus|yang harus) dibayar\s*[:\s]*rp\.?\s*([\d.,]+)/i,
        /grand\s*total\s*[:\s]*rp\.?\s*([\d.,]+)/i,
    ];

    for (const pat of ecommercePatterns) {
        const m = rawText.match(pat);
        if (m && m[1]) {
            const val = parseInt(m[1].replace(/\./g, '').replace(/,/g, ''));
            if (val >= 1000 && val <= 500_000_000) return val;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CLEANING: Harga Coret & Diskon
    // ═══════════════════════════════════════════════════════════
    const cleanedText = rawText
        .replace(/rp\.?\s*[\d.,]+\s*rp\.?\s*([\d.,]+)/gi, 'Rp$1')
        .replace(/[-]\s*rp\.?\s*[\d.,]+/gi, '');

    const totalPatterns = [
        /(?:total\s*(?:harga|bayar|tagihan|pembayaran|pembelian|penjualan|transaksi)?)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        /(?:grand\s*total|total\s*belanja)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        /^total\s*rp\.?\s*([\d.,]+)/im,
        /(?:total\s*(?:tagihan|bill)|tagihan\s*total)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        /(?:nominal|jumlah\s*(?:transfer|pengiriman|transaksi)?)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        /(?:tunai|cash(?:\s*payment)?)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        /^rp\.?\s*([\d.,]{4,})\s*$/im,
        /(?:jumlah\s*bayar|total\s*dibayar|dibayar)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        /rp\.?\s*([\d.,]{4,})/i,
        /(?:subtotal|sub\s*total)\s*[:\-]?\s*rp\.?\s*([\d.,]+)/i,
        /total[^\d]*([\d.,]{4,})/i,
    ];

    const lines = cleanedText.split('\n').map(l => l.trim()).filter(Boolean);
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

    const bottomLines = lines.slice(Math.floor(lines.length * 0.5));
    const bottomNums = [...bottomLines.join('\n').matchAll(/\b(\d[\d.,]{2,})\b/g)]
        .map(m => parseInt(m[1].replace(/[.,]/g, '')))
        .filter(n => !isNaN(n) && n >= 1000 && n <= 500_000_000);

    if (bottomNums.length > 0) {
        // E-commerce tendency: last number is usually the final bill
        return bottomNums[bottomNums.length - 1];
    }

    const allNums = [...cleanedText.matchAll(/\b(\d[\d.,]{2,})\b/g)]
        .map(m => parseInt(m[1].replace(/[.,]/g, '')))
        .filter(n => !isNaN(n) && n >= 1000 && n <= 500_000_000);
    
    return allNums.length > 0 ? Math.max(...allNums) : 0;
}

/**
 * Pre-detect receipt type based on keywords
 * @param {string} rawText 
 * @returns {Object|null}
 */
function preDetectReceiptType(rawText) {
    if (!rawText) return null;
    const t = rawText.toLowerCase();

    // ═══════════════════════════════════════════════════════════════
    // PRIORITAS 0: DETEKSI STRUK E-COMMERCE SCREENSHOT
    // ═══════════════════════════════════════════════════════════════
    const isShopee = t.includes('shopee') || t.includes('voucher shopee') || t.includes('shopee mall') ||
        (t.includes('subtotal produk') && t.includes('biaya layanan')) ||
        (t.includes('proteksi produk') && t.includes('total pesanan')) ||
        (t.includes('voucher toko digunakan') && t.includes('total pesanan')) ||
        (t.includes('subtotal diskon pengiriman') && t.includes('subtotal pengiriman'));

    if (isShopee) {
        const tokoMatch = rawText.match(/(?:Toko|Store)\s*[:\|]\s*([^\n]{3,35})/i) ||
                          rawText.match(/([A-Za-z0-9\s]{5,30}\s*(?:Official Store|Store|Shop|Mall))/i);
        return {
            toko: tokoMatch ? tokoMatch[1].trim() : 'Shopee',
            kategori: 'Belanja Online', sub: 'E-Commerce', confidence: 97.0, status: '✅ Valid', isPreDetected: true, isEcommerce: true
        };
    }

    if (t.includes('tokopedia') || t.includes('tokped') || (t.includes('total pembayaran') && t.includes('bebas ongkir'))) {
        return { toko: 'Tokopedia', kategori: 'Belanja Online', sub: 'E-Commerce', confidence: 97.0, status: '✅ Valid', isPreDetected: true, isEcommerce: true };
    }
    if (t.includes('lazada') || t.includes('lazcoins') || t.includes('laz voucher')) {
        return { toko: 'Lazada', kategori: 'Belanja Online', sub: 'E-Commerce', confidence: 97.0, status: '✅ Valid', isPreDetected: true, isEcommerce: true };
    }
    if (t.includes('tiktok shop') || t.includes('tiktokshop') || (t.includes('tiktok') && (t.includes('pesanan') || t.includes('order')))) {
        return { toko: 'TikTok Shop', kategori: 'Belanja Online', sub: 'E-Commerce', confidence: 97.0, status: '✅ Valid', isPreDetected: true, isEcommerce: true };
    }
    if (t.includes('blibli')) return { toko: 'Blibli', kategori: 'Belanja Online', sub: 'E-Commerce', confidence: 97.0, status: '✅ Valid', isPreDetected: true, isEcommerce: true };
    if (t.includes('bukalapak') || t.includes('bukabantuan')) return { toko: 'Bukalapak', kategori: 'Belanja Online', sub: 'E-Commerce', confidence: 97.0, status: '✅ Valid', isPreDetected: true, isEcommerce: true };

    // 1. BANK TRANSFER
    const isBCATransfer = (t.includes('biz id') || t.includes('bizid') || (t.includes('bi-fast') || t.includes('bifast')) || (t.includes('m-transfer') && t.includes('berhasil')) || (t.includes('transfer berhasil') && t.includes('bca')) || (t.includes('sumber dana') && t.includes('penerima')) || (t.includes('klikbca') && t.includes('transfer')) || (t.includes('mybca') && t.includes('transfer')) || (t.includes('detail transfer') && t.includes('nominal')) || (t.includes('metode transfer') && (t.includes('bi-fast') || t.includes('rtgs') || t.includes('online'))));
    const isBRITransfer = ((t.includes('brimo') && t.includes('transfer')) || (t.includes('bri') && t.includes('transfer berhasil')) || (t.includes('no. referensi') && t.includes('bri')) || (t.includes('rekening tujuan') && t.includes('bri')) || (t.includes('bri') && t.includes('pengiriman berhasil')));
    const isMandiriTransfer = ((t.includes('livin') && t.includes('transfer')) || (t.includes('mandiri') && t.includes('transfer berhasil')) || (t.includes('mandiri') && t.includes('rekening tujuan')) || (t.includes('no. transaksi') && t.includes('mandiri')) || (t.includes('mandiri online') && t.includes('transfer')));
    const isBNITransfer = ((t.includes('bni') && t.includes('transfer berhasil')) || (t.includes('bni mobile') && t.includes('transfer')) || /bni-\d+/.test(t) || (t.includes('bni') && t.includes('rekening tujuan')));
    const isBSITransfer = ((t.includes('bsi') && t.includes('transfer')) || (t.includes('bank syariah indonesia') && t.includes('transfer')) || (t.includes('hasanah') && t.includes('transfer')));
    const isJenius = ((t.includes('jenius') && t.includes('kirim')) || (t.includes('jenius') && t.includes('send')));
    const isSeaBankTransfer = ((t.includes('seabank') || t.includes('sea bank')) && t.includes('transfer'));
    const isJagoTransfer = ((t.includes('bank jago') || t.includes('jago')) && (t.includes('kirim uang') || t.includes('transfer')));
    const isOVOTransfer = (t.includes('ovo') && (t.includes('kirim') || t.includes('transfer')));
    const isGopayTransfer = (t.includes('gopay') && t.includes('kirim'));
    const isDANATransfer = (t.includes('dana') && (t.includes('kirim') || t.includes('transfer')));
    const isGenericTransfer = ((t.includes('transfer berhasil') || t.includes('pengiriman berhasil') || t.includes('transaksi berhasil') && t.includes('rekening')) || (t.includes('rekening tujuan') && (t.includes('nominal') || t.includes('jumlah'))) || (t.includes('penerima') && t.includes('sumber dana')) || (t.includes('no. rekening') && t.includes('transfer')) || (t.includes('tujuan transaksi') && t.includes('nominal')) || (t.includes('biaya transaksi') && t.includes('nominal') && t.includes('penerima')) || (t.includes('no. ref') && t.includes('penerima') && t.includes('nominal')));

    if (isBCATransfer || isBRITransfer || isMandiriTransfer || isBNITransfer || isBSITransfer || isJenius || isSeaBankTransfer || isJagoTransfer || isOVOTransfer || isGopayTransfer || isDANATransfer || isGenericTransfer) {
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

    // 2. UTILITY BILLS
    if (t.includes('pln') && (t.includes('token') || t.includes('stroom') || t.includes('kwh') || t.includes('no. meter') || t.includes('nomor meter') || t.includes('id pelanggan'))) {
        const dayaMatch = rawText.match(/(\d+)\s*(?:va|watt|kwh)/i);
        const daya = dayaMatch ? ` ${dayaMatch[1]}VA` : '';
        return { toko: `PLN Token Listrik${daya}`, kategori: 'Tagihan', sub: 'Listrik', confidence: 98.0, status: '✅ Valid', isPreDetected: true };
    }
    if (t.includes('pln') && (t.includes('listrik pascabayar') || t.includes('tagihan listrik') || t.includes('rekening listrik') || t.includes('lembar tagihan')))
        return { toko: 'PLN Pascabayar', kategori: 'Tagihan', sub: 'Listrik', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    
    if (t.includes('pdam') || (t.includes('tagihan air') && t.includes('pelanggan'))) {
        const pdamMatch = rawText.match(/pdam\s+(?:tirta\s+)?([a-z\s]+?)(?:\n|$)/i);
        const pdamNama = pdamMatch ? `PDAM ${pdamMatch[1].trim().substring(0, 20)}` : 'PDAM';
        return { toko: pdamNama, kategori: 'Tagihan', sub: 'Air', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }

    if (t.includes('indomaret')) return { toko: `Indomaret`, kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    if (t.includes('alfamart')) return { toko: `Alfamart`, kategori: 'Kebutuhan Pokok', sub: 'Minimarket', confidence: 97.0, status: '✅ Valid', isPreDetected: true };

    // 3. SPBU
    const bbmJenis = ['pertamax', 'pertalite', 'solar', 'biosolar', 'dexlite', 'pertadex', 'premium', 'pertamina dex'];
    if ((t.includes('pertamina') || t.includes('spbu') || t.includes('shell') || t.includes('vivo') || t.includes('bp station') || t.includes('total oil')) && (t.includes('liter') || t.includes('lt') || bbmJenis.some(j => t.includes(j)))) {
        let nama = 'SPBU';
        if (t.includes('shell')) nama = 'Shell';
        else if (t.includes('vivo')) nama = 'Vivo';
        else if (t.includes('pertamina')) nama = 'Pertamina';
        return { toko: nama, kategori: 'Transportasi', sub: 'BBM', confidence: 97.0, status: '✅ Valid', isPreDetected: true };
    }

    return null;
}

/**
 * Parse receipt text into structured data
 * @param {string} rawText 
 * @returns {Object}
 */
function parseReceiptText(rawText) {
    const nominal = extractNominal(rawText);
    const toko = extractNamaToko(rawText) || 'Unknown';

    const tglPatterns = [
        /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
        /(\d{1,2})\s+(jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)\w*\s+(\d{4})/i,
        /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
        /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/,
    ];
    let tanggal = null;
    for (const pat of tglPatterns) {
        const m = rawText.match(pat);
        if (m) { tanggal = m[0]; break; }
    }

    return { toko, nominal, tanggal };
}

/**
 * Check if text is likely from a receipt
 * @param {string} rawText 
 * @returns {boolean}
 */
function isLikelyReceipt(rawText) {
    if (!rawText || rawText.trim().length < 20) return false;

    const receiptKeywords = [
        /total/i, /bayar/i, /tagihan/i, /rp\.?\s*[\d.,]+/i,
        /struk/i, /nota/i, /receipt/i, /invoice/i, /kuitansi/i,
        /qty/i, /pcs/i, /item/i, /harga/i, /subtotal/i,
        /kasir/i, /cashier/i, /terima kasih/i, /thank you/i,
        /no\.?\s*trx/i, /no\.?\s*faktur/i, /no\.?\s*order/i,
        /diskon/i, /discount/i, /ppn/i, /tax/i, /dpp/i,
        /tunai/i, /kembali/i, /kembalian/i,
        /transfer/i, /penerima/i, /rekening/i, /nominal/i,
        /bi-fast/i, /rtgs/i, /sumber dana/i,
        /liter/i, /pertamax/i, /pertalite/i, /solar/i, /spbu/i,
        /saldo/i, /token/i, /kwh/i, /id pelanggan/i,
        /[\d.,]{4,}/,
        /order id/i, /pesanan/i, /pengiriman/i, /ongkos kirim/i,
        // E-Commerce
        /total\s*pesanan/i, /total\s*pembayaran/i, /subtotal\s*produk/i,
        /voucher\s*shopee/i, /biaya\s*layanan/i, /proteksi\s*produk/i,
        /bebas\s*ongkir/i, /rincian\s*pesanan/i, /diskon\s*pengiriman/i,
        /voucher\s*toko/i,
    ];

    const matches = receiptKeywords.filter(pat => pat.test(rawText));
    return matches.length >= 2;
}

module.exports = {
    extractNamaToko,
    extractNominal,
    preDetectReceiptType,
    parseReceiptText,
    isLikelyReceipt
};
