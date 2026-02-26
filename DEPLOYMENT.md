# FCMCS Backend API - Plesk Production Deployment Guide

## Overview
This guide provides step-by-step instructions for deploying the FCMCS Backend API to production using Plesk on the `fcmcsapi.cooptran.com` subdomain.

## Prerequisites
- Plesk control panel access
- Node.js runtime available in Plesk
- Domain/subdomain configured: `fcmcsapi.cooptran.com`
- SSL certificate for HTTPS
- Database server access (MSSQL)
- Email service (Resend API) configured

## Pre-Deployment Checklist

### ✅ Environment Configuration
- [ ] Copy `.env.example` to `.env`
- [ ] Fill in all required environment variables:
  ```bash
  NODE_ENV=production
  PORT=3000
  DB_SERVER=your-mssql-server.cooptran.com
  DB_USER=your-db-username
  DB_PASSWORD=your-secure-db-password
  DB_NAME=your-database-name
  JWT_SECRET=your-super-secure-jwt-secret-key-here-min-32-chars
  CORS_ORIGIN=https://fcmcsapi.cooptran.com,capacitor://localhost,http://localhost:8081
  RESEND_API_KEY=your-resend-api-key-here
  EMAIL_FROM=noreplyfcmcs@vendora.business
  ```

### ✅ Server Requirements
- [ ] Node.js version 16+ installed
- [ ] PM2 process manager available
- [ ] Sufficient disk space for logs and node_modules
- [ ] Outbound HTTPS access for email service

### ✅ Security Checklist
- [ ] Strong JWT secret (minimum 32 characters)
- [ ] Database credentials secured
- [ ] HTTPS enforced
- [ ] Rate limiting configured
- [ ] CORS properly restricted
- [ ] Security headers enabled

## Plesk Deployment Steps

### 1. Upload Application Files
1. Log into Plesk control panel
2. Navigate to **Domains** → **fcmcsapi.cooptran.com**
3. Go to **File Manager**
4. Upload all project files to the root directory
5. Ensure proper file permissions (755 for directories, 644 for files)

### 2. Configure Node.js Application
1. In Plesk, go to **Domains** → **fcmcsapi.cooptran.com** → **Node.js**
2. Set **Node.js version** to 16+ (or latest available)
3. Set **Application root** to `/httpdocs` (or your upload directory)
4. Set **Application startup file** to `index.js`
5. Configure **Environment variables** (see section below)
6. Enable **npm install** if available

### 3. Environment Variables in Plesk
Add these environment variables in Plesk Node.js settings:

```
NODE_ENV=production
PORT=3000
DB_SERVER=your-mssql-server.cooptran.com
DB_PORT=1433
DB_USER=your-db-username
DB_PASSWORD=your-secure-db-password
DB_NAME=your-database-name
DB_ENCRYPT=true
DB_TRUST_CERT=true
DB_POOL_MAX=20
DB_POOL_MIN=2
JWT_SECRET=your-super-secure-jwt-secret-key-here-min-32-chars
JWT_EXPIRES_IN=24h
CORS_ORIGIN=https://fcmcs.cooptran.com,capacitor://localhost,http://localhost:8081
RESEND_API_KEY=your-resend-api-key-here
EMAIL_FROM=noreplyfcmcs@vendora.business
LOG_LEVEL=info
```

### 4. SSL/HTTPS Configuration
1. In Plesk, go to **Domains** → **fcmcsapi.cooptran.com** → **SSL/TLS Certificates**
2. Install or generate SSL certificate
3. Ensure **SSL/TLS support** is enabled
4. Redirect HTTP to HTTPS

### 5. Install Dependencies
If npm install is not automatic in Plesk:
```bash
cd /var/www/vhosts/your-domain/httpdocs
npm install --production
```

### 6. PM2 Process Management
1. Install PM2 globally if not available:
   ```bash
   npm install -g pm2
   ```

