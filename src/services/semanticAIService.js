/**
 * Semantic AI Service
 * Advanced categorization using text similarity and grouping logic
 */

const { tokenize, editSimilarity } = require('../utils/textUtils');

class SemanticAIService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
        this.groups = {
            'Makanan': ['makan', 'kopi', 'ayam', 'bakso', 'nasi', 'minum', 'soto', 'burger', 'pizza', 'sushi', 'ramen', 'donut', 'cake'],
            'Transportasi': ['bensin', 'grab', 'gojek', 'parkir', 'tol', 'tiket', 'ojek', 'bis', 'kereta', 'pesawat', 'pertamina', 'shell'],
            'Belanja': ['beli', 'belanja', 'indomaret', 'alfamart', 'superindo', 'shopee', 'tokopedia', 'baju', 'celana', 'sepatu'],
            'Digital': ['netflix', 'spotify', 'youtube', 'icloud', 'google', 'aws', 'domain', 'hosting', 'pulsa', 'kuota', 'game'],
            'Kesehatan': ['obat', 'dokter', 'rs', 'rumah sakit', 'klinik', 'vitamin', 'apotek'],
            'Tagihan': ['listrik', 'pln', 'pdam', 'telkom', 'indihome', 'wifi', 'kontrakan', 'cicilan', 'kartu kredit']
        };
    }

    /**
     * Checks if a text has semantic similarity to known category groups
     * @param {string} text 
     * @returns {Object|null}
     */
    async findSemanticMatch(text) {
        const lower = text.toLowerCase();
        const tokens = tokenize(lower);

        let bestMatch = null;
        let maxScore = 0;

        for (const [kategori, keywords] of Object.entries(this.groups)) {
            for (const kw of keywords) {
                // Check if tokens contain the keyword
                if (tokens.includes(kw)) {
                    const score = 0.85; // Token match score
                    if (score > maxScore) {
                        maxScore = score;
                        bestMatch = { kategori, sub: 'Auto Group', confidence: 85, status: '✨ Semantic', method: 'SemanticHeuristic' };
                    }
                }
                
                // Edit distance check for typos (mkan -> makan)
                const sim = editSimilarity(lower, kw);
                if (sim > 0.8 && sim > maxScore) {
                    maxScore = sim;
                    bestMatch = { kategori, sub: 'Auto Group', confidence: Math.round(sim * 100), status: '✨ Semantic', method: 'FuzzySemantic' };
                }
            }
        }

        if (bestMatch) {
            this.logger.debug({ event: 'semantic_match_found', input: text, match: bestMatch.kategori }, 'Semantic AI match found');
        }
        
        return bestMatch;
    }
}

module.exports = SemanticAIService;
