# Resume Export Implementation Summary

**Date:** November 13, 2025  
**Feature:** Resume Failed Exports from Last Position

## Overview

Implemented a comprehensive resume functionality that allows failed exports to continue from where they left off, instead of starting from the beginning. This saves significant time and API quota when exporting large datasets.

## Changes Made

### 1. Database Schema Update

**File:** `src/database.ts`

Added `last_cursor` column to the `export_jobs` table:

```sql
ALTER TABLE export_jobs ADD COLUMN last_cursor TEXT;
```

**Migration Script:** Created `migrate-db.js` to update existing databases.

### 2. TypeScript Types

**File:** `src/types.ts`

Updated `ExportJob` interface:

```typescript
export interface ExportJob {
  // ... existing fields
  lastCursor?: string; // NEW: For resuming failed exports
}
```

### 3. Database Operations

**File:** `src/database.ts`

Updated all database functions to handle the new `lastCursor` field:

- `createExportJob()` - Schema includes last_cursor
- `updateExportJob()` - Can update last_cursor
- `getExportJob()` - Returns last_cursor
- `getExportJobsByStore()` - Returns last_cursor
- `getLatestExportJob()` - Returns last_cursor

### 4. Export Service Enhancement

**File:** `src/export-service.ts`

Modified `fetchAndSaveCustomers()` function:

**Signature Change:**
```typescript
// Before
async function fetchAndSaveCustomers(
  storeName: string,
  jobId?: string
)

// After
async function fetchAndSaveCustomers(
  storeName: string,
  jobId?: string,
  startCursor?: string  // NEW: Starting position for resume
)
```

**Key Changes:**

1. **Accept Starting Cursor:**
   ```typescript
   let cursor: string | null = startCursor || null;
   let totalCustomers = job?.processedCustomers || 0;
   ```

2. **Save Cursor After Each Batch:**
   ```typescript
   updateExportJob(exportJobId, {
     processedCustomers: totalCustomers,
     lastCursor: nextCursor, // Save for resume
   });
   ```

3. **Clear Cursor on Success:**
   ```typescript
   updateExportJob(exportJobId, {
     status: 'completed',
     lastCursor: undefined, // Clear on success
   });
   ```

4. **Preserve Cursor on Failure:**
   ```typescript
   // On error, cursor remains from last successful batch
   updateExportJob(exportJobId, {
     status: 'failed',
     // lastCursor is already saved from last batch
   });
   ```

### 5. HTTP API Endpoint

**File:** `src/server.ts`

Added new endpoint: `POST /api/export/:storeName/resume`

**Features:**
- Automatically finds latest failed job if no jobId provided
- Validates job has a cursor to resume from
- Validates job status is 'failed'
- Runs resume in background
- Returns immediate response with job info

**Request:**
```json
{
  "jobId": "export_evisu-us_1763017706706",  // Optional
  "exportCsv": true                           // Optional
}
```

**Response:**
```json
{
  "message": "Export resumed",
  "storeName": "evisu-us",
  "jobId": "export_evisu-us_1763017706706",
  "resumedFrom": 107500,
  "status": "Export running in background..."
}
```

**Error Responses:**

1. No failed job found:
   ```json
   {
     "error": "No failed job found to resume",
     "storeName": "evisu-us",
     "hint": "Use POST /api/export/:storeName to start a new export"
   }
   ```

2. Job has no cursor:
   ```json
   {
     "error": "Job has no saved cursor to resume from",
     "jobId": "export_evisu-us_1763017706706",
     "hint": "The job may have failed before processing any batches..."
   }
   ```

3. Export already running:
   ```json
   {
     "error": "Export already in progress for this store",
     "storeName": "evisu-us"
   }
   ```

### 6. CLI Command

**File:** `src/cli.ts`

Added `resume` command:

```bash
npm run export -- resume evisu-us
```

**Features:**
- Finds latest failed job for the store
- Displays job details (ID, processed count, error)
- Validates cursor exists
- Resumes export with progress updates
- Shows completion summary

**Output Example:**
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

### 7. Documentation

Created comprehensive documentation:

1. **RESUME-EXPORT-GUIDE.md** - Complete user guide with:
   - How the feature works
   - API usage examples
   - CLI usage examples
   - Error handling
   - Troubleshooting
   - Technical details

2. **migrate-db.js** - Database migration script with:
   - Automatic detection of existing column
   - Safe migration execution
   - Clear success/error messages

## How It Works

### Flow Diagram

```
┌─────────────────────┐
│  Start Export       │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  Process Batch 1    │ → Save 250 customers
│  (250 customers)    │   Update cursor: "abc123"
└──────────┬──────────┘   
           ↓
┌─────────────────────┐
│  Process Batch 2    │ → Save 250 customers
│  (250 customers)    │   Update cursor: "def456"
└──────────┬──────────┘
           ↓
          ...
           ↓
┌─────────────────────┐
│  Process Batch 430  │ → Save 250 customers
│  (107,500 total)    │   Update cursor: "xyz789"
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  ❌ ERROR!          │ → Mark job as 'failed'
│  API Timeout        │   Preserve cursor: "xyz789"
└─────────────────────┘

        [LATER]
           ↓
┌─────────────────────┐
│  Resume Export      │ → Start from cursor: "xyz789"
│  POST /resume       │   Continue with 107,500 already done
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  Process Batch 431  │ → Save 250 more customers
│  (107,750 total)    │   Update cursor: "ghi101"
└──────────┬──────────┘
           ↓
          ...
           ↓
┌─────────────────────┐
│  ✅ Complete!       │ → Mark job as 'completed'
│  (280,000 total)    │   Clear cursor
└─────────────────────┘
```

