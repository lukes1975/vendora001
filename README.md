# FCMCS Mobile Financial Portal - Backend API

A secure, **read-only** Node.js + Express API bridge for the FCMCS (Federal Cooperative Multipurpose Credit Society) mobile financial portal. This backend serves as a secure data proxy over a legacy MSSQL database system.

---

## 📋 Overview

This API provides mobile app users with secure access to their cooperative financial data including:
- **Account balances** (shares, savings, loans)
- **Personal profile** information
- **Loan portfolio** details
- **Secure authentication** via passcode

### Key Principles
- **READ-ONLY**: No INSERT/UPDATE/DELETE on financial tables
- **Secure**: HTTPS, parameterized queries, bcrypt hashing
- **API Bridge**: Mobile app never connects directly to MSSQL

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React Native  │────▶│   Node.js API   │────▶│  MSSQL Database │
│   Mobile App    │◀────│   (Express)     │◀────│    (Legacy)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌───────────┐
                        │  Resend   │
                        │  (Email)  │
                        └───────────┘
```

---

## 📁 Project Structure

```
fcmcs-backend/
├── index.js                    # Express bootstrap (entry point)
├── package.json                # Dependencies
├── .env                        # Environment variables (not in git)
├── .cursorrules                # AI coding rules (source of truth)
│
├── routes/
│   ├── auth.js                 # Login, OTP, passcode management
│   ├── dashboard.js            # Financial summary
│   ├── profile.js              # Personal data
│   ├── accountSummary.js       # Compact financial overview
│   └── loanPortfolio.js        # Full loan details
│
├── services/
│   ├── db.js                   # MSSQL connection pool
│   ├── email.js                # Resend email service
│   └── logger.js               # Winston logging
│
├── utils/
│   ├── failedLoginTracker.js   # Brute force protection
│   └── tempPasscodeTracker.js  # OTP rate limiting
│
└── config/
    └── db.js                   # Database configuration
