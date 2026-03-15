/**
 * Saving Goals Service
 * Manages financial goals and tracks progress based on income/savings
 */

class GoalService {
    constructor(dbService, goalRepo, logger) {
        this.db = dbService;
        this.repo = goalRepo;
        this.logger = logger;
    }

    async getGoals(waNumber) {
        return await this.repo.getByWaNumber(waNumber);
    }

    async addGoal(waNumber, name, targetAmount, deadline) {
        this.logger.info({ waNumber, name, targetAmount }, 'Adding new saving goal');
        return await this.repo.create({
            wa_number: waNumber,
            name,
            target_amount: targetAmount,
            deadline: deadline || null,
            current_amount: 0,
            is_completed: false
        });
    }

    async updateGoalProgress(waNumber, amount, isSaving = true) {
        if (!isSaving) return; // Only update on savings/income for now

        const activeGoals = await this.repo.updateProgress(waNumber);
        if (activeGoals.length === 0) return;

        // Simple logic: distribute the saving amount to the oldest active goal first
        // Alternatively, we could ask the user which goal to update, but let's keep it simple.
        const targetGoal = activeGoals[activeGoals.length - 1]; // Oldest first
        const newAmount = parseInt(targetGoal.current_amount) + parseInt(amount);
        
        const updateData = { current_amount: newAmount };
        if (newAmount >= targetGoal.target_amount) {
            updateData.is_completed = true;
        }

        await this.repo.update(targetGoal.id, updateData);
        
        return {
            goalName: targetGoal.name,
            newAmount,
            targetAmount: targetGoal.target_amount,
            isCompleted: updateData.is_completed
        };
    }

    async getGoalStatusMessage(waNumber) {
        const goals = await this.getGoals(waNumber);
        if (goals.length === 0) return "📭 Kamu belum memiliki target tabungan. Ketik *tambah target* untuk mulai!";

        let msg = `🎯 *TARGET TABUNGAN KAMU*\n━━━━━━━━━━━━━━━━━\n`;
        goals.forEach((g, i) => {
            const pct = Math.min(100, Math.round((g.current_amount / g.target_amount) * 100));
            const BAR_LEN = 10;
            const filled = Math.round((pct / 100) * BAR_LEN);
            const bar = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
            
            msg += `${i+1}. *${g.name}*\n`;
            msg += `   [${bar}] ${pct}%\n`;
            msg += `   Rp ${parseInt(g.current_amount).toLocaleString('id-ID')} / Rp ${parseInt(g.target_amount).toLocaleString('id-ID')}\n`;
            if (g.is_completed) msg += `   ✅ *TERCAPAI!*\n`;
            msg += `\n`;
        });
        
        return msg;
    }
}

module.exports = GoalService;
