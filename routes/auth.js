/**
 * Authentication Routes
 * Passcode-based login using PL number as identifier
 * 
 * IMPORTANT: Uses NEW Passcode column (bcrypt hash), NOT legacy Password column
 * 
 * OTP-BASED FORGOT PASSCODE FLOW (per .cursorrules):
 * - Generate 6-digit OTP
 * - Store hash in ResetOTPHash column
 * - Store expiry in ResetOTPExpiresAt column (10 minutes)
 * - DO NOT modify Passcode or Password columns
 * - Send OTP via Resend email API
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { executeQuery, sql } = require('../services/db');
const { 
    isBlocked, 
    incrementFailedAttempts, 
    resetFailedAttempts,
    MAX_ATTEMPTS,
    getFailedAttempts
} = require('../utils/failedLoginTracker');
const {
    canResend,
    incrementResendCount
} = require('../utils/tempPasscodeTracker');
const { sendOTPEmail, sendPasscodeResetConfirmation } = require('../services/email');

const router = express.Router();

// =============================================================================
// AUTH HEALTH CHECK (always available)
// =============================================================================

router.get('/status', (req, res) => {
    res.json({
        success: true,
        message: 'Auth routes are loaded and working',
        timestamp: new Date().toISOString()
    });
});

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'fcmcs-default-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Passcode configuration
const SALT_ROUNDS = 12;
const OTP_EXPIRY_MINUTES = 10; // OTP expires in 10 minutes

/**
 * Generate a random 6-digit numeric OTP
 * @returns {string} - Random 6-digit OTP
 */
const generateOTP = () => {
    let otp = '';
    for (let i = 0; i < 6; i++) {
        otp += Math.floor(Math.random() * 10);
    }
    return otp;
};

/**
 * Parse PL number from username
 * Input format: "IPPIS/PL" (e.g., "TI9875/2432")
 * Returns: PL number (e.g., "2432")
 */
const parsePLFromUsername = (username) => {
    if (!username || typeof username !== 'string') {
        return null;
    }
    
    const parts = username.trim().split('/');
    if (parts.length < 2) {
        return null;
    }
    
    // PL is the second part after the slash
    const pl = parts[1].trim();
    return pl || null;
};

/**
 * Fetch user by PL number from Internetclients table
 * UserName column format in DB: "IPPIS/PL;EMAIL"
 * Uses LIKE '%/PL;%' pattern for lookup
 */
const fetchUserByPL = async (pl) => {
    // Parameterized query to prevent SQL injection
    // Pattern: WHERE UserName LIKE '%/PL;%'
    const query = `
        SELECT 
            URid,
            UserName,
            Passcode,
            Title,
            Surname,
            OtherNames,
            Email,
            ResetOTPHash,
            ResetOTPExpiresAt
        FROM Internetclients
        WHERE UserName LIKE @pattern
    `;
    
    const pattern = `%/${pl};%`;
    
    const result = await executeQuery(query, { 
        pattern: pattern 
    });
    
    return result.recordset[0] || null;
};

/**
 * POST /api/auth/login
 * Authenticate user with passcode
 * 
 * Request body:
 * {
 *   "username": "IPPIS/PL",  // e.g., "TI9875/2432"
 *   "passcode": "string"
 * }
 */
