# Customer Export Service

A standalone HTTP service for exporting Shopify customers to CSV with SQLite caching.

## Features

- 🚀 **HTTP API** - Trigger exports via REST endpoints
- 💾 **SQLite Caching** - Store customer data locally for quick re-exports
- 📊 **Progress Tracking** - Monitor export status in real-time
- 📦 **Batch Processing** - Handles large customer datasets (250k+ records)
- ⏱️ **Rate Limiting** - Automatic delays to respect Shopify API limits
- 🐳 **Docker Support** - Easy deployment with Docker/Docker Compose
- 📝 **CSV Export** - Generate CSV files from cached data instantly

## Quick Start

### Option 1: Docker (Recommended for Production)

```bash
# 1. Copy and configure environment variables
cp .env.example .env
# Edit .env with your Shopify credentials

# 2. Build and start the service
docker-compose up -d

# 3. Check service health
curl http://localhost:3000/health
```

### Option 2: Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment variables
cp .env.example .env
# Edit .env with your Shopify credentials

# 3. Start the development server
npm run dev
```

## API Endpoints

### 1. Health Check
```bash
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-13T00:00:00.000Z"
}
```

### 2. List Available Stores
```bash
GET /api/stores
```

**Response:**
```json
{
  "stores": [
    {
      "name": "evisu-us",
      "customerCount": 15234
    },
    {
      "name": "evisu-hk",
      "customerCount": 8421
    }
  ]
}
```

### 3. Trigger Export for a Store
```bash
POST /api/export/:storeName
Content-Type: application/json

{
  "exportCsv": true  # Optional: also generate CSV file
}
```

**Response:**
```json
{
  "message": "Export started",
  "storeName": "evisu-us",
  "jobId": "export_evisu-us_1699920000000",
  "status": "Export running in background. Use /api/status/:storeName to check progress."
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/export/evisu-us \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'
```

### 4. Check Export Status
```bash
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
    "storeName": "evisu-us",
    "status": "in_progress",
    "totalCustomers": 0,
    "processedCustomers": 2500,
    "startedAt": "2025-11-13T00:00:00.000Z",
    "completedAt": null,
    "error": null,
    "csvFilePath": null
  }
}
```

### 5. Get All Store Statuses
```bash
GET /api/status
```

### 6. Get Job Details
```bash
GET /api/job/:jobId
```

### 7. Get Export History
```bash
GET /api/history/:storeName?limit=10
```

### 8. Export to CSV from Database
```bash
POST /api/export-csv/:storeName
```

Exports cached customers to CSV without fetching from Shopify again.

**Response:**
```json
{
  "message": "CSV export completed",
  "storeName": "evisu-us",
  "filePath": "/app/exports/customers-evisu-us-2025-11-13.csv"
}
```

## Workflow

### First Time Export (Fetch from Shopify)

```bash
# 1. Trigger export with CSV generation
curl -X POST http://localhost:3000/api/export/evisu-us \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'

# 2. Monitor progress
curl http://localhost:3000/api/status/evisu-us

# 3. Wait for completion (status: "completed")
# Customers are now cached in SQLite database
# CSV file is generated in exports/ directory
```

### Quick Re-export from Cache

```bash
# Generate CSV from cached data (instant, no Shopify API calls)
curl -X POST http://localhost:3000/api/export-csv/evisu-us

# CSV file created instantly from database
```

## Configuration

### Environment Variables

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_PATH=./data/customers.db

# Shopify Stores
EVISU_US_SHOP_DOMAIN=your-store.myshopify.com
EVISU_US_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx

# Add more stores...
```

## CSV Output Fields

The CSV includes 38 columns:

### Basic Information
- id, firstName, lastName, displayName
- email, phone, verifiedEmail
- state, locale, note, tags

### Dates & Stats
- createdAt, updatedAt
- amountSpent, amountSpentCurrency
- numberOfOrders, lifetimeDuration

### Default Address (12 fields)
- defaultAddress_address1, defaultAddress_address2, etc.

### Last Order
- lastOrder_id, lastOrder_name, lastOrder_createdAt

### Additional Fields
- productSubscriberStatus, isMergeable, originalCreatedDate

### JSON Data
- allAddresses - Full address history
- allEvents - Customer events (up to 10)
- allOrders - Recent orders (up to 5) with line items, returns, etc.

## Performance

### For 280,000 Customers

**First Export (from Shopify):**
- Time: ~15-20 minutes
- API Requests: ~1,120 (250 customers per request)
- Rate Limiting: 500ms delay between requests
- Result: Saved to SQLite database + CSV file

**Re-export from Cache:**
- Time: ~5-10 seconds
- API Requests: 0 (uses local database)
- Result: New CSV file generated instantly

## Database

### SQLite Tables

**customers**
- Stores customer data as JSON
- Indexed by store_name and updated_at

**export_jobs**
- Tracks export history and status
- Useful for monitoring and debugging

### Database Location

- Development: `./data/customers.db`
- Docker: `/app/data/customers.db` (persisted via volume)

## Deployment

### VPS Deployment

```bash
# 1. Clone/copy the separate-scripts folder to your VPS
scp -r separate-scripts user@your-vps:/opt/

# 2. SSH into VPS
ssh user@your-vps

# 3. Navigate to directory
cd /opt/separate-scripts

# 4. Configure environment
cp .env.example .env
nano .env  # Add your Shopify credentials

# 5. Start with Docker Compose
docker-compose up -d

# 6. Check logs
docker-compose logs -f

# 7. Verify service
curl http://localhost:3000/health
```

### Systemd Service (Alternative to Docker)

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

```bash
# Enable and start service
sudo systemctl enable customer-export
sudo systemctl start customer-export
sudo systemctl status customer-export
```

## Monitoring

### Check Service Status
```bash
curl http://localhost:3000/api/status
```

### View Logs (Docker)
```bash
docker-compose logs -f
```

### Check Database Size
```bash
ls -lh data/customers.db
```

## Backup

### Backup Database
```bash
# Copy SQLite database
cp data/customers.db data/customers.db.backup

# Or with Docker
docker cp customer-export_customer-export_1:/app/data/customers.db ./backup/
```

### Backup Exports
```bash
# Archive all CSV files
tar -czf exports-backup-$(date +%Y%m%d).tar.gz exports/
```

## Troubleshooting

### Export Fails with "undefined" domain error
- Check .env file exists and has correct variable names
- Verify environment variables are loaded (check logs)
- Ensure store name uses hyphens (evisu-us not evisu_us)

### GraphQL Errors
- Check Shopify API credentials
- Verify API access token has correct permissions
- Check API version compatibility (currently using 2025-04)

### Database locked errors
- SQLite uses WAL mode for concurrent access
- If issues persist, check file permissions
- Ensure only one process writes at a time

### Port already in use
- Change PORT in .env file
- Or stop existing service: `docker-compose down`

## Security

- ⚠️ This service has no authentication - use behind a firewall/VPN
- Store .env file securely with appropriate file permissions (chmod 600)
- Don't commit .env to version control
- Consider adding API key authentication for production use

## License

MIT