### Key Points

1. **Cursor is Opaque**: It's provided by Shopify's GraphQL API and we treat it as a black box

2. **No Duplicates**: Customer IDs are unique, so `INSERT OR REPLACE` prevents duplicates

3. **Atomic Updates**: Each batch is saved in a transaction with cursor update

4. **Idempotent**: Can safely resume multiple times if needed

5. **Same Job ID**: Resume uses the same job record, accumulating progress

## Testing

### Test Scenario: Your Failed Export

**Initial State:**
```json
{
  "jobId": "export_evisu-us_1763017706706",
  "status": "failed",
  "processedCustomers": 107500,
  "error": "Invalid response from Shopify API",
  "lastCursor": "eyJsYXN0X2lkIjo..." // Saved from last batch
}
```

**Resume Command:**
```bash
curl -X POST http://localhost:3000/api/export/evisu-us/resume \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'
```

**Expected Behavior:**
1. ✅ Finds the failed job
2. ✅ Validates cursor exists
3. ✅ Changes status to 'in_progress'
4. ✅ Starts from customer 107,501
5. ✅ Continues fetching remaining ~172,500 customers
6. ✅ Updates progress after each batch
7. ✅ Marks as 'completed' when done
8. ✅ Clears cursor
9. ✅ Optionally generates CSV

## Installation Steps

### For Existing Installations

1. **Update Code:**
   ```bash
   git pull origin main
   ```

2. **Install Dependencies (if needed):**
   ```bash
   npm install
   ```

3. **Run Migration:**
   ```bash
   node migrate-db.js
   ```

4. **Rebuild:**
   ```bash
   npm run build
   ```

5. **Restart Service:**
   ```bash
   # Docker
   docker-compose restart
   
   # Or Node
   npm start
   ```

### For New Installations

No special steps needed - the new schema will be created automatically.

## API Changes Summary

### New Endpoint

```
POST /api/export/:storeName/resume
```

### Updated Server Startup

Shows new endpoint in console:

```
Endpoints:
  ...
  POST /api/export/:storeName/resume    - Resume failed export
  ...
```

### Status Response Enhancement

Now includes `lastCursor` field:

```json
{
  "latestJob": {
    "id": "export_evisu-us_1763017706706",
    "status": "failed",
    "processedCustomers": 107500,
    "lastCursor": "eyJsYXN0X2lkIjo..." // NEW
  }
}
```

## Files Modified

1. ✅ `src/types.ts` - Added lastCursor to ExportJob
2. ✅ `src/database.ts` - Updated schema and operations
3. ✅ `src/export-service.ts` - Added cursor handling
4. ✅ `src/server.ts` - Added resume endpoint
5. ✅ `src/cli.ts` - Added resume command

## Files Created

1. ✅ `migrate-db.js` - Database migration script
2. ✅ `RESUME-EXPORT-GUIDE.md` - User documentation
3. ✅ `IMPLEMENTATION-SUMMARY.md` - This file

## Backwards Compatibility

✅ **Fully backwards compatible**

- Existing endpoints unchanged
- Old jobs without cursor still work
- Migration is optional (for existing databases)
- New installs get updated schema automatically

## Performance Impact

- **Minimal**: One additional column in database
- **Cursor storage**: ~50-100 bytes per job
- **Update overhead**: Negligible (single field update)
- **Resume speed**: Same as regular export (no extra API calls)

## Security Considerations

- ✅ No new authentication required (uses existing setup)
- ✅ Cursor is opaque (no sensitive data)
- ✅ Same rate limiting applies to resumed exports
- ✅ Job validation prevents unauthorized resume

## Future Enhancements

Potential improvements:

1. **Auto-resume**: Automatically retry failed exports
2. **Scheduled resume**: Resume at a specific time
3. **Resume notifications**: Alert when resume completes
4. **Cursor expiration**: Handle expired cursors gracefully
5. **Partial CSV**: Generate CSV for partial exports

## Troubleshooting

### Common Issues

**Issue:** "Cannot find column last_cursor"
- **Solution:** Run `node migrate-db.js`

**Issue:** "No failed job found"
- **Check:** `curl http://localhost:3000/api/history/evisu-us`
- **Solution:** Verify job status is 'failed'

**Issue:** Resume starts from beginning
- **Check:** Database has last_cursor value
- **Solution:** Ensure migration ran successfully

## Support

For issues or questions:
1. Check `RESUME-EXPORT-GUIDE.md` for detailed usage
2. Check `PRODUCT-REQUIREMENTS.md` for system overview
3. View logs: `docker-compose logs -f`

## Next Steps

1. **Run Migration** (if existing database):
   ```bash
   node migrate-db.js
   ```

2. **Resume Your Failed Export**:
   ```bash
   curl -X POST http://localhost:3000/api/export/evisu-us/resume \
     -H "Content-Type: application/json" \
     -d '{"exportCsv": true}'
   ```

3. **Monitor Progress**:
   ```bash
   watch -n 5 'curl -s http://localhost:3000/api/status/evisu-us | json_pp'
   ```

## Success Criteria

✅ All criteria met:

- [x] Database schema updated with last_cursor
- [x] Export service saves cursor after each batch
- [x] Resume function accepts starting cursor
- [x] API endpoint validates and resumes failed jobs
- [x] CLI command provides user-friendly interface
- [x] Migration script for existing databases
- [x] Comprehensive documentation
- [x] Backwards compatible
- [x] No duplicates in database
- [x] Progress preserved across failures

---

**Implementation Complete:** Ready for use!