router.post('/login', async (req, res) => {
    try {
        const { username, passcode } = req.body;
        
        // =================================================================
        // INPUT VALIDATION
        // =================================================================
        
        if (!username || !passcode) {
            return res.status(400).json({
                success: false,
                message: 'Username and passcode are required'
            });
        }
        
        // Parse PL from username
        const pl = parsePLFromUsername(username);
        
        if (!pl) {
            return res.status(400).json({
                success: false,
                message: 'Invalid username format. Expected: IPPIS/PL'
            });
        }
        
        // =================================================================
        // BRUTE FORCE PROTECTION
        // =================================================================
        
        if (isBlocked(pl)) {
            const remainingMinutes = 15;
            return res.status(429).json({
                success: false,
                message: `Too many failed attempts. Try again in ${remainingMinutes} minutes.`
            });
        }
        
        // =================================================================
        // USER LOOKUP
        // =================================================================
        
        const user = await fetchUserByPL(pl);
        
        if (!user) {
            incrementFailedAttempts(pl);
            const remaining = MAX_ATTEMPTS - getFailedAttempts(pl);
            
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials',
                attemptsRemaining: remaining > 0 ? remaining : 0
            });
        }
        
        // =================================================================
        // PASSCODE VERIFICATION
        // =================================================================
        
        // Check if user has a passcode set
        if (!user.Passcode) {
            return res.status(401).json({
                success: false,
                message: 'Account not activated. Please contact support.'
            });
        }
        
        // Compare passcode with bcrypt hash
        const isPasscodeValid = await bcrypt.compare(passcode, user.Passcode);
        
        if (!isPasscodeValid) {
            incrementFailedAttempts(pl);
            const remaining = MAX_ATTEMPTS - getFailedAttempts(pl);
            
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials',
                attemptsRemaining: remaining > 0 ? remaining : 0
            });
        }
        
        // =================================================================
        // SUCCESS - GENERATE TOKEN
        // =================================================================
        
        // Reset failed attempts on successful login
        resetFailedAttempts(pl);
        
        // Create JWT payload (minimal user identity)
        const tokenPayload = {
            odUserId: user.URid,
            pl: pl
        };
        
        // Sign JWT token
        const token = jwt.sign(tokenPayload, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN,
            issuer: 'fcmcs-api'
        });
        
        // Return success response
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: {
                    odUserId: user.URid,
                    title: user.Title,
                    surname: user.Surname,
                    otherNames: user.OtherNames
                },
                expiresIn: JWT_EXPIRES_IN
            }
        });
        
    } catch (err) {
        console.error('[AUTH ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Authentication service unavailable'
        });
    }
});

/**
 * POST /api/auth/verify
 * Verify JWT token validity
 */
router.post('/verify', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }
        
        const token = authHeader.split(' ')[1];
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET, {
                issuer: 'fcmcs-api'
            });
            
            res.json({
                success: true,
                message: 'Token is valid',
                data: {
                    odUserId: decoded.odUserId,
                    pl: decoded.pl,
                    expiresAt: new Date(decoded.exp * 1000).toISOString()
                }
            });
            
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
        
    } catch (err) {
        console.error('[VERIFY ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Token verification failed'
        });
    }
});

/**
 * POST /api/auth/change-passcode
 * Change user passcode (requires valid token)
 */
router.post('/change-passcode', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        const token = authHeader.split(' ')[1];
        let decoded;
        
        try {
            decoded = jwt.verify(token, JWT_SECRET, { issuer: 'fcmcs-api' });
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
        
        const { currentPasscode, newPasscode } = req.body;
        
        // Validate input
        if (!currentPasscode || !newPasscode) {
            return res.status(400).json({
                success: false,
                message: 'Current and new passcode are required'
            });
        }
        
        // Validate new passcode strength
        if (newPasscode.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New passcode must be at least 6 characters'
            });
        }
        
        // Fetch current user
        const user = await fetchUserByPL(decoded.pl);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Verify current passcode
        const isCurrentValid = await bcrypt.compare(currentPasscode, user.Passcode);
        
        if (!isCurrentValid) {
            return res.status(401).json({
                success: false,
                message: 'Current passcode is incorrect'
            });
        }
        
        // Hash new passcode
        const saltRounds = 12;
        const hashedPasscode = await bcrypt.hash(newPasscode, saltRounds);
        
        // Update passcode in database
        const updateQuery = `
            UPDATE Internetclients 
            SET Passcode = @newPasscode
            WHERE URid = @odUserId
        `;
        
        await executeQuery(updateQuery, {
            newPasscode: hashedPasscode,
            odUserId: user.URid
        });
        
        res.json({
            success: true,
            message: 'Passcode changed successfully'
        });
        
    } catch (err) {
        console.error('[CHANGE PASSCODE ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Failed to change passcode'
        });
    }
});

// =============================================================================
// OTP-BASED PASSCODE RESET (per .cursorrules - NON-DESTRUCTIVE)
// =============================================================================

/**
 * POST /api/auth/forgot-passcode
 * Generate OTP and send via email (NON-DESTRUCTIVE - does NOT modify Passcode)
 * 
 * Request body:
 * {
 *   "username": "IPPIS/PL"
 * }
 * 
 * Flow:
 * 1. Parse PL from username
 * 2. Look up user by PL
 * 3. Generate 6-digit numeric OTP
 * 4. Hash OTP with bcrypt
 * 5. Store ONLY in ResetOTPHash and ResetOTPExpiresAt (10 minutes)
 * 6. Send OTP to user email using Resend API
 * 7. DO NOT modify Passcode or Password columns
 * 8. Always return generic response (prevent user enumeration)
 */
