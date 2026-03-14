/**
 * AI Learning Service
 * Handles user feedback to expand the keyword dataset automatically
 */

class AILearningService {
    constructor(repositories, logger) {
        this.supabase = repositories.transaction.supabase; // Use direct client for knn_dataset access or repo
        this.logger = logger;
    }

    /**
     * Learns a new keyword from user feedback
     */
    async learnKeyword(waNumber, rawInput, kategori, sub = 'Uncategorized') {
        // Normalize input: take the first 2 words as a potential keyword if it's too long
        const words = rawInput.toLowerCase().trim().split(/\s+/);
        const keyword = words.slice(0, 2).join(' ');

        this.logger.info({ event: 'ai_learning_start', waNumber, keyword, kategori }, 'Learning new keyword from feedback');

        try {
            // 1. Check if keyword already exists
            const { data: existing } = await this.supabase
                .from('knn_dataset')
                .select('id')
                .eq('keyword_utama', keyword)
                .maybeSingle();

            if (existing) {
                this.logger.debug({ keyword }, 'Keyword already exists, skipping duplicate addition');
                return false;
            }

            // 2. Insert into knn_dataset
            const { error } = await this.supabase
                .from('knn_dataset')
                .insert({
                    nama_toko: rawInput,
                    keyword_utama: keyword,
                    kategori: kategori,
                    sub_kategori: sub,
                    sumber: `learning:${waNumber}`
                });

            if (error) throw error;

            this.logger.info({ event: 'ai_learning_success', keyword, kategori }, 'Successfully learned new keyword');
            return true;
        } catch (err) {
            this.logger.error({ event: 'ai_learning_error', err: err.message }, 'Failed to learn keyword');
            return false;
        }
    }
}

module.exports = AILearningService;
