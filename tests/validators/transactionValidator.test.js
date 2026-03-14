const TransactionValidator = require('../../src/validators/transactionValidator');
const ValidationError = require('../../src/errors/ValidationError');

describe('Transaction Validator', () => {
    test('validateManualInput should parse valid input', () => {
        const result = TransactionValidator.validateManualInput('Mie Ayam 15000');
        expect(result.toko).toBe('Mie Ayam');
        expect(result.nominal).toBe(15000);
    });

    test('validateManualInput should throw for empty input', () => {
        expect(() => TransactionValidator.validateManualInput('')).toThrow(ValidationError);
    });

    test('validateManualInput should throw for invalid format', () => {
        expect(() => TransactionValidator.validateManualInput('Sesuatu Tanpa Angka')).toThrow(ValidationError);
    });
});
