const DatabaseError = require('../errors/DatabaseError');

class BudgetRepository {
    constructor(supabase, logger) {
        this.supabase = supabase;
        this.logger = logger;
    }

    async getByMonth(waNumber, bulanKey) {
        const { data, error } = await this.supabase.from('user_budgets')
            .select('budget').eq('wa_number', waNumber).eq('bulan', bulanKey).maybeSingle();
        if (error) throw new DatabaseError(error.message, error);
        return data?.budget || null;
    }

    async upsert(data) {
        const { error } = await this.supabase.from('user_budgets')
            .upsert(data, { onConflict: 'wa_number,bulan' });
        if (error) throw new DatabaseError(error.message, error);
    }

    async migrate(oldWa, newWa) {
        const { error } = await this.supabase.from('user_budgets')
            .update({ wa_number: newWa }).eq('wa_number', oldWa);
        if (error) throw new DatabaseError(error.message, error);
    }
}

module.exports = BudgetRepository;
