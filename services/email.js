/**
 * Email Service using Resend API
 * Sends OTP emails for passcode reset flow
 * 
 * Configure in .env:
 * - RESEND_API_KEY: Your Resend API key
 * - EMAIL_FROM: Sender email address (must be verified domain in Resend)
 */

require('dotenv').config();
const { Resend } = require('resend');

// Initialize Resend client
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM || 'noreplyfcmcs@vendora.business';

let resend = null;

/**
 * Initialize Resend client
 */
const initResend = () => {
    if (!RESEND_API_KEY) {
        console.warn('⚠️  RESEND_API_KEY not configured. Email sending disabled.');
        return null;
    }
    
    if (!resend) {
        resend = new Resend(RESEND_API_KEY);
    }
    
    return resend;
};

/**
 * Send OTP email for password reset
 * @param {string} toEmail - Recipient email address
 * @param {string} otp - The 6-digit OTP code
 * @param {string} userName - User's name for personalization
 * @returns {Promise<boolean>} - Success status
 */
const sendOTPEmail = async (toEmail, otp, userName = 'Member') => {
    const client = initResend();
    
    if (!client) {
        // Log for debugging but don't fail the request
        console.log(`[EMAIL] Would send OTP to ${toEmail}: ${otp}`);
        return true; // Return true in dev mode to allow testing
    }
    
    try {
        const { data, error } = await client.emails.send({
            from: FROM_EMAIL,
            to: toEmail,
            subject: 'FCMCS - Your Password Reset Code',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #1a5f2a; border-bottom: 2px solid #1a5f2a; padding-bottom: 10px;">
                        FCMCS Mobile Portal
                    </h2>
                    <p style="font-size: 16px;">Dear ${userName},</p>
                    <p style="font-size: 16px;">You requested to reset your passcode. Use the code below to complete the process:</p>
                    <div style="background-color: #f0f7f0; padding: 25px; text-align: center; margin: 25px 0; border-radius: 8px; border: 1px solid #1a5f2a;">
                        <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1a5f2a;">
                            ${otp}
                        </span>
                    </div>
                    <p style="font-size: 14px; color: #d32f2f; font-weight: bold;">
                        ⏰ This code expires in 10 minutes.
                    </p>
                    <p style="font-size: 14px; color: #666;">
                        If you did not request this code, please ignore this email. Your account remains secure.
                    </p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 25px 0;">
                    <p style="color: #999; font-size: 12px; text-align: center;">
                        This is an automated message from FCMCS. Please do not reply to this email.
                    </p>
                </div>
            `,
            text: `
FCMCS Mobile Portal

Dear ${userName},

You requested to reset your passcode. Use the code below to complete the process:

${otp}

This code expires in 10 minutes.

If you did not request this code, please ignore this email. Your account remains secure.

This is an automated message. Please do not reply to this email.
            `
        });

        if (error) {
            console.error('[EMAIL ERROR]', error);
            return false;
        }

        console.log(`[EMAIL] OTP sent to ${toEmail}, ID: ${data?.id}`);
        return true;
    } catch (err) {
        console.error('[EMAIL ERROR]', err.message);
        return false;
    }
};

/**
 * Send passcode reset confirmation email
 * @param {string} toEmail - Recipient email address
 * @param {string} userName - User's name for personalization
 * @returns {Promise<boolean>} - Success status
 */
const sendPasscodeResetConfirmation = async (toEmail, userName = 'Member') => {
    const client = initResend();
    
    if (!client) {
        console.log(`[EMAIL] Would send reset confirmation to ${toEmail}`);
        return true;
    }
    
    try {
        const { data, error } = await client.emails.send({
            from: FROM_EMAIL,
            to: toEmail,
            subject: 'FCMCS - Passcode Changed Successfully',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #1a5f2a; border-bottom: 2px solid #1a5f2a; padding-bottom: 10px;">
                        FCMCS Mobile Portal
                    </h2>
                    <p style="font-size: 16px;">Dear ${userName},</p>
                    <p style="font-size: 16px;">Your passcode has been successfully changed.</p>
                    <div style="background-color: #e8f5e9; padding: 15px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #1a5f2a;">
                        <p style="margin: 0; color: #1a5f2a;">✓ Passcode updated successfully</p>
                    </div>
                    <p style="font-size: 14px; color: #d32f2f;">
                        If you did not make this change, please contact support immediately.
                    </p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 25px 0;">
                    <p style="color: #999; font-size: 12px; text-align: center;">
                        This is an automated message from FCMCS. Please do not reply to this email.
                    </p>
                </div>
            `,
            text: `
FCMCS Mobile Portal

Dear ${userName},

Your passcode has been successfully changed.

If you did not make this change, please contact support immediately.

This is an automated message. Please do not reply to this email.
            `
        });

        if (error) {
            console.error('[EMAIL ERROR]', error);
            return false;
        }

        console.log(`[EMAIL] Reset confirmation sent to ${toEmail}, ID: ${data?.id}`);
        return true;
    } catch (err) {
        console.error('[EMAIL ERROR]', err.message);
        return false;
    }
};

module.exports = {
    sendOTPEmail,
    sendPasscodeResetConfirmation
};
