const rateLimiter = require('../../src/utils/rateLimiter');

describe('Rate Limiter Utility', () => {
    const user = 'test-user';

    beforeEach(() => {
        rateLimiter.reset(user);
    });

    test('should allow requests within limit', () => {
        for (let i = 0; i < 5; i++) {
            expect(rateLimiter.isRateLimited(user)).toBe(false);
        }
    });

    test('should block requests exceeding limit', () => {
        for (let i = 0; i < 5; i++) {
            rateLimiter.isRateLimited(user);
        }
        expect(rateLimiter.isRateLimited(user)).toBe(true);
    });
});
