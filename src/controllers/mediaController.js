const MSG = require('../constants/messages');
const { setState, resetState } = require('../utils/stateManager');
const ReceiptValidator = require('../validators/receiptValidator');
const { parseReceiptText, isLikelyReceipt, preDetectReceiptType } = require('../utils/receiptParser');
const ValidationError = require('../errors/ValidationError');

class MediaController {
    constructor(services, logger) {
        this.ocrService = services.ocr;
        this.aiService = services.ai;
        this.splitBillService = services.splitBill;
        this.logger = logger;
    }

    async handlePhoto(msg, from, namaUser) {
        const media = await msg.downloadMedia().catch(() => null);
        if (!media || !media.mimetype.startsWith('image/')) {
            this.logger.warn({ from }, 'Received invalid media type');
            return false;
        }

        this.logger.info({ from }, 'Processing incoming photo...');
        
        // ── SPLIT BILL DETECTION ──
        const caption = msg.body?.toLowerCase() || '';
        if (caption.includes('split') || caption.includes('patungan') || caption.includes('bagi')) {
            await msg.reply('🧮 *Menghitung Split Bill...*\n⏳ _(5-15 detik, AI sedang membaca menu & pajak)_');
            try {
                const b64Data = `data:${media.mimetype};base64,${media.data}`;
                const resultMsg = await this.splitBillService.splitBill(b64Data, media.mimetype, caption, from);
                return await msg.reply(resultMsg);
            } catch (err) {
                this.logger.error({ error: err.message }, 'Split Bill error');
                return await msg.reply('❌ Gagal membaca struk untuk split bill. Pastikan foto struk jelas dan tegak lurus.');
            }
        }

        // ── REGULAR RECEIPT OCR ──
        await msg.reply('🔍 *Membaca foto...*\n⏳ _(5-15 detik)_');

        try {
            const ocrText = await this.ocrService.extractText(media.data, media.mimetype);
            this.logger.debug({ from, textLength: ocrText?.length }, 'OCR complete');

            ReceiptValidator.validateOCRResult(ocrText);

            if (!isLikelyReceipt(ocrText)) {
                this.logger.info({ from }, 'OCR text not recognized as receipt');
                resetState(from);
                return await msg.reply(MSG.MSG_BUKAN_STRUK);
            }

            const { toko: tokoRaw, nominal, tanggal } = parseReceiptText(ocrText);
            this.logger.info({ from, tokoRaw, nominal }, 'Heuristic parsing complete');

            // Optional: ReceiptValidator.validateParsing(tokoRaw, nominal);
            // If we want to be strict, we'd throw here. But current bot allows some failure.
            if (nominal === 0) {
                this.logger.info({ from, tokoRaw }, 'Nominal not detected in receipt');
                resetState(from);
                return await msg.reply(`⚠️ *Nominal tidak terdeteksi.* Toko: _${tokoRaw}_`);
            }

            const preDetected = preDetectReceiptType(ocrText);

            if (preDetected?.isTransfer) {
                this.logger.info({ from, donor: preDetected.bankPengirim }, 'Pre-detected Bank Transfer');
                const toko = preDetected.namaPenerima || 'Penerima Tidak Diketahui';
                const ai = {
                    kategori: 'Tagihan',
                    sub: 'Transfer',
                    confidence: preDetected.confidence,
                    status: preDetected.status,
                    matched: toko,
                    method: 'PreDetect-Transfer',
                };
                setState(from, 'await_tujuan_transfer', {
                    toko, nominal, ai, isTransfer: true,
                    bankPengirim: preDetected.bankPengirim,
                    namaPenerima: preDetected.namaPenerima,
                    catatan: preDetected.catatanTransfer,
                    sumber: 'Foto Bukti Transfer', tipe: 'keluar', namaUser
                });
                return await msg.reply(MSG.askTujuanTransfer(preDetected.namaPenerima, preDetected.bankPengirim, nominal));
            }

            if (preDetected?.isEcommerce || preDetected?.kategori === 'Belanja Online') {
                this.logger.info({ from, platform: preDetected.toko }, 'Pre-detected E-Commerce');
                const toko = preDetected.toko || tokoRaw;
                const ai = {
                    kategori: 'Belanja Online',
                    sub: 'E-Commerce',
                    confidence: preDetected.confidence,
                    status: preDetected.status,
                    matched: toko,
                    method: 'PreDetect-Ecommerce',
                };
                
                setState(from, 'await_judul', {
                    toko, nominal, ai, sumber: 'Screenshot E-Commerce',
                    catatan: `Order ${toko}`,
                    tipe: 'keluar', namaUser
                });
                return await msg.reply(MSG.askJudul(toko, nominal));
            }

            this.logger.info({ from, toko: preDetected?.toko || tokoRaw }, 'Analyzing with AI');
            const toko = (preDetected?.toko) || tokoRaw;
            const ai = preDetected
                ? { kategori: preDetected.kategori, sub: preDetected.sub, confidence: preDetected.confidence, status: preDetected.status, matched: toko }
                : await this.aiService.getAnalysis(tokoRaw, tokoRaw);

            setState(from, 'await_judul', {
                toko, nominal, ai, sumber: 'Foto Struk',
                catatan: tanggal ? `Struk tgl ${tanggal}` : 'OCR Tesseract.js',
                tipe: 'keluar', namaUser
            });
            return await msg.reply(MSG.askJudul(toko, nominal));

        } catch (err) {
            if (err instanceof ValidationError) {
                resetState(from);
                return await msg.reply(`❌ ${err.message}`);
            }
            this.logger.error({ from, error: err.message }, 'Critical error in handlePhoto');
            resetState(from);
            return await msg.reply(`❌ Gagal proses foto: ${err.message}`);
        }
    }
}

module.exports = MediaController;
