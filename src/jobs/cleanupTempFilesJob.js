/**
 * Cleanup Temp Files Job
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

class CleanupTempFilesJob {
    constructor(logger) {
        this.logger = logger;
    }

    async run() {
        this.logger.info('Running Cleanup Temp Files Job');
        const tmpDir = os.tmpdir();
        const files = fs.readdirSync(tmpDir);
        
        let count = 0;
        const now = Date.now();
        const MAX_AGE = 1 * 60 * 60 * 1000; // 1 hour

        for (const file of files) {
            if (file.startsWith('struk_') && file.endsWith('.jpg')) {
                const filePath = path.join(tmpDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > MAX_AGE) {
                        fs.unlinkSync(filePath);
                        count++;
                    }
                } catch (e) {
                    this.logger.error({ file, err: e.message }, 'Failed to delete temp file');
                }
            }
        }
        
        if (count > 0) this.logger.info({ count }, 'Cleaned up orphaned temp OCR files');
    }
}

module.exports = CleanupTempFilesJob;
