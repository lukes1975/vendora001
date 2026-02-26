// In-memory storage for failed login attempts
// In production, consider using Redis or database
const failedAttempts = new Map();
const MAX_ATTEMPTS = 7;
const RESET_TIME = 15 * 60 * 1000; // 15 minutes

function getFailedAttempts(username) {
    const record = failedAttempts.get(username);
    if (!record) return 0;
    
    // Reset if time expired
    if (Date.now() - record.lastAttempt > RESET_TIME) {
        failedAttempts.delete(username);
        return 0;
    }
    
    return record.count;
}

function incrementFailedAttempts(username) {
    const current = getFailedAttempts(username);
    failedAttempts.set(username, {
        count: current + 1,
        lastAttempt: Date.now()
    });
}

function resetFailedAttempts(username) {
    failedAttempts.delete(username);
}

function isBlocked(username) {
    return getFailedAttempts(username) >= MAX_ATTEMPTS;
}

module.exports = {
    getFailedAttempts,
    incrementFailedAttempts,
    resetFailedAttempts,
    isBlocked,
    MAX_ATTEMPTS
};
