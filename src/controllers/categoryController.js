const MSG = require('../constants/messages');
const { setState, resetState } = require('../utils/stateManager');

class CategoryController {
    constructor(services, logger) {
        this.categoryService = services.category;
        this.logger = logger;
    }

    async showMenu(msg, from) {
        this.logger.debug({ from }, 'Showing category menu');
        const cats = await this.categoryService.getUserCategories(from);
        setState(from, 'await_category', {});
        return msg.reply(MSG.categoryMenu(cats));
    }

    async handleAddCategory(msg, from, text) {
        this.logger.info({ from, category: text }, 'Adding custom category');
        try {
            await this.categoryService.addUserCategory(from, text);
            resetState(from);
            return msg.reply(`✅ Kategori "${text}" berhasil ditambah.`);
        } catch (err) {
            this.logger.error({ from, err: err.message }, 'Failed to add category');
            return msg.reply(`❌ ${err.message}`);
        }
    }
}

module.exports = CategoryController;
