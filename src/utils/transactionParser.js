/**
 * Advanced Transaction Parser Utility
 * Extracts description, nominal, and type from natural language inputs
 */

const logger = require('./logger');

class TransactionParser {
    /**
     * Parses a raw text message into structured transaction data
     * @param {string} rawText 
     * @returns {Object} { deskripsi, nominal, tipe }
     */
    parse(rawText) {
        if (!rawText) return null;

        let text = rawText.trim().toLowerCase();
        
        // 1. Detect Type (Masuk/Keluar)
        let tipe = 'keluar';
        const masukKeywords = ['gaji', 'bonus', 'transfer masuk', 'terima', 'income', 'pemasukan', 'hadiah', 'refund'];
        if (masukKeywords.some(kw => text.includes(kw))) {
            tipe = 'masuk';
        }

        // 2. Extract and Normalize Nominal
        // Matches: 20k, 20.000, 20rb, 5jt, 1.5jt, 2m, 2mio, 20ribu
        const nominalRegex = /(?:rp\s*)?([\d.,]+)\s*(k|rb|ribu|jt|juta|m|mio)?(?:\s|$)/i;
        const match = text.match(nominalRegex);
        
        let nominal = 0;
        let deskripsi = rawText.trim();

        if (match) {
            let numStr = match[1];
            let suffix = (match[2] || '').toLowerCase();
            
            // Smarter separator handling
            const dotCount = (numStr.match(/\./g) || []).length;
            const commaCount = (numStr.match(/,/g) || []).length;

            let value = 0;
            if (dotCount + commaCount > 1) {
                // Multiple separators = always thousand separators
                value = parseFloat(numStr.replace(/[.,]/g, ''));
            } else if (dotCount + commaCount === 1) {
                const separator = numStr.includes('.') ? '.' : ',';
                const parts = numStr.split(separator);
                
                // If suffix exists OR (no suffix and not 3 digits after separator) -> it's a decimal
                if (suffix || parts[1].length !== 3) {
                    value = parseFloat(numStr.replace(',', '.'));
                } else {
                    // No suffix and 3 digits -> thousand separator
                    value = parseFloat(numStr.replace(/[.,]/g, ''));
                }
            } else {
                value = parseFloat(numStr);
            }

            if (suffix === 'k' || suffix === 'rb' || suffix === 'ribu') {
                value *= 1000;
            } else if (suffix === 'jt' || suffix === 'juta' || suffix === 'm' || suffix === 'mio') {
                value *= 1000000;
            }

            nominal = value;

            // 3. Extract Description (remove the nominal part from text)
            // We use the original rawText to preserve case for description, but clean it up
            const nominalFullMatch = match[0];
            deskripsi = rawText.replace(new RegExp(this.escapeRegExp(nominalFullMatch), 'i'), '').trim();
            
            // Further clean description
            deskripsi = this.cleanDescription(deskripsi);
        }

        const result = {
            deskripsi: deskripsi || 'Transaksi Tanpa Nama',
            nominal,
            tipe
        };

        logger.info({ event: 'transaction_parsed', input: rawText, result }, 'Parsed transaction input');
        
        return result;
    }

    cleanDescription(text) {
        return text
            .replace(/^beli\s+/i, '')
            .replace(/^bayar\s+/i, '')
            .replace(/[#!?*]/g, '')
            .trim();
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

module.exports = new TransactionParser();
