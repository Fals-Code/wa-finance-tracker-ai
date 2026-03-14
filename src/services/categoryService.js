/**
 * Category Service for managing custom user categories
 */

class CategoryService {
    constructor(databaseService, logger) {
        this.db = databaseService;
        this.logger = logger;
    }

    async getUserCategories(waNumber) {
        return await this.db.getUserCategories(waNumber);
    }

    async addUserCategory(waNumber, nama, emoji = '🏷️') {
        this.logger.info({ waNumber, category: nama }, 'Adding custom user category');
        await this.db.addUserCategory(waNumber, nama, emoji);
    }
}

module.exports = CategoryService;
