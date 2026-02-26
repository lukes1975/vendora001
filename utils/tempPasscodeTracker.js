/**
 * OTP Rate Limiter
 * Tracks rate limiting for OTP requests
 * 
 * Rules from .cursorrules:
 * - OTPs expire in 10 minutes (handled in database)
 * - Limit requests to 3 per hour per user
 * 
 * NOTE: OTP storage is now in database (ResetOTPHash, ResetOTPExpiresAt)
 * This module only handles rate limiting
 */

// In-memory storage for rate limiting (use Redis in production for scalability)
const resendCounts = new Map();

// Rate limiting configuration
const RESEND_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_RESENDS_PER_HOUR = 3;

/**
 * Check if user can request a new OTP
 * @param {string} pl - User's PL number
 * @returns {Object} - { canResend: boolean, remainingResends: number, waitTime: number }
 */
function canResend(pl) {
    const resendRecord = resendCounts.get(pl);
    
    if (!resendRecord) {
        return { canResend: true, remainingResends: MAX_RESENDS_PER_HOUR, waitTime: 0 };
    }
    
    // Check if window has expired
    if (Date.now() - resendRecord.windowStart > RESEND_WINDOW) {
        resendCounts.delete(pl);
        return { canResend: true, remainingResends: MAX_RESENDS_PER_HOUR, waitTime: 0 };
    }
    
    const remaining = MAX_RESENDS_PER_HOUR - resendRecord.count;
    const waitTime = Math.ceil((resendRecord.windowStart + RESEND_WINDOW - Date.now()) / 60000);
    
    return {
        canResend: remaining > 0,
        remainingResends: Math.max(0, remaining),
        waitTime: waitTime // minutes until window resets
    };
}

/**
 * Increment request count for a user
 * @param {string} pl - User's PL number
 */
function incrementResendCount(pl) {
    const resendRecord = resendCounts.get(pl);
    
    if (!resendRecord || Date.now() - resendRecord.windowStart > RESEND_WINDOW) {
        resendCounts.set(pl, {
            count: 1,
            windowStart: Date.now()
        });
    } else {
        resendRecord.count++;
    }
}

/**
 * Reset rate limit for a user (for testing or admin purposes)
 * @param {string} pl - User's PL number
 */
function resetRateLimit(pl) {
    resendCounts.delete(pl);
}

module.exports = {
    canResend,
    incrementResendCount,
    resetRateLimit,
    MAX_RESENDS_PER_HOUR,
    RESEND_WINDOW
};
