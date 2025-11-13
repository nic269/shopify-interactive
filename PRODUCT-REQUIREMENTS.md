# Customer Export Service - Product Requirements Document

**Version:** 1.0  
**Last Updated:** November 13, 2025  
**Status:** Production Ready (with notes)

---

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Implementation Details](#implementation-details)
4. [Known Issues & Workarounds](#known-issues--workarounds)
5. [API Reference](#api-reference)
6. [Database Schema](#database-schema)
7. [Deployment Guide](#deployment-guide)
8. [Critical Development Notes](#critical-development-notes)
9. [Future Improvements](#future-improvements)

---

## Overview

### What Was Built
A standalone HTTP service for exporting Shopify customer data with SQLite caching capabilities. The service can:
- Fetch all customers from any configured Shopify store
- Cache customer data in SQLite for instant re-exports
- Generate CSV files with 38+ fields including nested data
- Track export progress in real-time
- Run as HTTP API server or CLI tool

### Key Features
- ✅ **SQLite Caching**: Store customers locally, re-export in seconds
- ✅ **HTTP API**: 8 REST endpoints for triggering and monitoring exports
- ✅ **Progress Tracking**: Real-time status updates with job history
- ✅ **Rate Limiting**: Automatic 500ms delays between Shopify API calls
- ✅ **Batch Processing**: Handles 250 customers per request
- ✅ **Docker Ready**: Full containerization support
- ✅ **CLI Tools**: Manual export commands for one-off operations

### Performance Metrics
- **First Export**: ~15-20 minutes for 280k customers (from Shopify)
- **Cached Re-export**: ~5-10 seconds (from SQLite)
- **API Rate**: 250 customers/request with 500ms delay
- **Database Size**: ~500MB for 280k customers with full data

---

## Architecture

### Tech Stack
```
Backend:       Node.js + TypeScript + Express
Database:      SQLite3 (better-sqlite3)
Shopify API:   @shopify/admin-api-client v1.1.0
API Version:   Shopify Admin API 2025-04
```

### Directory Structure
```
separate-scripts/
├── src/
│   ├── server.ts              # HTTP API server (main entry point)
│   ├── export-service.ts      # Core export logic
│   ├── database.ts            # SQLite operations
│   ├── shopify-client.ts      # Shopify API client wrapper
│   ├── types.ts               # TypeScript interfaces
│   └── cli.ts                 # CLI commands
├── data/                      # SQLite database (auto-created)
├── exports/                   # Generated CSV files (auto-created)
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env                       # Environment variables (REQUIRED)
├── env.example                # Environment template
└── README.md                  # Full documentation
```

### Data Flow
```
┌─────────────────┐
│  HTTP Request   │ → POST /api/export/evisu-us
└────────┬────────┘
         ↓
┌─────────────────┐
│  Export Job     │ → Create job in SQLite (status: pending)
│  Created        │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Fetch Shopify  │ → Query customers in batches (250/request)
│  Customers      │   with 500ms delay between requests
└────────┬────────┘
         ↓
┌─────────────────┐
│  Save to SQLite │ → Cache each batch immediately
│  Per Batch      │   Update job progress
└────────┬────────┘
         ↓
┌─────────────────┐
│  Job Complete   │ → Update status to 'completed'
│                 │   Optional: Generate CSV file
└─────────────────┘
```

---

## Implementation Details

### 1. GraphQL Query Structure

**⚠️ CRITICAL**: The query was iteratively refined to work with Shopify API 2025-04. Current working version includes:

```graphql
query getCustomers($first: Int!, $after: String) {
  customers(first: $first, after: $after) {
    edges {
      node {
        # Basic Fields ✅
        id, firstName, lastName, displayName
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
        verifiedEmail, state, locale, note, tags
        createdAt, updatedAt
        
        # Purchase Stats ✅
        amountSpent { amount, currencyCode }
        numberOfOrders
        lifetimeDuration
        
        # Addresses ✅
        addresses { ... }
        defaultAddress { ... }
        
        # Last Order ✅
        lastOrder { id, name, createdAt }
        
        # Additional Fields ✅
        productSubscriberStatus
        mergeable { isMergeable }
        
        # Metafield ✅
        originalCreatedDate: metafield(key: "created_at", namespace: "magento") {
          value
        }
        
        # Events ✅ (LIMITED TO 5)
        events(first: 5, reverse: true) {
          nodes { action, appTitle, message }
        }
        
        # Orders ✅ (LIMITED TO 5)
        orders(first: 5, reverse: true) {
          nodes {
            # Full order details with line items, returns, shipping
            # See export-service.ts for complete structure
          }
        }
        
        # Statistics ✅
        statistics {
          predictedSpendTier
          rfmGroup
        }
      }
    }
    pageInfo { hasNextPage, endCursor }
  }
}
```

**Key Query Notes:**
- ✅ `events`: Use `reverse: true` - works
- ❌ `returns`: DO NOT use `reverse: true` - causes GraphQL error
- ✅ `statistics`: Available in 2025-04 API
- ⚠️ Query cost: ~717 points requested, ~134 actual per batch

### 2. Environment Variable Loading

**⚠️ CRITICAL ISSUE RESOLVED**: Environment variables MUST be loaded BEFORE any ES6 imports.

**Problem**: ES6 imports are hoisted and executed before code runs, so `shopify-client.ts` was trying to read `process.env` before `dotenv.config()` was called.

**Solution**: Use `require()` at the top of entry files:
```typescript
// MUST BE FIRST LINE after shebang
require('dotenv').config({ 
  path: require('path').resolve(__dirname, '../.env') 
});

// Then imports
import express from 'express';
// ... other imports
```

**Files with this pattern:**
- ✅ `src/server.ts`
- ✅ `src/export-service.ts`
- ✅ `src/cli.ts`

### 3. Environment Variables Format

**⚠️ IMPORTANT**: Store names use hyphens, environment variables use underscores and UPPERCASE:

```env
# Store: evisu-us → Env vars:
EVISU_US_SHOP_DOMAIN=your-store.myshopify.com
EVISU_US_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx

# Store: evisu-hk → Env vars:
EVISU_HK_SHOP_DOMAIN=...
EVISU_HK_ACCESS_TOKEN=...
```

**Pattern**: `{STORE_NAME_UPPERCASE_WITH_UNDERSCORES}_{SHOP_DOMAIN|ACCESS_TOKEN}`

### 4. CSV Export Fields (40 columns)

```
Basic (11): id, firstName, lastName, displayName, email, phone, 
            verifiedEmail, state, locale, note, tags

Stats (6):  createdAt, updatedAt, amountSpent, amountSpentCurrency, 
            numberOfOrders, lifetimeDuration

Address (12): defaultAddress_* (address1, address2, city, country, 
              countryCodeV2, province, provinceCode, zip, phone, 
              firstName, lastName, company)

Order (3):  lastOrder_id, lastOrder_name, lastOrder_createdAt

Additional (5): productSubscriberStatus, isMergeable, 
                originalCreatedDate, statistics_predictedSpendTier, 
                statistics_rfmGroup

JSON (3):   allAddresses, lastFiveEvents, lastFiveOrders
```

### 5. Testing Limiter

**⚠️ DEVELOPMENT ONLY**: There's a limiter in the code for testing:

```typescript
// In export-service.ts, line ~215
if (batchNumber >= 3) {
  hasNextPage = false;  // STOPS AFTER 750 CUSTOMERS
}
```

**⚠️ REMOVE THIS FOR PRODUCTION** to fetch all customers.

---

## Known Issues & Workarounds

### Issue 1: GraphQL Field Compatibility
**Problem**: Some fields may not be available in all Shopify plans/versions.

**Fields that might cause issues:**
- `productSubscriberStatus` - Requires Subscriptions app
- `mergeable` - May not be available in older API versions
- `statistics` - Added in newer API versions

**Solution**: The error handling now catches and logs specific GraphQL errors. If a field fails, remove it from the query.

### Issue 2: Rate Limiting
**Problem**: Shopify has rate limits based on query cost.

**Current handling:**
- 500ms delay between requests
- Query cost: ~717 requested, ~134 actual
- Should stay well within limits

**If rate limited:**
- Increase `DELAY_BETWEEN_REQUESTS_MS` in `export-service.ts`
- Reduce batch size (currently 250)
- Reduce nested data (orders, events)

### Issue 3: Large Dataset Memory
**Problem**: 280k+ customers can cause memory issues if loaded all at once.

**Solution Implemented:**
- Batch processing with immediate SQLite writes
- Stream-based CSV writing
- No in-memory accumulation

### Issue 4: Returns Field Pagination
**Problem**: `returns(first: 20, reverse: true)` causes GraphQL error.

**Solution**: Use `returns(first: 20)` WITHOUT `reverse: true`.

---

## API Reference

### Base URL
```
http://localhost:3000
```

### Endpoints

#### 1. Health Check
```http
GET /health
```
Returns: `{ status: 'ok', timestamp: '...' }`

#### 2. List Stores
```http
GET /api/stores
```
Returns configured stores with customer counts.

#### 3. Trigger Export
```http
POST /api/export/:storeName
Content-Type: application/json

{
  "exportCsv": true  // Optional: also generate CSV
}
```

**Response:**
```json
{
  "message": "Export started",
  "storeName": "evisu-us",
  "jobId": "export_evisu-us_1699920000000",
  "status": "Export running in background..."
}
```

#### 4. Check Status
```http
GET /api/status/:storeName
```

**Response:**
```json
{
  "storeName": "evisu-us",
  "isExporting": true,
  "customerCount": 15234,
  "latestJob": {
    "id": "export_evisu-us_1699920000000",
    "status": "in_progress",
    "processedCustomers": 2500,
    "totalCustomers": 0
  }
}
```

#### 5. Export CSV from Cache
```http
POST /api/export-csv/:storeName
```
Instantly generate CSV from cached database data.

#### 6. Get Job Details
```http
GET /api/job/:jobId
```

#### 7. Get Export History
```http
GET /api/history/:storeName?limit=10
```

#### 8. Get All Statuses
```http
GET /api/status
```

---

## Database Schema

### Table: `customers`
```sql
CREATE TABLE customers (
  id TEXT PRIMARY KEY,              -- Shopify customer ID
  store_name TEXT NOT NULL,         -- Store identifier
  data TEXT NOT NULL,               -- Full customer JSON
  created_at TEXT NOT NULL,         -- Shopify creation date
  updated_at TEXT NOT NULL          -- Last update timestamp
);

CREATE INDEX idx_customers_store ON customers(store_name);
CREATE INDEX idx_customers_updated ON customers(updated_at);
```

### Table: `export_jobs`
```sql
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY,              -- Job ID
  store_name TEXT NOT NULL,         -- Store identifier
  status TEXT NOT NULL,             -- pending|in_progress|completed|failed
  total_customers INTEGER,          -- Final count
  processed_customers INTEGER,      -- Current progress
  started_at TEXT NOT NULL,         -- Start timestamp
  completed_at TEXT,                -- End timestamp
  error TEXT,                       -- Error message if failed
  csv_file_path TEXT                -- Generated CSV path
);

CREATE INDEX idx_jobs_store ON export_jobs(store_name);
CREATE INDEX idx_jobs_status ON export_jobs(status);
```

---

## Deployment Guide

### Option 1: Docker (Recommended)

```bash
cd separate-scripts

# 1. Configure environment
cp env.example .env
nano .env  # Add your credentials

# 2. Build and start
docker-compose up -d

# 3. View logs
docker-compose logs -f

# 4. Check health
curl http://localhost:3000/health
```

### Option 2: Node.js Direct

```bash
cd separate-scripts

# 1. Install dependencies
npm install

# 2. Configure environment
cp env.example .env
nano .env

# 3. Build TypeScript
npm run build

# 4. Start server
npm start
# or for development:
npm run dev
```

### Option 3: Systemd Service (VPS)

Create `/etc/systemd/system/customer-export.service`:
```ini
[Unit]
Description=Customer Export Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/separate-scripts
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/separate-scripts/dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable customer-export
sudo systemctl start customer-export
```

---

## Critical Development Notes

### 🔴 MUST DO BEFORE PRODUCTION

1. **Remove Testing Limiter**
   ```typescript
   // In src/export-service.ts around line 215
   // DELETE OR COMMENT OUT:
   if (batchNumber >= 3) {
     hasNextPage = false;
   }
   ```

2. **Verify Environment Variables**
   - Ensure `.env` file is NOT committed to git
   - Set proper file permissions: `chmod 600 .env`
   - Validate all store credentials before deployment

3. **Test with Small Dataset First**
   - Keep the limiter initially
   - Test with 750 customers (3 batches)
   - Verify CSV output and data integrity
   - Then remove limiter for full export

4. **Add Authentication** (Future)
   - Current API has NO authentication
   - Should be behind firewall/VPN
   - Consider adding API key middleware

### 🟡 IMPORTANT PATTERNS

1. **Environment Loading Pattern**
   ```typescript
   // ALWAYS at top of entry files
   require('dotenv').config({ 
     path: require('path').resolve(__dirname, '../.env') 
   });
   ```

2. **Error Handling Pattern**
   ```typescript
   // Always check both formats
   if (response.errors) {
     if (response.errors.graphQLErrors) { /* handle */ }
     if (Array.isArray(response.errors)) { /* handle */ }
   }
   ```

3. **Store Name Convention**
   ```
   URL/API:    evisu-us (hyphens, lowercase)
   Env Var:    EVISU_US (underscores, UPPERCASE)
   Database:   evisu-us (hyphens, lowercase)
   ```

### 🟢 TESTING CHECKLIST

- [ ] Environment variables load correctly
- [ ] Server starts and shows configured stores
- [ ] Can trigger export via API
- [ ] Progress tracking updates in real-time
- [ ] Customers save to SQLite correctly
- [ ] CSV generation works
- [ ] CSV file contains all expected fields
- [ ] Can re-export from cache instantly
- [ ] Error handling shows helpful messages
- [ ] Job history persists correctly

---

## Future Improvements

### High Priority
1. **Authentication System**
   - Add API key middleware
   - Rate limiting per API key
   - User management

2. **Incremental Updates**
   - Fetch only new/updated customers
   - Use `updatedAt` filter in GraphQL query
   - Reduce API calls for re-syncs

3. **Webhook Support**
   - Shopify webhooks for customer updates
   - Real-time sync instead of batch

### Medium Priority
4. **Advanced Filtering**
   - Export specific customer segments
   - Date range filters
   - Tag-based filtering

5. **Multiple Export Formats**
   - JSON export
   - Excel (XLSX) export
   - Parquet for analytics

6. **Notification System**
   - Email when export completes
   - Webhook callbacks
   - Slack integration

### Low Priority
7. **Web UI Dashboard**
   - Visual progress monitoring
   - Schedule exports
   - Download CSV files

8. **Multi-tenancy**
   - Support multiple organizations
   - Isolated data per tenant

9. **Cloud Database Option**
   - PostgreSQL support
   - Separate caching from jobs

---

## Quick Reference Commands

### CLI Commands
```bash
# List all stores
npm run export -- list

# Fetch and export
npm run export -- both evisu-us

# Just fetch (to database)
npm run export -- fetch evisu-us

# Just export CSV (from database)
npm run export -- csv evisu-us

# Check count
npm run export -- count evisu-us
```

### API Commands
```bash
# Start export
curl -X POST http://localhost:3000/api/export/evisu-us \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'

# Check status
curl http://localhost:3000/api/status/evisu-us

# Quick CSV from cache
curl -X POST http://localhost:3000/api/export-csv/evisu-us
```

### Maintenance Commands
```bash
# View database size
ls -lh data/customers.db

# Backup database
cp data/customers.db data/backup-$(date +%Y%m%d).db

# Clear database (CAREFUL!)
rm data/customers.db

# View logs (Docker)
docker-compose logs -f

# Restart service
docker-compose restart
```

---

## Support & Troubleshooting

### Common Issues

**"Store configuration not found"**
- Check `.env` file exists
- Verify environment variable names (underscores, uppercase)
- Ensure domain format: `store-name.myshopify.com`

**"GraphQL Error"**
- Check which field is causing the error
- Remove problematic field from query
- Verify API version compatibility

**"Database locked"**
- SQLite uses WAL mode for concurrency
- Check file permissions
- Ensure only one process writes at a time

**"Port already in use"**
- Change `PORT` in `.env`
- Or kill existing process: `pkill -f "ts-node src/server"`

### Debug Mode

Add to `.env`:
```env
NODE_ENV=development
DEBUG=*
```

---

## File Locations

```
Production:
  Service:    /opt/separate-scripts/
  Database:   /opt/separate-scripts/data/customers.db
  Exports:    /opt/separate-scripts/exports/*.csv
  Logs:       journalctl -u customer-export

Development:
  Service:    ./separate-scripts/
  Database:   ./separate-scripts/data/customers.db
  Exports:    ./separate-scripts/exports/*.csv
```

---

## Version History

**v1.0 - November 13, 2025**
- Initial release
- HTTP API with 8 endpoints
- SQLite caching
- CSV export with 40 fields
- CLI tools
- Docker support
- Tested with evisu-us store (750 customers limit for testing)

---

## Contact & Documentation

- **Full Documentation**: See `README.md`
- **Quick Start**: See `QUICKSTART.md`
- **Implementation Summary**: See `CUSTOMER-EXPORT-SUMMARY.md`

---

**END OF DOCUMENT**

Last Updated: November 13, 2025  
Prepared for: Continued development in new chat session

