const MSG = require('../constants/messages');
const { setState, resetState } = require('../utils/stateManager');

class BudgetController {
    constructor(services, logger) {
        this.budgetService = services.budget;
        this.logger = logger;
    }

    async showMenu(msg, from) {
        this.logger.debug({ from }, 'Showing budget menu');
        const budget = await this.budgetService.getBudget(from);
        setState(from, 'await_budget', {});
        return msg.reply(MSG.budgetMenu(budget));
    }

    async handleSetBudget(msg, from, text) {
        const amount = parseInt(text.replace(/\D/g, ''));
        if (isNaN(amount) || amount <= 0) {
            return msg.reply('❌ Nominal tidak valid. Masukkan angka saja.');
        }

        this.logger.info({ from, amount }, 'Setting new monthly budget');
        await this.budgetService.setBudget(from, amount);
        resetState(from);
        return msg.reply(`✅ Budget berhasil diatur: *Rp ${amount.toLocaleString('id-ID')}*`);
    }
}

module.exports = BudgetController;
