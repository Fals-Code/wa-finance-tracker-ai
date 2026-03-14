/**
 * Parser for Bank Transfer Receipts
 */

/**
 * Extract transfer details from raw text
 * @param {string} rawText 
 * @returns {Object}
 */
function extractTransferDetail(rawText) {
    const detail = {
        namaPenerima: '',
        bankTujuan: '',
        noRekening: '',
        bankPengirim: '',
    };

    const t = rawText.toLowerCase();

    // Detect sender bank
    if (t.includes('bca')) detail.bankPengirim = 'BCA';
    else if (t.includes('brimo') || t.includes('bri')) detail.bankPengirim = 'BRI';
    else if (t.includes('mandiri') || t.includes('livin')) detail.bankPengirim = 'Mandiri';
    else if (t.includes('bni')) detail.bankPengirim = 'BNI';
    else if (t.includes('bsi') || t.includes('bank syariah')) detail.bankPengirim = 'BSI';
    else if (t.includes('cimb') || t.includes('ocbc')) detail.bankPengirim = 'CIMB';
    else if (t.includes('danamon')) detail.bankPengirim = 'Danamon';
    else if (t.includes('permata')) detail.bankPengirim = 'Permata';
    else if (t.includes('btn')) detail.bankPengirim = 'BTN';
    else if (t.includes('jago')) detail.bankPengirim = 'Bank Jago';
    else if (t.includes('seabank')) detail.bankPengirim = 'SeaBank';
    else detail.bankPengirim = 'Bank';

    // Extract recipient name
    const penerimaPatterns = [
        /penerima\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$|(?=\s{2,}))/im,
        /nama\s+penerima\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$)/im,
        /(?:ke|kepada)\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$)/im,
        /beneficiary\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$)/im,
        /rekening\s+tujuan[\s\S]{0,60}?nama\s*[:\-]\s*([A-Z][A-Z\s]{2,40}?)(?:\n|$)/im,
        /\d{10,16}\s*\n\s*([A-Z][A-Z\s]{3,35})\s*\n/m,
    ];

    for (const pat of penerimaPatterns) {
        const m = rawText.match(pat);
        if (m && m[1]) {
            const nama = m[1].trim().replace(/\s+/g, ' ');
            const blacklist = ['BANK', 'TRANSFER', 'REKENING', 'NOMINAL', 'TANGGAL', 'METODE', 'STATUS', 'BIAYA'];
            if (nama.length >= 3 && !blacklist.some(b => nama.toUpperCase().startsWith(b))) {
                detail.namaPenerima = nama;
                break;
            }
        }
    }

    // Extract destination bank
    const bankTujuanPatterns = [
        /bank\s+tujuan\s*[:\-]\s*([A-Z][A-Z\s]{2,25}?)(?:\n|$)/im,
        /(?:ke\s+bank|tujuan\s+bank)\s*[:\-]\s*([A-Z][A-Z\s]{2,25}?)(?:\n|$)/im,
        /\b(BCA|BRI|BNI|MANDIRI|BSI|CIMB|DANAMON|PERMATA|BTN|JAGO|SEABANK|OVO|GOPAY|DANA)\b/i,
    ];
    for (const pat of bankTujuanPatterns) {
        const m = rawText.match(pat);
        if (m && m[1]) { detail.bankTujuan = m[1].trim(); break; }
    }

    // Extract account number
    const noRekPat = /(?:no\.?\s*rek(?:ening)?|account\s*(?:no|number))\s*[:\-]?\s*(\d[\d\s\-]{8,19}\d)/im;
    const noRekM = rawText.match(noRekPat);
    if (noRekM) detail.noRekening = noRekM[1].replace(/\s+/g, '').trim();

    return detail;
}

module.exports = {
    extractTransferDetail
};
