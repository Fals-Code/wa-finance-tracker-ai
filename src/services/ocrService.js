/**
 * OCR Service using Tesseract.js
 */

const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { metrics } = require('../utils/metrics');

class OCRService {
    constructor(logger) {
        this.logger = logger;
    }

    async extractText(base64Image) {
        const tmpFile = path.join(os.tmpdir(), `struk_${Date.now()}.jpg`);
        fs.writeFileSync(tmpFile, Buffer.from(base64Image, 'base64'));
        
        this.logger.info({ event: 'ocr_started', tmpFile }, 'Starting Tesseract OCR');
        try {
            const result = await Tesseract.recognize(tmpFile, 'ind+eng');
            this.logger.debug({ event: 'ocr_success' }, 'OCR successful');
            metrics.ocrCounter.inc({ result: 'success' });
            return result.data.text;
        } catch (err) {
            this.logger.error({ event: 'ocr_failed', err: err.message }, 'Tesseract OCR failed');
            metrics.ocrCounter.inc({ result: 'failure' });
            throw err;
        } finally {
            try {
                if (fs.existsSync(tmpFile)) {
                    fs.unlinkSync(tmpFile);
                    this.logger.debug({ tmpFile }, 'Cleaned up OCR temp file');
                }
            } catch (err) {
                this.logger.warn({ err: err.message }, 'Cleanup OCR temp file failed');
            }
        }
    }
}

module.exports = OCRService;