router.post('/forgot-passcode', async (req, res) => {
    try {
        const { username } = req.body;
        
        // =================================================================
        // INPUT VALIDATION
        // =================================================================
        
        if (!username) {
            return res.status(400).json({
                success: false,
                message: 'Username is required'
            });
        }
        
        const pl = parsePLFromUsername(username);
        
        if (!pl) {
            return res.status(400).json({
                success: false,
                message: 'Invalid username format'
            });
        }
        
        // =================================================================
        // RATE LIMITING
        // =================================================================
        
        const resendStatus = canResend(pl);
        
        if (!resendStatus.canResend) {
            return res.status(429).json({
                success: false,
                message: `Too many requests. Please try again in ${resendStatus.waitTime} minutes.`
            });
        }
        
        // Increment rate limit counter
        incrementResendCount(pl);
        
        // =================================================================
        // USER LOOKUP
        // =================================================================
        
        const user = await fetchUserByPL(pl);
        
        // Generic response to prevent user enumeration
        if (!user) {
            return res.json({
                success: true,
                message: 'If the account exists, a reset code has been sent.'
            });
        }
        
        // Get email from Email column
        const email = user.Email;
        
        if (!email) {
            // Generic response for security
            return res.json({
                success: true,
                message: 'If the account exists, a reset code has been sent.'
            });
        }
        
        // =================================================================
        // GENERATE OTP (6-digit numeric)
        // =================================================================
        
        const otp = generateOTP();
        
        // Hash the OTP
        const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
        
        // Calculate expiry (NOW + 10 minutes)
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
        
        // =================================================================
        // STORE OTP IN DATABASE (NON-DESTRUCTIVE)
        // ONLY updates ResetOTPHash and ResetOTPExpiresAt
        // DOES NOT touch Passcode or Password columns
        // =================================================================
        
        const updateQuery = `
            UPDATE Internetclients 
            SET ResetOTPHash = @otpHash,
                ResetOTPExpiresAt = @expiresAt
            WHERE URid = @odUserId
        `;
        
        await executeQuery(updateQuery, {
            otpHash: otpHash,
            expiresAt: expiresAt,
            odUserId: user.URid
        });
        
        // =================================================================
        // SEND OTP VIA EMAIL (RESEND API)
        // =================================================================
        
        const userName = `${user.Title || ''} ${user.Surname || ''}`.trim() || 'Member';
        await sendOTPEmail(email, otp, userName);
        
        // =================================================================
        // GENERIC SUCCESS RESPONSE (prevent user enumeration)
        // =================================================================
        
        res.json({
            success: true,
            message: 'If the account exists, a reset code has been sent.'
        });
        
    } catch (err) {
        console.error('[FORGOT PASSCODE ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Service temporarily unavailable'
        });
    }
});

/**
 * POST /api/auth/verify-otp
 * Verify OTP and set new passcode
 * 
 * Request body:
 * {
 *   "username": "IPPIS/PL",
 *   "otp": "123456",
 *   "newPasscode": "string"
 * }
 * 
 * Flow:
 * 1. Parse PL from username
 * 2. Look up user by PL
 * 3. Check if OTP exists and is not expired
 * 4. Compare provided OTP with stored hash
 * 5. Validate new passcode (min 6 chars, not equal to phone)
 * 6. Hash new passcode with bcrypt
 * 7. Update Passcode column
 * 8. Clear ResetOTPHash and ResetOTPExpiresAt
 */
