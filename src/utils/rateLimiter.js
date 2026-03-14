const botConfig = require('../config/botConfig');

class RateLimiter {
    constructor() {
        this.requests = new Map();
        this.limit = botConfig.RATE_LIMIT_MAX || 5;
        this.windowMs = botConfig.RATE_LIMIT_MS || 10000;
    }

    isRateLimited(userId) {
        const now = Date.now();
        const userRequests = this.requests.get(userId) || [];
        
        // Filter requests within the window
        const validRequests = userRequests.filter(timestamp => now - timestamp < this.windowMs);
        
        if (validRequests.length >= this.limit) {
            return true;
        }

        validRequests.push(now);
        this.requests.set(userId, validRequests);
        return false;
    }

    reset(userId) {
        this.requests.delete(userId);
    }
}

// Singleton for global use
module.exports = new RateLimiter();
