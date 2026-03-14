const transactionParser = require('../../src/utils/transactionParser');

describe('Transaction Parser Utility', () => {
    test('should parse simple format: kopi 20000', () => {
        const result = transactionParser.parse('kopi 20000');
        expect(result.deskripsi.toLowerCase()).toBe('kopi');
        expect(result.nominal).toBe(20000);
        expect(result.tipe).toBe('keluar');
    });

    test('should parse format with k suffix: kopi 20k', () => {
        const result = transactionParser.parse('kopi 20k');
        expect(result.nominal).toBe(20000);
    });

    test('should parse format with rb suffix: bensin 50rb', () => {
        const result = transactionParser.parse('bensin 50rb');
        expect(result.nominal).toBe(50000);
    });

    test('should parse format with dots and Rp: Rp 20.000', () => {
        const result = transactionParser.parse('beli nasi goreng Rp 20.000');
        expect(result.deskripsi.toLowerCase()).toBe('nasi goreng');
        expect(result.nominal).toBe(20000);
    });

    test('should detect transaction type: gaji 5jt', () => {
        const result = transactionParser.parse('gaji 5jt');
        expect(result.nominal).toBe(5000000);
        expect(result.tipe).toBe('masuk');
    });

    test('should parse 10jt bonus', () => {
        const result = transactionParser.parse('bonus 10jt');
        expect(result.nominal).toBe(10000000);
        expect(result.tipe).toBe('masuk');
    });

    test('should parse 20ribu correctly', () => {
        const result = transactionParser.parse('kopi 20ribu');
        expect(result.nominal).toBe(20000);
    });

    test('should parse float 1.5jt correctly', () => {
        const result = transactionParser.parse('belanja 1.5jt');
        expect(result.nominal).toBe(1500000);
    });

    test('should parse 2m and 2mio correctly', () => {
        expect(transactionParser.parse('gaji 2m').nominal).toBe(2000000);
        expect(transactionParser.parse('bonus 2mio').nominal).toBe(2000000);
    });

    test('should handle "bayar" and "beli" prefixes', () => {
        const result = transactionParser.parse('bayar netflix 54k');
        expect(result.deskripsi.toLowerCase()).toBe('netflix');
        expect(result.nominal).toBe(54000);
    });

    test('should handle complex names: makan ayam geprek 15000', () => {
        const result = transactionParser.parse('makan ayam geprek 15000');
        expect(result.deskripsi).toBe('makan ayam geprek');
        expect(result.nominal).toBe(15000);
    });
});
