/**
 * AI Service for Transaction Categorization
 */

const { tokenize, tfidfVector, cosineSimilarity, editSimilarity, buildIDF } = require('../utils/textUtils');
const { callGroq } = require('../integrations/groqClient');

class AIService {
    constructor(dependencies) {
        this.db = dependencies.db;
        this.logger = dependencies.logger;
        this.knnDataset = [];
        this.idfMap = {};
        this.lastKnnLoad = 0;
        this.KNN_CACHE_MS = 5 * 60 * 1000;
        this.KNN_K = 5;
    }

    async loadDataset() {
        const now = Date.now();
        if (this.knnDataset.length > 0 && (now - this.lastKnnLoad) < this.KNN_CACHE_MS) return;

        try {
            const data = await this.db.loadKnnDataset();
            this.knnDataset = data.map(r => ({
                namaToko: (r.nama_toko || '').toLowerCase().trim(),
                keyword: (r.keyword_utama || '').toLowerCase().trim(),
                kategori: r.kategori || 'Lain-lain',
                sub: r.sub_kategori || 'Uncategorized',
            }));
            
            // Sort by keyword length descending for "longest match first"
            this.knnDataset.sort((a, b) => b.keyword.length - a.keyword.length);
            
            this.idfMap = buildIDF(this.knnDataset);
            this.lastKnnLoad = now;
            this.logger.info({ count: this.knnDataset.length }, 'AI dataset loaded and sorted');
        } catch (e) {
            this.logger.error({ err: e.message }, 'KNN dataset load failed');
        }
    }

    /**
     * Smart Keyword Matching
     * Strategy: Longest match first, Case-insensitive
     */
    async keywordAnalysis(inputText) {
        await this.loadDataset();
        const text = inputText.toLowerCase();

        for (const item of this.knnDataset) {
            if (item.keyword && text.includes(item.keyword)) {
                this.logger.debug({ event: 'keyword_match_found', keyword: item.keyword, kategori: item.kategori }, 'Found keyword match');
                return {
                    kategori: item.kategori,
                    sub: item.sub,
                    confidence: 90.0,
                    status: '✅ Keyword Match',
                    matched: item.keyword,
                    method: 'KeywordMatch'
                };
            }
        }
        return null;
    }

    async knnAnalysis(tokoInput) {
        await this.loadDataset();
        if (this.knnDataset.length === 0) return null;

        const input = tokoInput.toLowerCase().trim();
        const inputTokens = tokenize(input);

        const scored = this.knnDataset.map(row => {
            const rowTokens = [...tokenize(row.namaToko), ...tokenize(row.keyword)];
            if (rowTokens.length === 0) return { score: 0 };

            const vecInput = tfidfVector(inputTokens, this.idfMap);
            const vecRow = tfidfVector(rowTokens, this.idfMap);
            const cosine = cosineSimilarity(vecInput, vecRow);

            const editA = editSimilarity(input, row.namaToko);
            const editB = editSimilarity(input, row.keyword);
            const editBoost = Math.max(editA, editB);

            const score = cosine * 0.60 + editBoost * 0.40;
            return { row, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const topK = scored.slice(0, this.KNN_K).filter(s => s.score >= 0.35);
        if (topK.length === 0) return null;

        const votes = {};
        for (const { row, score } of topK) {
            const key = `${row.kategori}|||${row.sub}`;
            votes[key] = (votes[key] || 0) + score;
        }

        const sortedVotes = Object.entries(votes).sort((a, b) => b[1] - a[1]);
        const bestKey = sortedVotes[0][0];
        const [kategori, sub] = bestKey.split('|||');
        const bestScore = topK[0].score;

        const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
        const winnerVotes = votes[bestKey];
        const consensus = winnerVotes / totalVotes;
        const rawConf = bestScore * 0.7 + consensus * 0.3;
        const confidence = Math.min(99.9, Math.round(rawConf * 1000) / 10);

        if (confidence < 35) return null;

        return {
            kategori,
            sub,
            confidence,
            status: confidence >= 80 ? '✅ Valid' : '🔶 Review',
            matched: topK[0].row.namaToko,
            method: `KNN-${topK.length}`,
        };
    }

    async groqAnalysis(tokoInput, judul) {
        this.logger.debug({ toko: tokoInput }, 'Calling Groq for analysis');
        try {
            const payload = {
                model: 'llama3-8b-8192',
                max_tokens: 120,
                temperature: 0.05,
                messages: [
                    {
                        role: 'system',
                        content: `Kamu AI kategorisasi transaksi keuangan Indonesia. Jawab HANYA format JSON: {"kategori":"...","sub_kategori":"...","klasifikasi_503020":"...","confidence":0-100}. 
                        
Klasifikasi 503020 hanya boleh: 
- "Needs" (Kebutuhan pokok: makan, transport, tagihan, kesehatan)
- "Wants" (Gaya hidup/keinginan: hobi, jajan, hiburan)
- "Savings" (Tabungan/Investasi: dana darurat, saham, cicilan aset)`
                    },
                    {
                        role: 'user',
                        content: `Nama toko: "${tokoInput}"${judul && judul !== tokoInput ? `, Judul: "${judul}"` : ''}`
                    },
                ],
            };
            
            const data = await callGroq(payload);
            const text = data.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
            const conf = Math.min(95, Math.max(50, parsed.confidence || 72));
            
            return {
                kategori: parsed.kategori || 'Lain-lain',
                sub: parsed.sub_kategori || 'Uncategorized',
                klasifikasi_503020: parsed.klasifikasi_503020 || 'Needs',
                confidence: conf,
                status: conf >= 80 ? '🤖 AI' : '🤖 AI (Review)',
                matched: null,
                method: 'Groq LLM',
            };
        } catch (e) {
            this.logger.warn({ err: e.message }, 'Groq analysis fallback failed');
            return null;
        }
    }

    async getAnalysis(tokoInput, judul = '') {
        const textToAnalyze = judul || tokoInput;
        this.logger.info({ input: textToAnalyze }, 'Running categorization analysis');
        
        // 1. First attempt: Longest Keyword Matching
        const kwResult = await this.keywordAnalysis(textToAnalyze);
        if (kwResult) return kwResult;

        // 2. Second attempt: KNN Similarity
        const knnResult = await this.knnAnalysis(textToAnalyze);
        if (knnResult && knnResult.confidence >= 80) {
            this.logger.debug({ method: 'KNN', confidence: knnResult.confidence }, 'High confidence KNN result');
            return knnResult;
        }

        const groqResult = await this.groqAnalysis(tokoInput, judul);
        if (groqResult) {
            if (!knnResult) return groqResult;
            if (knnResult.kategori === groqResult.kategori) {
                const combinedConf = Math.min(99.9, (knnResult.confidence + groqResult.confidence) / 2 + 5);
                this.logger.debug({ method: 'Ensemble', confidence: combinedConf }, 'Ensemble result matched');
                return {
                    ...groqResult,
                    confidence: combinedConf,
                    status: '✅ Ensemble',
                    method: 'KNN+Groq',
                };
            }
            return groqResult.confidence >= knnResult.confidence ? groqResult : knnResult;
        }

        if (knnResult) return knnResult;
        return { kategori: 'Lain-lain', sub: 'Uncategorized', confidence: 30.0, status: '⚠️ Review', matched: null, method: 'Fallback' };
    }

    async saveFeedback(waNumber, toko, kategori, sub) {
        await this.db.saveFeedback(waNumber, toko, kategori, sub);
        this.lastKnnLoad = 0; // Invalidate cache
    }
}

module.exports = AIService;
