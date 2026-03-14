const ValidationError = require('../errors/ValidationError');

class TransactionValidator {
    static validateManualInput(text) {
        if (!text || text.trim().length < 3) {
            throw new ValidationError('Format salah. Contoh: *Nasi Goreng 25000*');
        }
        
        const m = text.match(/^(.+?)\s+([\d.,]+)\s*$/);
        if (!m) {
            throw new ValidationError('Format input tidak dikenali. Gunakan format: *NamaBarang Harga*');
        }

        const toko = m[1].trim();
        const nominalStr = m[2].replace(/\D/g, '');
        const nominal = parseInt(nominalStr);

        if (toko.length < 2) throw new ValidationError('Nama item/toko terlalu pendek.');
        if (isNaN(nominal) || nominal <= 0) throw new ValidationError('Nominal uang tidak valid.');
        if (nominal > 1000000000) throw new ValidationError('Nominal terlalu besar (maksimal 1 miliar).');

        return { toko, nominal };
    }

    static validateConfirmation(data) {
        if (!data.toko || !data.nominal || !data.ai) {
            throw new ValidationError('Data transaksi tidak lengkap.');
        }
    }
}

module.exports = TransactionValidator;
