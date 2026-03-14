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
        // regex for numbers followed by k or rb, or just numbers with separators
        // Matches: 20k, 20.000, 20000, 20rb, rp 20.000, rp20k
        const nominalRegex = /(?:rp\s*)?([\d.,]+)\s*(k|rb|ribu|juta)?(?:\s|$)/i;
        const match = text.match(nominalRegex);
        
        let nominal = 0;
        let deskripsi = rawText.trim();

        if (match) {
            let rawNum = match[1].replace(/[.,]/g, '');
            let value = parseInt(rawNum);
            let suffix = (match[2] || '').toLowerCase();

            if (suffix === 'k' || suffix === 'rb' || suffix === 'ribu') {
                value *= 1000;
            } else if (suffix === 'juta') {
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
