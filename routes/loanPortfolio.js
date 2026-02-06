/**
 * Loan Portfolio Routes
 * Read-only loan portfolio data for authenticated members
 * 
 * STRICT RULES (per .cursorrules):
 * - JWT required
 * - PL extracted ONLY from req.user.pl (NOT from params, query, or body)
 * - Query Loan_Record_Table using Borrower'sID = @pl
 * - Query Loan_Reducing_Balance_Analysis_Table using BorrowerID = @pl
 * - Query Loan_Types_Table for loan type rates
 * - Parameterized MSSQL queries only
 * - Multiple queries allowed, NO joins that modify cardinality
 * - Numbers only in response (except dates and status)
 * - No raw DB column names exposed
 * - NO writes, NO updates, NO deletes
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
            pl: decoded.pl
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
// HELPER FUNCTIONS
// =============================================================================

/**
 * Determine loan status based on rules from .cursorrules:
 * - "FULLY_PAID" if fullyPaid = 1
 * - "ACTIVE" if fullyPaid = 0 AND currentOutstandingBalance > 0
 * - "COMPLETED" if completionDate IS NOT NULL
 */
const determineLoanStatus = (fullyPaid, currentOutstandingBalance, completionDate) => {
    if (fullyPaid === 1 || fullyPaid === true) {
        return 'FULLY_PAID';
    }
    if (completionDate !== null && completionDate !== undefined) {
        return 'COMPLETED';
    }
    if ((fullyPaid === 0 || fullyPaid === false) && currentOutstandingBalance > 0) {
        return 'ACTIVE';
    }
    return 'COMPLETED';
};

// =============================================================================
// LOAN PORTFOLIO ENDPOINT
// =============================================================================

