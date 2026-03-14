/**
 * Text processing utilities for AI categorization
 */

const STOP_WORDS = new Set([
    'di', 'dan', 'ke', 'yang', 'ini', 'itu', 'dengan', 'untuk', 'dari', 'dalam',
    'atau', 'juga', 'akan', 'ada', 'tidak', 'bisa', 'kita', 'kami', 'saya', 'anda',
    'the', 'a', 'an', 'of', 'in', 'at', 'by', 'to', 'for', 'on', 'is', 'are', 'was',
    'toko', 'warung', 'kedai', 'gerai', 'cabang', 'outlet', 'pusat', 'pt', 'cv', 'tb',
]);

/**
 * Tokenize text into words, removing stop words
 * @param {string} text 
 * @returns {string[]}
 */
function tokenize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Build IDF (Inverse Document Frequency) map
 * @param {Object[]} dataset 
 * @returns {Object}
 */
function buildIDF(dataset) {
    const N = dataset.length;
    const df = {};
    for (const row of dataset) {
        const tokens = new Set([...tokenize(row.namaToko), ...tokenize(row.keyword)]);
        for (const t of tokens) df[t] = (df[t] || 0) + 1;
    }
    const idf = {};
    for (const [t, freq] of Object.entries(df)) {
        idf[t] = Math.log((N + 1) / (freq + 1)) + 1;
    }
    return idf;
}

/**
 * Create TF-IDF vector for tokens
 * @param {string[]} tokens 
 * @param {Object} idf 
 * @returns {Object}
 */
function tfidfVector(tokens, idf) {
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const vec = {};
    for (const [t, count] of Object.entries(tf)) {
        vec[t] = (count / tokens.length) * (idf[t] || Math.log(2));
    }
    return vec;
}

/**
 * Calculate Cosine Similarity between two vectors
 * @param {Object} vecA 
 * @param {Object} vecB 
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    for (const [k, v] of Object.entries(vecA)) {
        dot += v * (vecB[k] || 0);
        normA += v * v;
    }
    for (const v of Object.values(vecB)) normB += v * v;
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a 
 * @param {string} b 
 * @returns {number}
 */
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
}

/**
 * Calculate similarity based on edit distance
 * @param {string} a 
 * @param {string} b 
 * @returns {number}
 */
function editSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.9;
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

module.exports = {
    tokenize,
    buildIDF,
    tfidfVector,
    cosineSimilarity,
    editSimilarity
};
