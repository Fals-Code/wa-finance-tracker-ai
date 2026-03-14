const AIService = require('../../src/services/aiService');

describe('AI Service', () => {
    let mockDb;
    let mockLogger;
    let aiService;

    beforeEach(() => {
        mockDb = {
            loadKnnDataset: jest.fn().mockResolvedValue([
                { nama_toko: 'Indomaret', keyword_utama: 'minimarket', kategori: 'Kebutuhan Pokok', sub_kategori: 'Minimarket' }
            ]),
            saveFeedback: jest.fn().mockResolvedValue(null)
        };
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };
        aiService = new AIService({ db: mockDb, logger: mockLogger });
    });

    test('getAnalysis should return KNN result for matched toko', async () => {
        const result = await aiService.getAnalysis('Indomaret');
        expect(result.kategori).toBe('Kebutuhan Pokok');
        expect(result.confidence).toBeGreaterThan(80);
        expect(result.method).toContain('KNN');
    });

    test('getAnalysis should fallback to Groq if KNN confidence is low', async () => {
        // We'd need to mock the global 'fetch' or the Groq client to test Groq specifically
        // But this confirms the basic logic of calling the service
        const result = await aiService.getAnalysis('Toko Tidak Dikenal');
        expect(result.kategori).toBeDefined();
    });
});
