require('dotenv').config();

const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
};

// Simple validation
for (const [key, value] of Object.entries(env)) {
    if (!value && key !== 'GROQ_API_KEY' && key !== 'PORT') {
        throw new Error(`Environment variable ${key} is missing`);
    }
}

module.exports = env;
