# Quick Start: Resume Your Failed Export

Your export failed after processing **107,500 customers**. Here's how to resume it:

## Step 1: Run Migration (One-Time)

If you have an existing database, add the new column:

```bash
cd /Volumes/anh.nguyen/Projects/AnhN/shopify-interactive
node migrate-db.js
```

Expected output:
```
🔄 Database Migration Script
Adding last_cursor column to export_jobs table...
✅ Migration completed successfully!
```

## Step 2: Resume the Export

### Option A: Via API (Recommended if server is running)

```bash
curl -X POST http://localhost:3000/api/export/evisu-us/resume \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'
```

### Option B: Via CLI

```bash
npm run export -- resume evisu-us
```

## Step 3: Monitor Progress

```bash
# Check status
curl http://localhost:3000/api/status/evisu-us | jq

# Or watch it update every 5 seconds
watch -n 5 'curl -s http://localhost:3000/api/status/evisu-us | jq'
```

## What to Expect

```
Starting to fetch customers for evisu-us (resuming from cursor, 107500 already processed)
Batch 431: Saved 250 customers (Total: 107750)
Batch 432: Saved 250 customers (Total: 108000)
Batch 433: Saved 250 customers (Total: 108250)
...
```

The export will continue until all customers are fetched.

## After Completion

Check the final status:

```bash
curl http://localhost:3000/api/status/evisu-us | jq
```

Should show:
```json
{
  "storeName": "evisu-us",
  "isExporting": false,
  "customerCount": 280000,
  "latestJob": {
    "status": "completed",
    "processedCustomers": 280000
  }
}
```

If you included `"exportCsv": true`, check for the CSV file:

```bash
ls -lh exports/
```

---

**Need Help?** See `RESUME-EXPORT-GUIDE.md` for detailed documentation.

