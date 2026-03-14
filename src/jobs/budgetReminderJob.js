/**
 * Budget Reminder Job
 */
class BudgetReminderJob {
    constructor(client, budgetService, logger) {
        this.client = client;
        this.budgetService = budgetService;
        this.logger = logger;
    }

    async executeForUser(wa) {
        this.logger.debug({ wa }, 'Checking budget for reminder job');
        const alert = await this.budgetService.checkBudgetAlert(wa);
        return alert;
    }
}

module.exports = BudgetReminderJob;
