/**
 * Profile Routes
 * Read-only personal profile data for authenticated members
 * 
 * STRICT RULES (per .cursorrules):
 * - JWT required
 * - PL extracted ONLY from req.user.pl (NOT from params, query, or body)
 * - Query Individual_Personal_Data_Table using IndivID = pl
 * - Parameterized MSSQL queries only
 * - Single-row fetch, no joins
 * - Raw values from DB (no formatting)
 * - No raw DB column names exposed in response
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
// PROFILE ENDPOINT
// =============================================================================

/**
 * GET /api/profile
 * 
 * Returns member personal profile data
 * 
 * Authentication: JWT Bearer token required
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     title, surname, otherNames, dateOfBirth, sex, admissionDate,
 *     occupation, permanentHomeAddress, email, phone, registrationNo,
 *     nextOfKin, mda, courseOfStudy, serviceArea, nokName, nokPhone
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
        // QUERY INDIVIDUAL_PERSONAL_DATA_TABLE - SINGLE QUERY, PARAMETERIZED
        // =================================================================
        const query = `
            SELECT 
                Title,
                Surname,
                OtherNames,
                Date_Birth,
                Sex,
                AdmisDate,
                Occupation,
                PermanetHomeAdd,
                emailAdd,
                PhoneNo,
                RegistrationNo,
                Next_Kin,
                MDA,
                CourseOfStudy,
                ServiceArea,
                NOKName,
                NOKPhoneNo
            FROM Individual_Personal_Data_Table
            WHERE IndivID = @pl
        `;
        
        const result = await executeQuery(query, { pl });
        
        // =================================================================
        // HANDLE NO DATA FOUND - RETURN 404 WITH SAFE MESSAGE
        // =================================================================
        if (!result.recordset || result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }
        
        const row = result.recordset[0];
        
        // =================================================================
        // MAP COLUMNS TO CLEAN RESPONSE NAMES (Raw values, no formatting)
        // =================================================================
        res.json({
            success: true,
            data: {
                title: row.Title,
                surname: row.Surname,
                otherNames: row.OtherNames,
                dateOfBirth: row.Date_Birth,
                sex: row.Sex,
                admissionDate: row.AdmisDate,
                occupation: row.Occupation,
                permanentHomeAddress: row.PermanetHomeAdd,
                email: row.emailAdd,
                phone: row.PhoneNo,
                registrationNo: row.RegistrationNo,
                nextOfKin: row.Next_Kin,
                mda: row.MDA,
                courseOfStudy: row.CourseOfStudy,
                serviceArea: row.ServiceArea,
                nokName: row.NOKName,
                nokPhone: row.NOKPhoneNo
            }
        });
        
    } catch (err) {
        console.error('[PROFILE ERROR]', err.message);
        
        res.status(500).json({
            success: false,
            message: 'Unable to retrieve profile data'
        });
    }
});

module.exports = router;