router.post('/verify-otp', async (req, res) => {
    try {
        const { username, otp, newPasscode } = req.body;
        
        // =================================================================
        // INPUT VALIDATION
        // =================================================================
        
        if (!username || !otp || !newPasscode) {
            return res.status(400).json({
                success: false,
                message: 'Username, OTP, and new passcode are required'
            });
        }
        
        const pl = parsePLFromUsername(username);
        
        if (!pl) {
            return res.status(400).json({
                success: false,
                message: 'Invalid username format'
            });
        }
        
        // Validate OTP format (6 digits)
        if (!/^\d{6}$/.test(otp)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP format. Must be 6 digits.'
            });
        }
        
        // Validate new passcode strength
        if (newPasscode.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New passcode must be at least 6 characters'
            });
        }
        
        // =================================================================
        // USER LOOKUP
        // =================================================================
        
        const user = await fetchUserByPL(pl);
        
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP or account not found'
            });
        }
        
        // =================================================================
        // CHECK OTP EXISTS
        // =================================================================
        
        if (!user.ResetOTPHash) {
            return res.status(400).json({
                success: false,
                message: 'No reset request found. Please request a new OTP.'
            });
        }
        
        // =================================================================
        // CHECK OTP EXPIRY
        // =================================================================
        
        const now = new Date();
        const expiresAt = new Date(user.ResetOTPExpiresAt);
        
        if (now > expiresAt) {
            // Clear expired OTP
            await executeQuery(`
                UPDATE Internetclients 
                SET ResetOTPHash = NULL, ResetOTPExpiresAt = NULL
                WHERE URid = @odUserId
            `, { odUserId: user.URid });
            
            return res.status(400).json({
                success: false,
                message: 'OTP has expired. Please request a new one.'
            });
        }
        
        // =================================================================
        // VERIFY OTP
        // =================================================================
        
        const isOTPValid = await bcrypt.compare(otp, user.ResetOTPHash);
        
        if (!isOTPValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP'
            });
        }
        
        // =================================================================
        // VALIDATE NEW PASSCODE NOT EQUAL TO PHONE NUMBER
        // =================================================================
        
        if (user.Phone && newPasscode === user.Phone) {
            return res.status(400).json({
                success: false,
                message: 'New passcode cannot be your phone number'
            });
        }
        
        // =================================================================
        // UPDATE PASSCODE AND CLEAR OTP
        // =================================================================
        
        const hashedNewPasscode = await bcrypt.hash(newPasscode, SALT_ROUNDS);
        
        const updateQuery = `
            UPDATE Internetclients 
            SET Passcode = @newPasscode,
                ResetOTPHash = NULL,
                ResetOTPExpiresAt = NULL
            WHERE URid = @odUserId
        `;
        
        await executeQuery(updateQuery, {
            newPasscode: hashedNewPasscode,
            odUserId: user.URid
        });
        
        // =================================================================
        // SEND CONFIRMATION EMAIL
        // =================================================================
        
        const userName = `${user.Title || ''} ${user.Surname || ''}`.trim() || 'Member';
        await sendPasscodeResetConfirmation(user.Email, userName);
        
        // =================================================================
        // SUCCESS RESPONSE
        // =================================================================
        
        res.json({
            success: true,
            message: 'Passcode reset successfully. You can now login with your new passcode.'
        });
        
    } catch (err) {
        console.error('[VERIFY OTP ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Service temporarily unavailable'
        });
    }
});

/**
 * POST /api/auth/resend-otp
 * Resend OTP for password reset (generates new OTP)
 * 
 * Request body:
 * {
 *   "username": "IPPIS/PL"
 * }
 * 
 * Rules:
 * - Rate limited (3 requests per hour per user)
 * - Generates new OTP (replaces old one)
 * - Returns generic message for security
 */
router.post('/resend-otp', async (req, res) => {
    try {
        const { username } = req.body;
        
        // =================================================================
        // INPUT VALIDATION
        // =================================================================
        
        if (!username) {
            return res.status(400).json({
                success: false,
                message: 'Username is required'
            });
        }
        
        const pl = parsePLFromUsername(username);
        
        if (!pl) {
            return res.status(400).json({
                success: false,
                message: 'Invalid username format'
            });
        }
        
        // =================================================================
        // RATE LIMITING
        // =================================================================
        
        const resendStatus = canResend(pl);
        
        if (!resendStatus.canResend) {
            return res.status(429).json({
                success: false,
                message: `Too many requests. Please try again in ${resendStatus.waitTime} minutes.`
            });
        }
        
        // =================================================================
        // USER LOOKUP
        // =================================================================
        
        const user = await fetchUserByPL(pl);
        
        // Generic response to prevent user enumeration
        if (!user) {
            return res.json({
                success: true,
                message: 'If a valid request exists, a new code has been sent.'
            });
        }
        
        // Check if there's an existing OTP request
        if (!user.ResetOTPHash) {
            return res.json({
                success: false,
                message: 'No active reset request found. Please use forgot-passcode first.'
            });
        }
        
        // Get email from Email column
        const email = user.Email;
        
        if (!email) {
            return res.json({
                success: true,
                message: 'If a valid request exists, a new code has been sent.'
            });
        }
        
        // Increment rate limit counter
        incrementResendCount(pl);
        
        // =================================================================
        // GENERATE NEW OTP
        // =================================================================
        
        const otp = generateOTP();
        const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
        
        // Update OTP in database
        const updateQuery = `
            UPDATE Internetclients 
            SET ResetOTPHash = @otpHash,
                ResetOTPExpiresAt = @expiresAt
            WHERE URid = @odUserId
        `;
        
        await executeQuery(updateQuery, {
            otpHash: otpHash,
            expiresAt: expiresAt,
            odUserId: user.URid
        });
        
        // =================================================================
        // SEND OTP VIA EMAIL
        // =================================================================
        
        const userName = `${user.Title || ''} ${user.Surname || ''}`.trim() || 'Member';
        await sendOTPEmail(email, otp, userName);
        
        res.json({
            success: true,
            message: 'If a valid request exists, a new code has been sent.'
        });
        
    } catch (err) {
        console.error('[RESEND OTP ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Service temporarily unavailable'
        });
    }
});

