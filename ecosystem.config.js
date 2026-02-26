/**
 * PM2 Ecosystem Configuration for FCMCS Backend API
 * Used for production deployment in Plesk environment
 */

module.exports = {
  apps: [{
    name: 'fcmcs-api',
    script: 'index.js',
    instances: 2,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Plesk-specific configuration
    cwd: process.cwd(),
    // Auto restart on file changes in production (set to false for stability)
    ignore_watch: [
      'node_modules',
      'logs',
      '*.log'
    ],
    // Health check configuration
    health_check: {
      enabled: true,
      url: '/health',
      interval: 30000, // 30 seconds
      timeout: 5000,   // 5 seconds
      unhealthy_threshold: 3,
      healthy_threshold: 2
    }
  }]
};