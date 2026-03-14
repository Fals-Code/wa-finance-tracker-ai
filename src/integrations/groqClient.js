require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

/**
 * Call Groq API for AI analysis
 * @param {Object} payload 
 * @returns {Promise<Object>}
 */
async function callGroq(payload) {
    if (!GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is missing');
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Groq API error: ${errorData.error?.message || response.statusText}`);
    }

    return await response.json();
}

module.exports = {
    callGroq,
    GROQ_API_KEY
};
