/**
 * Merchant Parser Utility
 * Extracts potential merchant names from transaction descriptions
 */

class MerchantParser {
    constructor() {
        // Common Indonesian and Global Merchants
        this.merchants = [
            'indomaret', 'alfamart', 'alfamidi', 'superindo', 'hypermart', 'transmart',
            'starbucks', 'kopi kenangan', 'janji jiwa', 'fore', 'mcdonalds', 'mcd', 'kfc', 'burger king',
            'shopee', 'tokopedia', 'lazada', 'tiktok shop', 'grab', 'gojek', 'gofood', 'grabfood',
            'netflix', 'spotify', 'youtube', 'disney', 'icloud', 'google', 'aws', 'midjourney',
            'pertamina', 'shell', 'bp', ' PLN ', 'pdam', 'telkom', 'indihome'
        ];
    }

    /**
     * Attempts to extract a merchant name from text
     * @param {string} text 
     * @returns {string|null}
     */
    detect(text) {
        if (!text) return null;
        const lower = text.toLowerCase();

        // 1. Direct Keyword Match
        for (const m of this.merchants) {
            if (lower.includes(m.toLowerCase().trim())) {
                return m.trim();
            }
        }

        // 2. Heuristic Pattern: "di [Merchant]"
        const diMatch = lower.match(/di\s+([a-z0-9\s]{3,15})(?:\s|$)/i);
        if (diMatch) {
            return diMatch[1].trim();
        }

        // 3. Fallback: Take first 2 words if it's likely a business name
        // (Simplified for now)
        return null;
    }
}

module.exports = new MerchantParser();
