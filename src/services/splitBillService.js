const { callGroq } = require('../integrations/groqClient');

class SplitBillService {
    constructor(supabase, logger) {
        this.supabase = supabase;
        this.logger = logger;
    }

    /**
     * Extracts items from the receipt and splits them according to the user prompt.
     * @param {string} base64Image - The base64 string of the receipt image
     * @param {string} mimeType - The mimetype of the image (e.g., 'image/jpeg')
     * @param {string} prompt - The natural language instruction on how to split the bill
     * @returns {Promise<string>} - A beautifully formatted WhatsApp message with the split results
     */
    async splitBill(base64Image, mimeType, prompt) {
        this.logger.info('Starting Split Bill process with Groq Vision');

        const systemPrompt = `Kamu adalah Asisten Keuangan super cerdas (Finance Bot). 
Tugasmu adalah membaca struk makanan/belanja dari gambar, lalu MEMBAGI TAGIHAN (Split Bill) secara adil berdasarkan instruksi user.

PENTING:
1. Baca semua pesanan, harga item, Diskon, Service Charge, dan Pajak (PB1/Tax) dari struk.
2. Jika ada Pajak atau Service Charge, bagi beban pajak/service tersebut secara proporsional sesuai total porsi pesanan masing-masing orang. BUKAN dibagi rata ke semua orang, melainkan dibagi persentase.
3. Buatkan rekap tagihan per orang yang sangat jelas dan rapi.
4. Jangan menambahkan narasi panjang, langsung berikan output berupa pesan WhatsApp yang rapi, siap di-copy-paste ke grup.
5. Jika di prompt user menyertakan no rekening (misal: "tf ke BCA 123456"), tambahkan di bagian bawah pesan. Jika tidak ada, kosongi bagian no rekening.

Format Pesan (Contoh):
🍽️ *SPLIT BILL MANTAP* 🍽️
Toko: [Nama Toko dari struk]
Tanggal: [Tanggal dari struk]

🧾 *Ringkasan per Orang:*
*1. [Nama Orang A]*
- [Nama Item] (Rp xxx)
- [Pajak Proporsional] (Rp xxx)
*Total: Rp [Total A]*

*2. [Nama Orang B]*
- [Nama Item] (Rp xxx)
*Total: Rp [Total B]*

-------------------------
💰 *Grand Total Struk:* Rp [Total Keseluruhan]

Silakan transfer ke:
[Nama Bank & Rekening, abaikan jika user tidak menyebutkan di prompt]`;

        const userContext = `Instruksi Pembagian Tagihan:\n"${prompt}"\n\nSilakan baca gambar struk ini dan hitung tagihannya.`;

        try {
            const response = await callGroq({
                model: 'llama-3.2-90b-vision-preview',
                systemPrompt: systemPrompt,
                userPrompt: userContext,
                imageParts: [{
                    b64_img: base64Image,
                    mime_type: mimeType
                }],
                temperature: 0.1,
            });

            if (!response || !response.content) {
                throw new Error('Groq Vision API returned empty response for split bill.');
            }

            const result = response.content.trim();

            // Store in database for dashboard history
            try {
                await this.supabase.from('split_bills').insert({
                    wa_number: waNumber || 'unknown',
                    prompt: prompt,
                    result_text: result,
                    created_at: new Date().toISOString()
                });
            } catch (dbError) {
                this.logger.error({ err: dbError.message }, 'Failed to save split bill history');
                // Don't throw, we still want to return the result to the user
            }

            return result;
        } catch (error) {
            this.logger.error({ error: error.message }, 'Failed to split bill using Groq Vision');
            throw error;
        }
    }
}

module.exports = SplitBillService;
