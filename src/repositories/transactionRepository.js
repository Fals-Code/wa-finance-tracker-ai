const DatabaseError = require('../errors/DatabaseError');

class TransactionRepository {
    constructor(supabase, logger) {
        this.supabase = supabase;
        this.logger = logger;
    }

    async create(data) {
        const { error } = await this.supabase.from('transaksi').insert(data);
        if (error) {
            this.logger.error({ err: error.message, data }, 'Database error in TransactionRepository.create');
            throw new DatabaseError(error.message, error);
        }
    }

    async getByWaNumber(waNumber, filters = {}) {
        let query = this.supabase.from('transaksi').select('*').eq('wa_number', waNumber);
        
        if (filters.tipe) query = query.eq('tipe', filters.tipe);
        if (filters.dariTanggal) query = query.gte('tanggal', filters.dariTanggal);
        
        const { data, error } = await query.order('tanggal', { ascending: false });
        if (error) throw new DatabaseError(error.message, error);
        return data || [];
    }

    async getByIdAndWa(id, waNumber) {
        const { data, error } = await this.supabase.from('transaksi')
            .select('*').eq('id', id).eq('wa_number', waNumber).single();
        if (error) throw new DatabaseError(error.message, error);
        return data;
    }

    async update(id, waNumber, updateData) {
        const { error } = await this.supabase.from('transaksi')
            .update(updateData).eq('id', id).eq('wa_number', waNumber);
        if (error) throw new DatabaseError(error.message, error);
    }

    async delete(id, waNumber) {
        const { error } = await this.supabase.from('transaksi')
            .delete().eq('id', id).eq('wa_number', waNumber);
        if (error) throw new DatabaseError(error.message, error);
    }

    async migrate(oldWa, newWa) {
        const { error } = await this.supabase.from('transaksi')
            .update({ wa_number: newWa }).eq('wa_number', oldWa);
        if (error) throw new DatabaseError(error.message, error);
    }
}

module.exports = TransactionRepository;
