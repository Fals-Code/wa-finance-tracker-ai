const DatabaseError = require('../errors/DatabaseError');

class UserRepository {
    constructor(supabase, logger) {
        this.supabase = supabase;
        this.logger = logger;
    }

    async findByWa(waNumber) {
        const { data, error } = await this.supabase.from('user_profiles').select('*').eq('wa_number', waNumber).maybeSingle();
        if (error) throw new DatabaseError(error.message, error);
        return data;
    }

    async create(data) {
        const { data: newData, error } = await this.supabase.from('user_profiles').insert(data).select().single();
        if (error) throw new DatabaseError(error.message, error);
        return newData;
    }

    async update(waNumber, updateData) {
        const { error } = await this.supabase.from('user_profiles').update(updateData).eq('wa_number', waNumber);
        if (error) throw new DatabaseError(error.message, error);
    }

    async delete(waNumber) {
        const { error } = await this.supabase.from('user_profiles').delete().eq('wa_number', waNumber);
        if (error) throw new DatabaseError(error.message, error);
    }
}

module.exports = UserRepository;
