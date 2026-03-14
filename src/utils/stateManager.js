/**
 * Simple In-memory State Management for Conversational Bot
 */

const userState = new Map();
const STATE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Get current state for a user
 * @param {string} from - WhatsApp ID
 * @returns {Object}
 */
function getState(from) {
    return userState.get(from) || { step: 'idle', data: {}, lastActive: 0 };
}

/**
 * Set state for a user and update last active timestamp
 * @param {string} from - WhatsApp ID
 * @param {string} step - Current step name
 * @param {Object} data - Context data
 */
function setState(from, step, data = {}) {
    userState.set(from, { step, data, lastActive: Date.now() });
}

/**
 * Delete state for a user
 * @param {string} from - WhatsApp ID
 */
function resetState(from) {
    userState.delete(from);
}

/**
 * Check if a state has timed out
 * @param {Object} state - State object from getState
 * @returns {boolean}
 */
function isTimedOut(state) {
    if (state.step === 'idle') return false;
    return Date.now() - state.lastActive > STATE_TIMEOUT_MS;
}

module.exports = {
    getState,
    setState,
    resetState,
    isTimedOut
};
