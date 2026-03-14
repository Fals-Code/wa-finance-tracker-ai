/**
 * AI Learning Service
 * Handles user feedback to expand the keyword dataset automatically
 */

class AILearningService {
    constructor(dbService, logger) {
        this.db = dbService;
        this.logger = logger;
    }

    /**
     * Learns a new keyword from user feedback
     */
    async learnKeyword(waNumber, rawInput, kategori, sub = 'Uncategorized') {
        const words = rawInput.toLowerCase().trim().split(/\s+/);
        const keyword = words.slice(0, 2).join(' ');

        this.logger.info({ event: 'ai_learning_start', waNumber, keyword, kategori }, 'Learning new keyword from feedback');

        try {
            // Save feedback via database service
            await this.db.saveFeedback(waNumber, rawInput, kategori, sub);
            
            // Note: In schema-v2, we might also want to update knn_dataset directly or via a separate repo
            // For now, aligning with the user's request to use dbService
            this.logger.info({ event: 'ai_learning_success', keyword, kategori }, 'Successfully learned new keyword');
            return true;
        } catch (err) {
            this.logger.error({ event: 'ai_learning_error', err: err.message }, 'Failed to learn keyword');
            return false;
        }
    }
}

module.exports = AILearningService;
