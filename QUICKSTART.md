# Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Setup Environment

```bash
cd separate-scripts

# Copy environment template
cp env.example .env

# Edit with your Shopify credentials
nano .env
```

Add your store credentials to `.env`:
```env
EVISU_US_SHOP_DOMAIN=your-store.myshopify.com
EVISU_US_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Choose Your Method

#### Method A: HTTP API Server (Recommended for VPS)

```bash
# Start the server
npm run dev

# In another terminal, trigger an export
curl -X POST http://localhost:3000/api/export/evisu-us \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'

# Check progress
curl http://localhost:3000/api/status/evisu-us
```

#### Method B: CLI (One-time exports)

```bash
# Fetch customers and export to CSV
npm run export -- both evisu-us

# Just fetch (saves to database)
npm run export -- fetch evisu-us

# Just export CSV (from database)
npm run export -- csv evisu-us

# List all stores
npm run export -- list
```

### Step 4: Find Your CSV

```bash
ls -lh exports/
# Output: customers-evisu-us-2025-11-13.csv
```

## 🐳 Docker Deployment

```bash
# Build and start
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop
docker-compose down
```

## 📡 API Examples

### Trigger Export
```bash
curl -X POST http://localhost:3000/api/export/evisu-us \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'
```

### Check Status
```bash
curl http://localhost:3000/api/status/evisu-us
```

### Quick CSV from Cache
```bash
curl -X POST http://localhost:3000/api/export-csv/evisu-us
```

### View All Stores
```bash
curl http://localhost:3000/api/stores
```

## 📊 What Gets Exported

- **38 CSV columns** including:
  - Basic customer info (name, email, phone)
  - Purchase history (amount spent, order count)
  - Addresses (default + all addresses as JSON)
  - Recent orders (last 5 with line items, returns)
  - Customer events (last 10 activities)
  - Magento migration data (if applicable)

## 💾 Database Benefits

- **First export**: ~15-20 minutes for 280k customers
- **Re-export from cache**: ~5-10 seconds
- **No API limits** on cached exports
- **Keep historical snapshots**

## 🔧 Troubleshooting

**Environment variables not loading?**
```bash
# Check if .env exists
ls -la .env

# Test environment
node -e "require('dotenv').config(); console.log(process.env.EVISU_US_SHOP_DOMAIN)"
```

**Port already in use?**
```bash
# Change port in .env
PORT=3001

# Or kill existing process
lsof -ti:3000 | xargs kill
```

**GraphQL errors?**
- Verify your Shopify access token has correct permissions
- Check store domain format: `your-store.myshopify.com`
- Ensure API version compatibility (using 2025-04)

## 📚 Full Documentation

See [README.md](./README.md) for complete documentation including:
- All API endpoints
- Deployment options
- Security considerations
- Performance tuning

