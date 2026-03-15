const DatabaseError = require('../errors/DatabaseError');

class GoalRepository {
    constructor(supabase, logger) {
        this.supabase = supabase;
        this.logger = logger;
    }

    async getByWaNumber(waNumber) {
        const { data, error } = await this.supabase.from('saving_goals')
            .select('*')
            .eq('wa_number', waNumber)
            .order('created_at', { ascending: false });
        
        if (error) throw new DatabaseError(error.message, error);
        return data || [];
    }

    async create(data) {
        const { error } = await this.supabase.from('saving_goals')
            .insert(data);
        
        if (error) throw new DatabaseError(error.message, error);
    }

    async update(id, data) {
        const { error } = await this.supabase.from('saving_goals')
            .update(data)
            .eq('id', id);
        
        if (error) throw new DatabaseError(error.message, error);
    }

    async delete(id) {
        const { error } = await this.supabase.from('saving_goals')
            .delete()
            .eq('id', id);
        
        if (error) throw new DatabaseError(error.message, error);
    }

    async updateProgress(waNumber, amount) {
        // Logic to update active goals can be more complex, 
        // but for now let's just expose a way to get active goals.
        const { data, error } = await this.supabase.from('saving_goals')
            .select('*')
            .eq('wa_number', waNumber)
            .eq('is_completed', false);
        
        if (error) throw new DatabaseError(error.message, error);
        return data || [];
    }
}

module.exports = GoalRepository;
