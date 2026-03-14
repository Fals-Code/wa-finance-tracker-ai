/**
 * OTP Service
 * Handles generation and verification of 6-digit login codes
 */
class OTPService {
    constructor(otpRepository, logger) {
        this.otpRepo = otpRepository;
        this.logger = logger;
    }

    async generateOTP(waNumber) {
        // Generate 6-digit numeric code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Expires in 5 minutes
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        
        this.logger.info({ waNumber, expiresAt }, 'Generating new OTP');
        await this.otpRepo.saveOTP(waNumber, code, expiresAt);
        
        return code;
    }

    async verifyOTP(waNumber, code) {
        this.logger.info({ waNumber }, 'Verifying OTP');
        const otp = await this.otpRepo.getValidOTP(waNumber, code);
        
        if (otp) {
            await this.otpRepo.deleteUsedOTP(waNumber);
            return true;
        }
        
        return false;
    }
}

module.exports = OTPService;
