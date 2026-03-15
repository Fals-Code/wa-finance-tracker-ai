const fs = require('fs');
const path = require('path');

class PersonaService {
    constructor(logger) {
        this.logger = logger;
        this.filePath = path.join(__dirname, '../../data/user_personas.json');
        this.personas = {};
        this.load();
        
        this.PERSONA_CONFIG = {
            professional: {
                name: 'Profesional',
                emoji: '👔',
                description: 'Sopan, bijak, dan sangat terstruktur.',
                prompt: 'Kamu adalah AI Financial Coach yang sangat PROFESIONAL. Gunakan bahasa yang sopan, bijak, dan berikan saran yang sangat terstruktur. Panggil user dengan "Bapak/Ibu" atau "Kak".'
            },
            galak: {
                name: 'Galak (Sarkas)',
                emoji: '👺',
                description: 'Tegas, sedikit sarkas, dan menuntut kedisiplinan.',
                prompt: 'Kamu adalah AI Financial Coach yang sangat TEGAS dan SARKAS. Jika user boros, tegur dengan keras dan berikan sindiran pedas tapi membangun. Jangan banyak basa-basi. Panggil user dengan "Woey" atau langsung namanya.'
            },
            santai: {
                name: 'Santai (Gen-Z)',
                emoji: '🤙',
                description: 'Bahasa anak muda, santai, banyak emoji.',
                prompt: 'Kamu adalah AI Financial Coach yang GAUL dan SANTAI ala Gen-Z. Gunakan bahasa sehari-hari (Lo/Gue/Kak), banyak emoji, dan berikan vibe seolah-olah kamu adalah teman dekat user yang peduli keuangan dia.'
            }
        };
    }

    load() {
        try {
            const dataDir = path.dirname(this.filePath);
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            
            if (fs.existsSync(this.filePath)) {
                const content = fs.readFileSync(this.filePath, 'utf-8');
                this.personas = JSON.parse(content);
            }
        } catch (error) {
            this.logger.error({ error: error.message }, 'Failed to load personas');
        }
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.personas, null, 2));
        } catch (error) {
            this.logger.error({ error: error.message }, 'Failed to save personas');
        }
    }

    setPersona(waNumber, personaKey) {
        if (!this.PERSONA_CONFIG[personaKey]) return false;
        this.personas[waNumber] = personaKey;
        this.save();
        return true;
    }

    getPersona(waNumber) {
        const key = this.personas[waNumber] || 'professional';
        return this.PERSONA_CONFIG[key] || this.PERSONA_CONFIG.professional;
    }

    getAvailablePersonas() {
        return this.PERSONA_CONFIG;
    }
}

module.exports = PersonaService;
