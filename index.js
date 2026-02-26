/**
 * FCMCS Mobile Financial Portal - Backend API
 * Express Bootstrap (Plesk Entry Point)
 * 
 * This is a READ-ONLY API bridge over a legacy MSSQL system.
 * No INSERT/UPDATE/DELETE operations on financial tables.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./services/logger');
const { getPool, closePool } = require('./services/db');

// Route imports
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

// CORS configuration
const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400 // 24 hours
};
app.use(cors(corsOptions));

// Parse JSON bodies
app.use(express.json({ limit: '10kb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Security headers with Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        success: false,
        message: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 auth requests per windowMs
    message: {
        success: false,
        message: 'Too many authentication attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Compression middleware
app.use(compression());

// Apply rate limiting
app.use('/api/auth', authLimiter);
app.use(limiter);

// Request logging with Winston
app.use((req, res, next) => {
    logger.http(`${req.method} ${req.path} - ${req.ip}`);
    next();
});

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================

app.get('/health', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1 AS status');
        
        res.json({
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(503).json({
            status: 'unhealthy',
            database: 'disconnected',
            timestamp: new Date().toISOString()
        });
    }
});

// =============================================================================
// API ROUTES
// =============================================================================

// Authentication routes
app.use('/api/auth', authRoutes);

// Future: Dashboard routes (shares, savings, loans)
// app.use('/api/dashboard', dashboardRoutes);

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    // Don't leak error details in production
    const isDev = process.env.NODE_ENV === 'development';

    res.status(err.status || 500).json({
        success: false,
        message: isDev ? err.message : 'Internal server error'
    });
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

const startServer = async () => {
    try {
        // Initialize database connection pool
        await getPool();
        logger.info('Database pool initialized');

        // Start Express server
        app.listen(PORT, () => {
            logger.info(`FCMCS API running on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`Health check: http://localhost:${PORT}/health`);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err.message);
        process.exit(1);
    }
};

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

const shutdown = async (signal) => {
    logger.info(`${signal} received. Shutting down gracefully...`);

    try {
        await closePool();
        logger.info('Cleanup complete. Exiting.');
        process.exit(0);
    } catch (err) {
        logger.error('Error during shutdown:', err);
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', { reason, promise });
});

// Start the server
startServer();

module.exports = app;
