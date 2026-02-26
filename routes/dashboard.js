/**
 * Dashboard Routes
 * Read-only financial data for authenticated members
 * 
 * STRICT RULES (per .cursorrules):
 * - JWT required
 * - PL extracted ONLY from req.user.pl (NOT from params, query, or body)
 * - Query Pix_Table using AdNo = pl
 * - Parameterized MSSQL queries only
 * - Single query, no joins
 * - Numbers only in response (no strings)
 * - No raw DB column names exposed
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { executeQuery, sql } = require('../services/db');

const router = express.Router();

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'fcmcs-default-secret-change-in-production';

// =============================================================================
// AUTHENTICATION MIDDLEWARE
// =============================================================================

/**
 * Verify JWT and attach user to request
 * Extracts PL from token payload - this is the ONLY source of member identity
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Access token required'
        });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { issuer: 'fcmcs-api' });
        
        // Attach user info to request - PL is the authoritative identifier
        req.user = {
            pl: decoded.pl,
            name: decoded.name,
            email: decoded.email
        };
        
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

// =============================================================================
// DASHBOARD ENDPOINT
// =============================================================================

/**
 * GET /api/dashboard
 * 
 * Returns member financial summary
 * 
 * Authentication: JWT Bearer token required
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     shares: number,
 *     ordinarySavings: number,
 *     refundAccount: number,
 *     rssAccount: number,
 *     commodityAccount: number,
 *     developmentLevy: number,
 *     loans: number,
 *     totalAssets: number,
 *     totalLiability: number,
 *     netBalance: number
 *   }
 * }
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        // =================================================================
        // EXTRACT PL FROM JWT ONLY (NEVER from params, query, or body)
        // =================================================================
        const pl = req.user.pl;
        
        if (!pl) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token: member identifier missing'
            });
        }
        
        // =================================================================
        // QUERY PIX_TABLE - SINGLE QUERY, PARAMETERIZED
        // =================================================================
        const query = `
            SELECT 
                ISNULL(ShrsBal, 0) AS ShrBal,
                ISNULL(SavingBal, 0) AS SavingBal,
                ISNULL(BuildBal, 0) AS BuildBal,
                ISNULL(SpeSavBal, 0) AS SpeSavBal,
                ISNULL(EssenCoRepBal, 0) AS EssenCoRepBal,
                ISNULL(DevBal, 0) AS DevBal,
                ISNULL(LoanRepBal, 0) AS LoanRepBal
            FROM Pix_Table
            WHERE AdNo = @pl
        `;
        
        const result = await executeQuery(query, { pl });
        
        // =================================================================
        // HANDLE NO DATA FOUND
        // =================================================================
        if (!result.recordset || result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Member financial data not found'
            });
        }
        
        const row = result.recordset[0];
        
        // =================================================================
        // MAP COLUMNS TO CLEAN RESPONSE NAMES (Numbers only)
        // =================================================================
        const shares = Number(row.ShrBal) || 0;
        const ordinarySavings = Number(row.SavingBal) || 0;
        const refundAccount = Number(row.BuildBal) || 0;
        const rssAccount = Number(row.SpeSavBal) || 0;
        const commodityAccount = Number(row.EssenCoRepBal) || 0;
        const developmentLevy = Number(row.DevBal) || 0;
        const loans = Number(row.LoanRepBal) || 0;
        
        // =================================================================
        // BACKEND CALCULATIONS (per .cursorrules)
        // =================================================================
        const totalAssets = shares + ordinarySavings + refundAccount + rssAccount;
        const totalLiability = loans + commodityAccount;
        const netBalance = totalAssets - totalLiability;
        
        // =================================================================
        // RETURN CLEAN RESPONSE
        // =================================================================
        res.json({
            success: true,
            data: {
                shares,
                ordinarySavings,
                refundAccount,
                rssAccount,
                commodityAccount,
                developmentLevy,
                loans,
                totalAssets,
                totalLiability,
                netBalance
            }
        });
        
    } catch (err) {
        console.error('[DASHBOARD ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Unable to retrieve financial data'
        });
    }
});

module.exports = router;
