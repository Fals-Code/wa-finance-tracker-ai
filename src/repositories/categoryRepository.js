const DatabaseError = require('../errors/DatabaseError');

class CategoryRepository {
    constructor(supabase, logger) {
        this.supabase = supabase;
        this.logger = logger;
    }

    async getAllByUser(waNumber) {
        const { data, error } = await this.supabase.from('user_categories')
            .select('nama, emoji').eq('wa_number', waNumber).order('nama');
        if (error) throw new DatabaseError(error.message, error);
        return data || [];
    }

    async add(data) {
        const { error } = await this.supabase.from('user_categories').insert(data);
        if (error) throw new DatabaseError('Kategori sudah ada atau gagal ditambah', error);
    }

    async migrate(oldWa, newWa) {
        const { error } = await this.supabase.from('user_categories')
            .update({ wa_number: newWa }).eq('wa_number', oldWa);
        if (error) throw new DatabaseError(error.message, error);
    }
}

module.exports = CategoryRepository;