/**
 * POST /api/auth/reset-passcode
 * Reset passcode using temporary passcode (requires JWT token)
 * This is for AUTHENTICATED users who want to change their passcode
 * 
 * Headers:
 *   Authorization: Bearer <token>
 * 
 * Request body:
 * {
 *   "oldPasscode": "string",  // Current passcode
 *   "newPasscode": "string"   // New passcode
 * }
 */
router.post('/reset-passcode', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        const token = authHeader.split(' ')[1];
        let decoded;
        
        try {
            decoded = jwt.verify(token, JWT_SECRET, { issuer: 'fcmcs-api' });
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
        
        const { oldPasscode, newPasscode } = req.body;
        
        // =================================================================
        // INPUT VALIDATION
        // =================================================================
        
        if (!oldPasscode || !newPasscode) {
            return res.status(400).json({
                success: false,
                message: 'Old passcode and new passcode are required'
            });
        }
        
        // Validate new passcode strength (min 6 chars as per .cursorrules)
        if (newPasscode.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New passcode must be at least 6 characters'
            });
        }
        
        // Prevent using same passcode
        if (oldPasscode === newPasscode) {
            return res.status(400).json({
                success: false,
                message: 'New passcode must be different from the old passcode'
            });
        }
        
        // =================================================================
        // USER LOOKUP
        // =================================================================
        
        const user = await fetchUserByPL(decoded.pl);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Account not found'
            });
        }
        
        // =================================================================
        // VERIFY OLD PASSCODE
        // =================================================================
        
        const isOldPasscodeValid = await bcrypt.compare(oldPasscode, user.Passcode);
        
        if (!isOldPasscodeValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid passcode'
            });
        }
        
        // =================================================================
        // VALIDATE NEW PASSCODE NOT EQUAL TO PHONE NUMBER
        // =================================================================
        
        if (user.Phone && newPasscode === user.Phone) {
            return res.status(400).json({
                success: false,
                message: 'New passcode cannot be your phone number'
            });
        }
        
        // =================================================================
        // UPDATE PASSCODE
        // =================================================================
        
        const hashedNewPasscode = await bcrypt.hash(newPasscode, SALT_ROUNDS);
        
        const updateQuery = `
            UPDATE Internetclients 
            SET Passcode = @newPasscode
            WHERE URid = @odUserId
        `;
        
        await executeQuery(updateQuery, {
            newPasscode: hashedNewPasscode,
            odUserId: user.URid
        });
        
        res.json({
            success: true,
            message: 'Passcode reset successfully'
        });
        
    } catch (err) {
        console.error('[RESET PASSCODE ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Service temporarily unavailable'
        });
    }
});

// =============================================================================
// DEBUG ROUTE (for testing auth routing) - Development only
// =============================================================================

if (process.env.NODE_ENV !== 'production') {
    router.get('/test', (req, res) => {
        res.json({
            success: true,
            message: 'Auth routes are working',
            available_endpoints: [
                'POST /api/auth/login',
                'POST /api/auth/verify',
                'POST /api/auth/change-passcode',
                'POST /api/auth/forgot-passcode',
                'POST /api/auth/verify-otp',
                'POST /api/auth/resend-otp',
                'POST /api/auth/reset-passcode'
            ],
            timestamp: new Date().toISOString()
        });
    });
}

module.exports = router;
