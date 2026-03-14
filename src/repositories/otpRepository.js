/**
 * OTP Repository
 * Handles storage and retrieval of dashboard login codes
 */
class OTPRepository {
    constructor(supabase, logger) {
        this.supabase = supabase;
        this.logger = logger;
    }

    async saveOTP(waNumber, code, expiresAt) {
        this.logger.debug({ waNumber, code }, 'Saving OTP to database');
        const { error } = await this.supabase
            .from('login_codes')
            .insert({
                wa_number: waNumber,
                code: code,
                expired_at: expiresAt.toISOString()
            });

        if (error) {
            this.logger.error({ err: error.message }, 'Failed to save OTP');
            throw error;
        }
    }

    async getValidOTP(waNumber, code) {
        const now = new Date().toISOString();
        const { data, error } = await this.supabase
            .from('login_codes')
            .select('*')
            .eq('wa_number', waNumber)
            .eq('code', code)
            .gt('expired_at', now)
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) {
            this.logger.error({ err: error.message }, 'Failed to fetch OTP');
            throw error;
        }

        return data ? data[0] : null;
    }

    async deleteUsedOTP(waNumber) {
        await this.supabase
            .from('login_codes')
            .delete()
            .eq('wa_number', waNumber);
    }
}

module.exports = OTPRepository;
