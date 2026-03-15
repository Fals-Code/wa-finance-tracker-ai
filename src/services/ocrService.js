/**
 * OCR Service using Tesseract.js
 */

const { callGroq } = require('../integrations/groqClient');
const { metrics } = require('../utils/metrics');

class OCRService {
    constructor(logger) {
        this.logger = logger;
    }

    async extractText(base64Image, mimeType = 'image/jpeg') {
        this.logger.info({ event: 'ocr_started' }, 'Starting Groq Vision OCR');
        
        try {
            const payload = {
                model: 'llama-3.2-90b-vision-preview',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'Tolong ekstrak semua teks yang ada di gambar struk ini dengan sangat akurat. Pertahankan tata letaknya.'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                temperature: 0.1, // precision is key
                max_tokens: 1024
            };

            const response = await callGroq(payload);
            const text = response.choices[0].message.content;
            
            this.logger.debug({ event: 'ocr_success' }, 'Vision OCR successful');
            metrics.ocrCounter.inc({ result: 'success' });
            return text;

        } catch (err) {
            this.logger.error({ event: 'ocr_failed', err: err.message }, 'Groq Vision OCR failed');
            metrics.ocrCounter.inc({ result: 'failure' });
            throw err;
        }
    }
}

module.exports = OCRService;
