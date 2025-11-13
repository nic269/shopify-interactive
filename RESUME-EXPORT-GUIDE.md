# Resume Export Guide

This guide explains how to resume a failed export from where it left off, saving time and avoiding duplicate work.

## What's New

The export service now saves its progress after every batch of customers. If an export fails, you can resume from the last successfully processed batch instead of starting over.

### How It Works

1. **Automatic Progress Saving**: After each batch of 250 customers is saved to the database, the system stores:
   - Number of customers processed
   - Pagination cursor (the "bookmark" for where to continue)

2. **Resume from Last Position**: When you resume, the export:
   - Picks up from the last saved cursor
   - Continues adding to the same job record
   - Accumulates the total customer count

3. **No Duplicate Data**: Because each customer has a unique ID, resuming won't create duplicates in the database.

## Prerequisites

If you have an existing database from before this feature was added, run the migration:

```bash
node migrate-db.js
```

This adds the `last_cursor` column to your `export_jobs` table. If you get an error saying the column already exists, that's fine - you can proceed.

## Resuming via API

### Method 1: Resume Latest Failed Job (Automatic)

```bash
curl -X POST http://localhost:3000/api/export/evisu-us/resume \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": false}'
```

**What it does:**
- Automatically finds the most recent failed export for the store
- Validates it has a saved cursor
- Resumes from that position

**Response:**
```json
{
  "message": "Export resumed",
  "storeName": "evisu-us",
  "jobId": "export_evisu-us_1763017706706",
  "resumedFrom": 107500,
  "status": "Export running in background. Use /api/status/:storeName to check progress."
}
```

### Method 2: Resume Specific Job (Manual)

If you have multiple failed jobs, you can specify which one:

```bash
curl -X POST http://localhost:3000/api/export/evisu-us/resume \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "export_evisu-us_1763017706706",
    "exportCsv": false
  }'
```

### Optional: Export to CSV After Resume

Add `"exportCsv": true` to generate a CSV file after the export completes:

```bash
curl -X POST http://localhost:3000/api/export/evisu-us/resume \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'
```

## Resuming via CLI

### Simple Resume

Resume the latest failed export:

```bash
npm run export -- resume evisu-us
```

**Output:**
```
🔄 Looking for failed export to resume for evisu-us...

Found failed job: export_evisu-us_1763017706706
Previously processed: 107,500 customers
Error: Invalid response from Shopify API

📥 Resuming export...

Batch 431: Saved 250 customers (Total: 107750)
Batch 432: Saved 250 customers (Total: 108000)
...

✅ Success! Export completed
Total customers: 280,000
Job ID: export_evisu-us_1763017706706
```

## Checking Resume Status

Use the status endpoint to monitor progress:

```bash
curl http://localhost:3000/api/status/evisu-us
```

**Response during resume:**
```json
{
  "storeName": "evisu-us",
  "isExporting": true,
  "customerCount": 110000,
  "latestJob": {
    "id": "export_evisu-us_1763017706706",
    "storeName": "evisu-us",
    "status": "in_progress",
    "totalCustomers": 0,
    "processedCustomers": 110000,
    "startedAt": "2025-11-13T07:08:26.706Z",
    "completedAt": null,
    "error": null,
    "csvFilePath": null,
    "lastCursor": "eyJsYXN0X2lkIjo3..."
  }
}
```

## Viewing Export History

See all recent exports (including failed ones) for a store:

```bash
curl http://localhost:3000/api/history/evisu-us?limit=10
```

This shows:
- Job IDs
- Status (pending, in_progress, completed, failed)
- Customers processed
- Error messages (if failed)
- Whether a cursor is available for resume

## Error Handling

### "No failed job found to resume"

**Cause:** There are no failed exports for this store.

**Solution:** Start a new export instead:
```bash
curl -X POST http://localhost:3000/api/export/evisu-us
```

### "Job has no saved cursor to resume from"

**Cause:** The export failed before processing any batches (e.g., configuration error).

**Solution:** The cursor is only saved after the first successful batch. Start a new export to try again:
```bash
curl -X POST http://localhost:3000/api/export/evisu-us
```

### "Export already in progress for this store"

**Cause:** Another export or resume is currently running.

**Solution:** Wait for it to complete, or restart the server to clear the lock.

## Technical Details

### What Gets Saved

After each successful batch:
```sql
UPDATE export_jobs SET
  processed_customers = 107500,
  last_cursor = 'eyJsYXN0X2lkIjo3NTA...'
WHERE id = 'export_evisu-us_1763017706706'
```

### Database Schema

The `export_jobs` table now includes:

```sql
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY,
  store_name TEXT NOT NULL,
  status TEXT NOT NULL,
  total_customers INTEGER DEFAULT 0,
  processed_customers INTEGER DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  csv_file_path TEXT,
  last_cursor TEXT  -- NEW: For resume support
);
```

### Cursor Format

The cursor is an opaque string provided by Shopify's GraphQL API. It represents a specific position in the paginated results. Example:

```
eyJsYXN0X2lkIjo3NTAwMDAwMDAwLCJsYXN0X3ZhbHVlIjoiNzUwMDAwMDAwMCJ9
```

When the export completes successfully, the cursor is cleared (`NULL` in database).

## Best Practices

1. **Monitor Progress**: Check `/api/status/:storeName` periodically during long exports

2. **Keep Server Running**: Use Docker or a process manager (systemd, pm2) to ensure the server stays up

3. **Resume Quickly**: If an export fails, resume it as soon as possible while the cursor is still valid

4. **Backup Before Major Changes**: Back up your database before running migrations:
   ```bash
   cp data/customers.db data/backup-$(date +%Y%m%d).db
   ```

5. **CSV Export After Complete**: Only generate CSV after the full export succeeds to avoid partial data files

## Example: Your Failed Export

Based on your status response, here's how to resume:

**Your situation:**
- Store: `evisu-us`
- Job ID: `export_evisu-us_1763017706706`
- Processed: 107,500 customers
- Status: failed
- Error: "Invalid response from Shopify API"

**To resume:**

```bash
# Via API
curl -X POST http://localhost:3000/api/export/evisu-us/resume \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'

# Or via CLI
npm run export -- resume evisu-us
```

The export will start from customer 107,501 and continue until all customers are fetched.

## Troubleshooting

### Check if migration is needed

```bash
sqlite3 data/customers.db "PRAGMA table_info(export_jobs);" | grep last_cursor
```

If you see output, the column exists. If not, run `node migrate-db.js`.

### View failed job details

```bash
sqlite3 data/customers.db "SELECT * FROM export_jobs WHERE status='failed' ORDER BY started_at DESC LIMIT 1;"
```

### Reset a failed job (advanced)

If you want to start fresh but keep the processed customers:

```sql
-- Mark job as completed (so a new job will be created)
UPDATE export_jobs 
SET status = 'completed', 
    completed_at = datetime('now'),
    last_cursor = NULL
WHERE id = 'export_evisu-us_1763017706706';
```

Then start a new export. It will fetch all customers again but won't create duplicates.

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/export/:storeName` | Start new export |
| POST | `/api/export/:storeName/resume` | Resume failed export |
| GET | `/api/status/:storeName` | Check export status |
| GET | `/api/history/:storeName` | View export history |
| GET | `/api/job/:jobId` | Get specific job details |

## Questions?

Check the main README.md or PRODUCT-REQUIREMENTS.md for more details about the export service.

