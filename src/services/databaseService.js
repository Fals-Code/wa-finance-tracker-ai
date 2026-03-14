/**
 * Database Service (now orchestrating repositories)
 */
class DatabaseService {
    constructor(repositories, logger) {
        this.userRepo = repositories.user;
        this.trxRepo = repositories.transaction;
        this.budgetRepo = repositories.budget;
        this.categoryRepo = repositories.category;
        this.logger = logger;
    }

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
        
        await this.trxRepo.migrate(oldId, newId);
        await this.budgetRepo.migrate(oldId, newId);
        await this.categoryRepo.migrate(oldId, newId);
        
        const oldProfile = await this.userRepo.findByWa(oldId);
        if (oldProfile) {
            await this.userRepo.create({ 
                wa_number: newId,
                nama: oldProfile.nama,
                authcode: oldProfile.authcode,
                last_active: oldProfile.last_active 
            });
            await this.userRepo.delete(oldId);
        }
    }

    async isNewUser(waNumber) {
        const data = await this.trxRepo.getByWaNumber(waNumber);
        return data.length === 0;
    }

    async saveTransaction(waNumber, namaUser, data) {
        const { toko, nominal, ai, sumber, catatan, judul, tipe } = data;
        await this.trxRepo.create({
            wa_number: waNumber,
            nama_user: namaUser,
            tanggal: new Date().toISOString().split('T')[0],
            deskripsi: judul || toko, // schema v2 uses 'deskripsi'
            nama_toko: toko, // Legacy support
            judul: judul, // Legacy support
            nominal: nominal,
            kategori: ai.kategori,
            sub_kategori: ai.sub,
            sumber_dokumen: sumber || 'WA Bot',
            confidence_ai: Math.round(ai.confidence),
            status_validasi: ai.status,
            catatan: catatan || '',
            tipe: tipe || 'keluar',
        });
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
        return await this.trxRepo.getByWaNumber(waNumber, dariTanggal ? { dariTanggal } : {});
    }

    async getHistory(waNumber, limit = 10) {
        return await this.trxRepo.getByWaNumber(waNumber, { limit });
    }

    async getTransactionDetail(waNumber, trxId) {
        return await this.trxRepo.getByIdAndWa(trxId, waNumber);
    }

    async updateTransaction(waNumber, trxId, updateData) {
        await this.trxRepo.update(trxId, waNumber, updateData);
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