```

---

## 🔐 Authentication

### Strategy
- Uses **NEW** `Passcode` column (bcrypt hashed)
- Legacy `Password` column is **NEVER** touched
- Default passcode = member's phone number

### Username Format
```
IPPIS/PL  →  Example: "TI9875/2432"
```
- IPPIS is ignored
- PL number is the authoritative identifier

### Login Flow
1. Parse PL from username
2. Lookup user by PL pattern: `WHERE UserName LIKE '%/PL;%'`
3. Compare passcode with bcrypt hash
4. Return JWT token on success

---

## 🛣️ API Endpoints

### Health & Status (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Root status check |
| GET | `/ping` | Simple ping/pong |
| GET | `/health` | Health + database check |
| GET | `/api/auth/status` | Auth routes status |

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with passcode |
| POST | `/api/auth/verify` | Verify JWT token |
| POST | `/api/auth/forgot-passcode` | Request OTP via email |
| POST | `/api/auth/verify-otp` | Verify OTP & reset passcode |
| POST | `/api/auth/resend-otp` | Resend OTP |
| POST | `/api/auth/change-passcode` | Change passcode (authenticated) |
| POST | `/api/auth/reset-passcode` | Reset passcode (authenticated) |

### Protected Data (JWT Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Full financial summary |
| GET | `/api/account-summary` | Compact financial overview |
| GET | `/api/profile` | Personal profile data |
| GET | `/api/loan-portfolio` | Full loan portfolio |

---

## 📊 Data Endpoints Detail

### Dashboard / Account Summary Response
```json
{
  "success": true,
  "data": {
    "shares": 150000,
    "ordinarySavings": 50000,
    "refundAccount": 25000,
    "rssAccount": 10000,
    "commodityAccount": 5000,
    "developmentLevy": 2000,
    "loans": 30000,
    "totalAssets": 235000,
    "totalLiability": 35000,
    "netBalance": 200000
  }
}
```

### Profile Response
```json
{
  "success": true,
  "data": {
    "title": "Mr",
    "surname": "Doe",
    "otherNames": "John",
    "dateOfBirth": "1985-05-15T00:00:00.000Z",
    "sex": "M",
    "email": "john.doe@example.com",
    "phone": "08012345678",
    "mda": "Academic",
    "nokName": "Jane Doe",
    "nokPhone": "08087654321"
  }
}
```

### Loan Portfolio Response
```json
{
  "success": true,
  "data": [
    {
      "loanType": "Emergency Loan",
      "loanTypeRate": 5,
      "loanPurpose": "Medical bills",
      "amountRequested": 100000,
      "amountApproved": 100000,
      "totalLoanAmount": 115000,
      "totalInterest": 15000,
      "monthlyInterestRate": 2.5,
      "monthlyRepaymentAmount": 9583.33,
      "paymentDurationMonths": 12,
      "amountPaidToDate": 57500,
      "currentOutstandingBalance": 57500,
      "nextInterestBalance": 1437.5,
      "loanStatus": "ACTIVE",
      "transactionDate": "2025-06-15T00:00:00.000Z",
      "lastTransactionDate": "2026-01-01T00:00:00.000Z",
      "completionDate": null
    }
  ]
}
```

---

## 🗄️ Database Tables

| Table | Purpose |
|-------|---------|
| `Internetclients` | User authentication (Passcode, OTP) |
| `Pix_Table` | Financial balances (shares, savings, loans) |
| `Individual_Personal_Data_Table` | Member profile data |
| `Loan_Record_Table` | Loan records |
| `Loan_Reducing_Balance_Analysis_Table` | Loan balance tracking |
| `Loan_Types_Table` | Loan type definitions |

---

## 🔒 Security Features

- **HTTPS Only** - All traffic encrypted
- **Parameterized Queries** - SQL injection prevention
- **bcrypt Hashing** - Passcodes hashed with 12 salt rounds
- **JWT Authentication** - 24-hour token expiry
- **Rate Limiting** - 100 requests/15min (10 for auth)
- **Brute Force Protection** - Account lockout after 5 failed attempts
- **OTP Rate Limiting** - 3 OTP requests/hour
- **Helmet Security Headers** - XSS, clickjacking protection
- **CORS Configuration** - Whitelisted origins only

---

## ⚙️ Environment Variables

Create a `.env` file:

```env
# Server
PORT=3000
NODE_ENV=production

# Database (MSSQL)
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_SERVER=your_server.com
DB_NAME=your_database
DB_PORT=1433
DB_ENCRYPT=true
DB_TRUST_CERT=false
DB_POOL_MAX=10
DB_POOL_MIN=0

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=24h

# Email (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=noreply@yourdomain.com

# CORS
CORS_ORIGIN=https://yourdomain.com
```

---

## 🚀 Installation & Running

### Prerequisites
- Node.js 18+
- Access to MSSQL database
- Resend API key (for emails)

### Install
```bash
npm install
```

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### With PM2
```bash
pm2 start ecosystem.config.js
```

---

## 🧪 Testing Endpoints

### Health Check
```bash
curl http://localhost:3000/health
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "TI9875/2432", "passcode": "your_passcode"}'
```

### Get Dashboard (with token)
```bash
curl http://localhost:3000/api/dashboard \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| express | Web framework |
| mssql | MSSQL database driver |
| bcryptjs | Password hashing |
| jsonwebtoken | JWT authentication |
| dotenv | Environment variables |
| cors | Cross-origin requests |
| helmet | Security headers |
| compression | Response compression |
| express-rate-limit | Rate limiting |
| resend | Email service |
| winston | Logging |

---

## 📝 API Response Format

### Success
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "message": "Error description"
}
```

---

## 🛡️ Important Rules

1. **READ-ONLY** - This API never modifies financial records
2. **PL from JWT Only** - Member identity comes from `req.user.pl`, never from request params
3. **No Raw DB Columns** - Response field names are transformed
4. **Numbers Only** - Financial values are always numbers, not strings
5. **Parameterized Queries** - All SQL uses parameters, never string concatenation

---

## 📄 License

Private - FCMCS Cooperative Society

---

## 👨‍💻 Maintainers

- Backend API Development Team
- FCMCS IT Department
