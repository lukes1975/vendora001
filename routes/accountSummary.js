/**
 * Account Summary Routes
 * Read-only compact financial summary for authenticated members
 * 
 * STRICT RULES (per .cursorrules):
 * - JWT required
 * - PL extracted ONLY from req.user.pl (NOT from params, query, or body)
 * - Query Monthly_Deduction_Payment_Analysis_Table using IndividID = pl
 * - Parameterized MSSQL queries only
 * - Single query, no joins
 * - Numbers only in response (no strings)
 * - No raw DB column names exposed
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { executeQuery } = require('../services/db');

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
// ACCOUNT SUMMARY ENDPOINT
// =============================================================================

/**
 * GET /api/account-summary
 * 
 * Returns compact financial summary for overview cards
 * 
 * Authentication: JWT Bearer token required
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     // Latest month (most recent Date)
 *     shares: number,
 *     ordinarySavings: number,
 *     refundAccount: number,
 *     rssAccount: number,
 *     commodityAccount: number,
 *     developmentLevy: number,
 *     loans: number,
 *     directDeduction: number,
 *     totalAssets: number,
 *     totalLiability: number,
 *     netBalance: number,
 *     // Up to 6 months of history (including current month) ordered newest first
 *     history: [
 *       {
 *         date: Date,
 *         shares: number,
 *         ordinarySavings: number,
 *         refundAccount: number,
 *         rssAccount: number,
 *         commodityAccount: number,
 *         developmentLevy: number,
 *         loans: number,
 *         directDeduction: number,
 *         totalAssets: number,
 *         totalLiability: number,
 *         netBalance: number
 *       }
 *     ]
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
        // QUERY MONTHLY_DEDUCTION_PAYMENT_ANALYSIS_TABLE - SINGLE QUERY, PARAMETERIZED
        // Use ISNULL on all balance columns.
        // We take up to 6 most recent months (by [Date]) for the member.
        // =================================================================
        const query = `
            SELECT TOP 6
                ISNULL(ShrsNewBal, 0)           AS shares,
                ISNULL(SavingNewBal, 0)         AS ordinarySavings,
                ISNULL(Build_FundNewBal, 0)     AS refundAccount,
                ISNULL(SpecialSavingNewBal, 0)  AS rssAccount,
                ISNULL(EssenCoRepayNewBal, 0)   AS commodityAccount,
                /* Development levy not present in this table; keep as 0 for compatibility */
                CAST(0 AS DECIMAL(18, 2))       AS developmentLevy,
                ISNULL(LoanRepayNewBal, 0)      AS loans,
                ISNULL([Total], 0)              AS directDeduction,
                [Date]
            FROM Monthly_Deduction_Payment_Analysis_Table
            WHERE IndividID = @pl
            ORDER BY [Date] DESC
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
        
        const rows = result.recordset;

        // =================================================================
        // MAP EACH MONTH TO NUMBERS ONLY + CALCULATED FIELDS
        // =================================================================
        const history = rows.map(r => {
            const mShares = Number(r.shares) || 0;
            const mOrdinarySavings = Number(r.ordinarySavings) || 0;
            const mRefundAccount = Number(r.refundAccount) || 0;
            const mRssAccount = Number(r.rssAccount) || 0;
            const mCommodityAccount = Number(r.commodityAccount) || 0;
            const mDevelopmentLevy = Number(r.developmentLevy) || 0;
            const mLoans = Number(r.loans) || 0;
            const mDirectDeduction = Number(r.directDeduction) || 0;

            const mTotalAssets = mShares + mOrdinarySavings + mRefundAccount + mRssAccount;
            const mTotalLiability = mLoans + mCommodityAccount;
            const mNetBalance = mTotalAssets - mTotalLiability;

            return {
                date: r.Date,
                shares: mShares,
                ordinarySavings: mOrdinarySavings,
                refundAccount: mRefundAccount,
                rssAccount: mRssAccount,
                commodityAccount: mCommodityAccount,
                developmentLevy: mDevelopmentLevy,
                loans: mLoans,
                directDeduction: mDirectDeduction,
                totalAssets: mTotalAssets,
                totalLiability: mTotalLiability,
                netBalance: mNetBalance
            };
        });

        // Latest month is the first row (ordered DESC by Date)
        const latest = history[0];
        
        // =================================================================
        // RETURN CLEAN RESPONSE (numbers only, no extra fields)
        // =================================================================
        res.json({
            success: true,
            data: {
                shares: latest.shares,
                ordinarySavings: latest.ordinarySavings,
                refundAccount: latest.refundAccount,
                rssAccount: latest.rssAccount,
                commodityAccount: latest.commodityAccount,
                developmentLevy: latest.developmentLevy,
                loans: latest.loans,
                directDeduction: latest.directDeduction,
                totalAssets: latest.totalAssets,
                totalLiability: latest.totalLiability,
                netBalance: latest.netBalance,
                history
            }
        });
        
    } catch (err) {
        console.error('[ACCOUNT SUMMARY ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Unable to retrieve account summary'
        });
    }
});

module.exports = router;
