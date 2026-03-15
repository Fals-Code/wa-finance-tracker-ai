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

async function transcribeAudio(audioBuffer, mimetype, filename = 'audio.ogg') {
    if (!GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is missing');
    }

    const blob = new Blob([audioBuffer], { type: mimetype });
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');
    formData.append('language', 'id'); // Optimize for Indonesian by default

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: formData,
    });

    if (!response.ok) {
        let errorData;
        try {
            errorData = await response.json();
        } catch(e) {
            errorData = { error: { message: response.statusText } };
        }
        throw new Error(`Groq API Audio error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.text;
}

module.exports = {
    callGroq,
    transcribeAudio,
    GROQ_API_KEY
};
