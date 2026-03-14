const { isLikelyReceipt, parseReceiptText } = require('../../src/utils/receiptParser');

describe('Receipt Parser Utility', () => {
    test('isLikelyReceipt should return true for valid receipt text', () => {
        const text = 'TOTAL Harga Rp 50.000\nIndomaret Cabang Baru\nTerima Kasih';
        expect(isLikelyReceipt(text)).toBe(true);
    });

    test('isLikelyReceipt should return false for conversational text', () => {
        const text = 'Halo apa kabar bos?';
        expect(isLikelyReceipt(text)).toBe(false);
    });

    test('parseReceiptText should extract nominal and toko correctly', () => {
        const text = 'Indomaret\nTOTAL Rp. 15.500\nTanggal: 14/03/2026';
        const result = parseReceiptText(text);
        expect(result.toko).toContain('Indomaret');
        expect(result.nominal).toBe(15500);
    });
});