2. Start the application with PM2:
   ```bash
   pm2 start ecosystem.config.js --env production
   ```

3. Save PM2 configuration:
   ```bash
   pm2 save
   pm2 startup
   ```

4. Configure PM2 to start on server reboot (follow the instructions provided by `pm2 startup`)

### 7. Nginx/Apache Configuration
Plesk should automatically configure the web server. Verify:

1. **Domains** → **fcmcsapi.cooptran.com** → **Apache & nginx Settings**
2. Ensure proxy settings are correct for Node.js
3. Check that port 3000 is properly proxied

## Post-Deployment Verification

### Health Check
```bash
curl -k https://fcmcsapi.cooptran.com/health
```
Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2024-01-16T..."
}
```

### API Testing
Test key endpoints:
```bash
# Test CORS (should return proper headers)
curl -X OPTIONS -H "Origin: https://fcmcsapi.cooptran.com" \
     -H "Access-Control-Request-Method: POST" \
     https://fcmcsapi.cooptran.com/api/auth/login

# Test rate limiting (make multiple requests quickly)
# Should return 429 status after limit exceeded
```

### Log Monitoring
Check application logs:
```bash
pm2 logs fcmcs-api
tail -f logs/combined.log
tail -f logs/error.log
```

## Troubleshooting

### Common Issues

**1. Database Connection Failed**
- Verify DB credentials in environment variables
- Check firewall settings
- Ensure MSSQL server allows remote connections
- Test connection from server: `telnet db-server 1433`

**2. Application Not Starting**
```bash
pm2 logs fcmcs-api --lines 50
npm ls --depth=0  # Check for missing dependencies
```

**3. 502 Bad Gateway**
- Check if Node.js application is running: `pm2 list`
- Verify proxy configuration in Plesk
- Check application port (should be 3000)

**4. CORS Issues**
- Verify `CORS_ORIGIN` environment variable
- Check SSL certificate validity
- Ensure HTTPS redirect is working

**5. Email Not Sending**
- Verify Resend API key
- Check API key permissions
- Test email service independently

**6. Self-Signed Certificate Error**
- Set `DB_TRUST_CERT=true` in environment variables
- This is required for HostGator and similar hosting providers
- The error "self-signed certificate" indicates this setting needs to be enabled
### Log Locations
- **Application logs**: `logs/combined.log`, `logs/error.log`
- **PM2 logs**: `~/.pm2/logs/`
- **Plesk logs**: `/var/log/plesk/`

## Monitoring & Maintenance

### Daily Checks
- [ ] Application health: `curl https://fcmcsapi.cooptran.com/health`
- [ ] PM2 status: `pm2 list`
- [ ] Log file sizes: `ls -lh logs/`
- [ ] Disk space: `df -h`

### Weekly Tasks
- [ ] Review error logs for patterns
- [ ] Check PM2 process memory usage
- [ ] Verify SSL certificate expiry
- [ ] Update dependencies if needed

### PM2 Management Commands
```bash
pm2 restart fcmcs-api      # Restart application
pm2 stop fcmcs-api         # Stop application
pm2 delete fcmcs-api       # Remove from PM2
pm2 monit                  # Monitor processes
pm2 logs fcmcs-api         # View logs
```

## Backup Strategy
- Database: Configure automated MSSQL backups
- Application: Include in regular server backups
- Environment variables: Document securely (not in version control)
- Logs: Rotate regularly to prevent disk space issues

## Security Considerations
- [ ] Regular security updates for Node.js and dependencies
- [ ] Monitor for suspicious activity in logs
- [ ] Keep API keys rotated
- [ ] Use strong passwords for all services
- [ ] Implement proper firewall rules

## Support Contacts
- Development Team: [contact information]
- Server Administrator: [plesk admin contact]
- Database Administrator: [db admin contact]

---

**Last Updated**: January 16, 2025
**Version**: 1.0.0