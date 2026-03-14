const AppError = require('./AppError');

class DatabaseError extends AppError {
    constructor(message, originalError = null) {
        super(message, 500);
        this.name = 'DatabaseError';
        this.originalError = originalError;
    }
}

module.exports = DatabaseError;