/**
 * GET /api/loan-portfolio
 * 
 * Returns member's full loan portfolio
 * 
 * Authentication: JWT Bearer token required
 * 
 * Response:
 * {
 *   success: true,
 *   data: [
 *     {
 *       loanType,
 *       loanTypeRate,
 *       loanPurpose,
 *       amountRequested,
 *       amountApproved,
 *       totalLoanAmount,
 *       totalInterest,
 *       monthlyInterestRate,
 *       monthlyRepaymentAmount,
 *       paymentDurationMonths,
 *       amountPaidToDate,
 *       currentOutstandingBalance,
 *       nextInterestBalance,
 *       loanStatus,
 *       transactionDate,
 *       lastTransactionDate,
 *       completionDate
 *     }
 *   ]
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
        // QUERY 1: LOAN_RECORD_TABLE - Get all loans for member
        // =================================================================
        const loanRecordQuery = `
            SELECT 
                AmountRequired,
                AmountApproved,
                TransactionDate,
                InterestRate,
                TotalInterest,
                Paid,
                PymtDrtn,
                LnRtrn,
                IntRtrn,
                LnTyp,
                Purpose_Loan,
                DateOfCompletion
            FROM Loan_Record_Table
            WHERE [Borrower'sID] = @pl
        `;
        
        const loanRecordResult = await executeQuery(loanRecordQuery, { pl });
        
        // If no loans found, return empty array
        if (!loanRecordResult.recordset || loanRecordResult.recordset.length === 0) {
            return res.json({
                success: true,
                data: []
            });
        }
        
        const loanRecords = loanRecordResult.recordset;
        
        // =================================================================
        // QUERY 2: LOAN_REDUCING_BALANCE_ANALYSIS_TABLE - Get latest balance per loan type (keyed by loan type identifier)
        // =================================================================
        const reducingBalanceQuery = `
            SELECT 
                [LoanType],
                TransDate,
                CurrBal,
                NextInt,
                LoanRepayment
            FROM Loan_Reducing_Balance_Analysis_Table
            WHERE BorrowerID = @pl
        `;
        
        const reducingBalanceResult = await executeQuery(reducingBalanceQuery, { pl });
        
        // Create a map of loan type identifier to latest reducing balance data
        // Use the most recent TransDate for each loan type identifier
        const reducingBalanceMap = new Map();
        
        if (reducingBalanceResult.recordset && reducingBalanceResult.recordset.length > 0) {
            for (const row of reducingBalanceResult.recordset) {
                const loanTypeKey = row.LoanType != null ? String(row.LoanType) : null;
                if (!loanTypeKey) continue;

                const existing = reducingBalanceMap.get(loanTypeKey);
                
                // Keep the most recent entry per loan type
                if (!existing || new Date(row.TransDate) > new Date(existing.TransDate)) {
                    reducingBalanceMap.set(loanTypeKey, row);
                }
            }
        }
        
        // =================================================================
        // QUERY 3: LOAN_TYPES_TABLE - Get loan type metadata (name + rate) keyed by URid
        // =================================================================
        const loanTypesQuery = `
            SELECT 
                URid,
                TypeName,
                Rate
            FROM Loan_Types_Table
        `;
        
        const loanTypesResult = await executeQuery(loanTypesQuery, {});
        
        // Create a map of loan type URid (identifier) to { name, rate }
        const loanTypeInfoMap = new Map();
        
        if (loanTypesResult.recordset && loanTypesResult.recordset.length > 0) {
            for (const row of loanTypesResult.recordset) {
                const idKey = row.URid != null ? String(row.URid) : null;
                if (!idKey) continue;

                loanTypeInfoMap.set(idKey, {
                    name: row.TypeName || null,
                    rate: Number(row.Rate) || 0
                });
            }
        }
        
        // =================================================================
        // MERGE DATA AND COMPUTE DERIVED FIELDS
        // =================================================================
        const loanPortfolio = loanRecords.map(loan => {
            const loanTypeKey = loan.LnTyp != null ? String(loan.LnTyp) : null;

            // Get reducing balance data for this loan type identifier
            const reducingBalance = loanTypeKey ? (reducingBalanceMap.get(loanTypeKey) || {}) : {};

            // Get loan type metadata from Loan_Types_Table using URid
            const typeInfo = loanTypeKey ? (loanTypeInfoMap.get(loanTypeKey) || {}) : {};
            const loanTypeName = typeInfo.name || null;
            const loanTypeRate = typeInfo.rate || 0;
            
            // Map DB columns to API fields (numbers only)
            const amountRequested = Number(loan.AmountRequired) || 0;
            const amountApproved = Number(loan.AmountApproved) || 0;
            const totalInterest = Number(loan.TotalInterest) || 0;
            const monthlyInterestRate = Number(loan.InterestRate) || 0;
            const monthlyRepaymentAmount = Number(loan.LnRtrn) || 0;
            const paymentDurationMonths = Number(loan.PymtDrtn) || 0;
            
            // Reducing balance fields
            const currentOutstandingBalance = Number(reducingBalance.CurrBal) || 0;
            const nextInterestBalance = Number(reducingBalance.NextInt) || 0;
            const amountPaidToDate = Number(reducingBalance.LoanRepayment) || 0;
            
            // Derived fields (per .cursorrules)
            const totalLoanAmount = amountApproved + totalInterest;
            
            // Determine loan status
            const loanStatus = determineLoanStatus(
                loan.Paid,
                currentOutstandingBalance,
                loan.DateOfCompletion
            );
            
            return {
                loanType: loanTypeName,
                loanTypeRate: loanTypeRate,
                loanPurpose: loan.Purpose_Loan || null,
                amountRequested: amountRequested,
                amountApproved: amountApproved,
                totalLoanAmount: totalLoanAmount,
                totalInterest: totalInterest,
                monthlyInterestRate: monthlyInterestRate,
                monthlyRepaymentAmount: monthlyRepaymentAmount,
                paymentDurationMonths: paymentDurationMonths,
                amountPaidToDate: amountPaidToDate,
                currentOutstandingBalance: currentOutstandingBalance,
                nextInterestBalance: nextInterestBalance,
                loanStatus: loanStatus,
                transactionDate: loan.TransactionDate || null,
                lastTransactionDate: reducingBalance.TransDate || null,
                completionDate: loan.DateOfCompletion || null
            };
        });
        
        // =================================================================
        // RETURN CLEAN RESPONSE
        // =================================================================
        res.json({
            success: true,
            data: loanPortfolio
        });
        
    } catch (err) {
        console.error('[LOAN PORTFOLIO ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Unable to retrieve loan portfolio'
        });
    }
});

module.exports = router;
