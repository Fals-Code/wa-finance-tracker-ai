const ValidationError = require('../errors/ValidationError');

class ReceiptValidator {
    static validateOCRResult(text) {
        if (!text || text.trim().length < 10) {
            throw new ValidationError('Foto tidak terbaca atau terlalu buram.');
        }
    }

    static validateParsing(toko, nominal) {
        if (!toko || toko === 'Toko Tidak Dikenal') {
            throw new ValidationError('Gagal mengenali nama toko dari struk.');
        }
        if (!nominal || nominal <= 0) {
            throw new ValidationError('Gagal mendeteksi total belanja (Nominal Rp 0).');
        }
    }
}

module.exports = ReceiptValidator;
