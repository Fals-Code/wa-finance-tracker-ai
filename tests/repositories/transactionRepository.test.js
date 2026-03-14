const TransactionRepository = require('../../src/repositories/transactionRepository');
const DatabaseError = require('../../src/errors/DatabaseError');

describe('Transaction Repository', () => {
    let mockSupabase;
    let mockLogger;
    let repo;

    beforeEach(() => {
        mockSupabase = {
            from: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({ data: [], error: null })
        };
        mockLogger = { error: jest.fn() };
        repo = new TransactionRepository(mockSupabase, mockLogger);
    });

    test('create should call insert', async () => {
        mockSupabase.insert.mockResolvedValue({ error: null });
        await repo.create({ wa_number: '123' });
        expect(mockSupabase.insert).toHaveBeenCalledWith({ wa_number: '123' });
    });

    test('create should throw DatabaseError on failure', async () => {
        mockSupabase.insert.mockResolvedValue({ error: { message: 'DB Fail' } });
        await expect(repo.create({})).rejects.toThrow(DatabaseError);
    });
});
