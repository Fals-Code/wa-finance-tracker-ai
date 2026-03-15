/**
 * Utility functions for date manipulation
 */

/**
 * Get the start and end of the month for a given date.
 * @param {Date} date - The date to get the month bounds for.
 * @returns {Object} - An object containing start and end ISO strings.
 */
function getStartAndEndOfMonth(date = new Date()) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    
    return {
        start: start.toISOString(),
        end: end.toISOString()
    };
}

/**
 * Get a string key for the month in YYYY-MM format.
 * @param {Date} date - The date to get the key for.
 * @returns {string} - The month key (e.g., "2024-03").
 */
function getBulanKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = {
    getStartAndEndOfMonth,
    getBulanKey
};
