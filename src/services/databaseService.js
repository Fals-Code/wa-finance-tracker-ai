/**
 * Database Service (now orchestrating repositories)
 */
class DatabaseService {
    constructor(repositories, logger) {
        this._userRepo = repositories.user;
        this._trxRepo = repositories.transaction;
        this._budgetRepo = repositories.budget;
        this._categoryRepo = repositories.category;
        this.logger = logger;
    }

    get userRepo() { return this._userRepo; }
    get trxRepo() { return this._trxRepo; }
    get budgetRepo() { return this._budgetRepo; }
    get categoryRepo() { return this._categoryRepo; }

    async getOrCreateProfile(waNumber, nama) {
        const profile = await this.userRepo.findByWa(waNumber);
        if (profile) {
            await this.userRepo.update(waNumber, { last_active: new Date().toISOString(), nama });
            return profile;
        }
        return await this.userRepo.create({ wa_number: waNumber, nama });
    }

    async migrateUser(oldId, newId) {
        if (oldId === newId) return;
        this.logger.info({ oldId, newId }, 'Migrating user data across repositories');
        
        try {
            await this.trxRepo.migrate(oldId, newId);
            await this.budgetRepo.migrate(oldId, newId);
            await this.categoryRepo.migrate(oldId, newId);
            
            const oldProfile = await this.userRepo.findByWa(oldId);
            if (oldProfile) {
                // Check if newId already exists (migration already happened)
                const existingNew = await this.userRepo.findByWa(newId);
                if (!existingNew) {
                    await this.userRepo.create({ 
                        wa_number: newId,
                        nama: oldProfile.nama,
                        authcode: oldProfile.authcode,
                        last_active: oldProfile.last_active 
                    });
                }
                await this.userRepo.delete(oldId);
            }
            this.logger.info({ newId }, 'Migration complete');
        } catch (e) {
            this.logger.error({ oldId, newId, err: e.message }, 'Migration failed');
        }
    }

    async isNewUser(waNumber) {
        const data = await this.trxRepo.getByWaNumber(waNumber);
        return data.length === 0;
    }

    async saveTransaction(waNumber, namaUser, data) {
        const { toko, nominal, ai, sumber, catatan, judul, tipe } = data;
        
        const record = {
            wa_number: waNumber,
            nama_user: namaUser,
            tanggal: new Date().toISOString().split('T')[0],
            nominal: nominal,
            kategori: ai.kategori,
            sub_kategori: ai.sub,
            sumber_dokumen: sumber || 'WA Bot',
            confidence_ai: Math.round(ai.confidence),
            status_validasi: ai.status,
            catatan: catatan || '',
            tipe: tipe || 'keluar',
        };

        // Support both schema versions gracefully
        const judulValue = judul || toko || 'Transaksi';
        record.judul = judulValue;  // schema lama
        record.nama_toko = toko || '';  // schema lama
        record.deskripsi = judulValue;  // schema baru

        await this.trxRepo.create(record);
    }

    async getBudget(waNumber, bulanKey) {
        return await this.budgetRepo.getByMonth(waNumber, bulanKey);
    }

    async setBudget(waNumber, bulanKey, nominal) {
        await this.budgetRepo.upsert({ wa_number: waNumber, bulan: bulanKey, budget: nominal });
    }

    async setCategoryBudget(waNumber, kategori, nominal) {
        await this.budgetRepo.upsertCategoryBudget({ wa_number: waNumber, kategori, limit_amount: nominal });
    }

    async getCategoryBudgets(waNumber) {
        return await this.budgetRepo.getCategoryBudgets(waNumber);
    }

    async getTotalKeluar(waNumber, dariTanggal) {
        const data = await this.trxRepo.getByWaNumber(waNumber, { tipe: 'keluar', dariTanggal });
        return data.reduce((s, r) => s + parseInt(r.nominal || 0), 0);
    }

    async getTransactions(waNumber = null, dariTanggal = null) {
        if (waNumber === null) {
            // Global query — for dashboard analytics
            let query = this.trxRepo.supabase.from('transaksi').select('*');
            if (dariTanggal) query = query.gte('tanggal', dariTanggal);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw new Error(error.message);
            return data || [];
        }
        return await this.trxRepo.getByWaNumber(waNumber, dariTanggal ? { dariTanggal } : {});
    }

    async getRecentTransactions(waNumber, sinceIso, limit = 20) {
        const { data, error } = await this.trxRepo.supabase
            .from('transaksi')
            .select('nominal, judul, nama_toko, deskripsi')
            .eq('wa_number', waNumber)
            .gte('created_at', sinceIso)
            .limit(limit);
        if (error) throw new Error(error.message);
        return data || [];
    }

    async getHistory(waNumber, limit = 10) {
        return await this.trxRepo.getByWaNumber(waNumber, { limit });
    }

    async getTransactionDetail(waNumber, trxId) {
        return await this.trxRepo.getByIdAndWa(trxId, waNumber);
    }

    async updateTransaction(waNumber, trxId, updateData) {
        // Whitelist field yang boleh diupdate
        const ALLOWED = ['judul', 'nominal', 'kategori', 'catatan', 'nama_toko', 'deskripsi'];
        const safeData = {};
        for (const [k, v] of Object.entries(updateData)) {
            if (ALLOWED.includes(k)) safeData[k] = v;
        }
        
        if (Object.keys(safeData).length === 0) {
            throw new Error('Tidak ada field valid untuk diupdate');
        }

        await this.trxRepo.update(trxId, waNumber, safeData);
    }

    async deleteTransaction(waNumber, trxId) {
        await this.trxRepo.delete(trxId, waNumber);
    }

    async getUserCategories(waNumber) {
        return await this.categoryRepo.getAllByUser(waNumber);
    }

    async addUserCategory(waNumber, nama, emoji = '🏷️') {
        await this.categoryRepo.add({ wa_number: waNumber, nama, emoji });
    }

    async loadKnnDataset() {
        const { data, error } = await this.trxRepo.supabase.from('knn_dataset')
            .select('nama_toko, keyword_utama, kategori, sub_kategori');
        if (error) throw error;
        return data || [];
    }

    async saveFeedback(waNumber, toko, kategori, sub) {
        await this.trxRepo.supabase.from('knn_dataset').insert({
            nama_toko: toko,
            keyword_utama: toko.toLowerCase(),
            kategori,
            sub_kategori: sub,
            sumber: `feedback:${waNumber}`,
        });
    }
}

module.exports = DatabaseService;
