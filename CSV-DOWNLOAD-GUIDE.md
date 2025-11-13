# CSV Download Guide

This guide explains how to download CSV files after they've been exported.

## Quick Start

After an export completes with CSV generation, you can download the file in several ways:

### Method 1: Download Latest CSV (Easiest)

```bash
# In browser, just visit:
http://localhost:3000/api/download-csv/evisu-us/latest

# Or with curl:
curl -O -J http://localhost:3000/api/download-csv/evisu-us/latest
```

The `-O` flag saves the file with its original name, and `-J` respects the filename from the server.

### Method 2: Download by Job ID

If you know the job ID:

```bash
curl -O -J http://localhost:3000/api/download-csv/job/export_evisu-us_1763017706706
```

### Method 3: List All CSV Files First

See all available CSV files for a store:

```bash
curl http://localhost:3000/api/csv-files/evisu-us | jq
```

**Response:**
```json
{
  "storeName": "evisu-us",
  "csvFiles": [
    {
      "jobId": "export_evisu-us_1763017706706",
      "fileName": "customers-evisu-us-2025-11-13.csv",
      "filePath": "/path/to/exports/customers-evisu-us-2025-11-13.csv",
      "fileSize": 52428800,
      "fileSizeFormatted": "50 MB",
      "createdAt": "2025-11-13T08:18:30.458Z",
      "downloadUrl": "/api/download-csv/job/export_evisu-us_1763017706706"
    }
  ],
  "count": 1
}
```

Then download using the `downloadUrl`:

```bash
curl -O -J http://localhost:3000/api/download-csv/job/export_evisu-us_1763017706706
```

## API Endpoints

### 1. Download Latest CSV

```
GET /api/download-csv/:storeName/latest
```

Downloads the most recent CSV file for a store.

**Example:**
```bash
curl -O -J http://localhost:3000/api/download-csv/evisu-us/latest
```

**Response:**
- File download with proper headers
- Filename: `customers-evisu-us-2025-11-13.csv`

**Errors:**
- `404` - No export job found
- `404` - No CSV file found (need to generate one first)

### 2. Download CSV by Job ID

```
GET /api/download-csv/job/:jobId
```

Downloads a specific CSV file by its job ID.

**Example:**
```bash
curl -O -J http://localhost:3000/api/download-csv/job/export_evisu-us_1763017706706
```

**Response:**
- File download with proper headers
- Original filename preserved

**Errors:**
- `404` - Job not found
- `404` - No CSV file for this job

### 3. List All CSV Files

```
GET /api/csv-files/:storeName
```

Lists all CSV files available for a store with metadata.

**Example:**
```bash
curl http://localhost:3000/api/csv-files/evisu-us | jq
```

**Response:**
```json
{
  "storeName": "evisu-us",
  "csvFiles": [
    {
      "jobId": "export_evisu-us_1763017706706",
      "fileName": "customers-evisu-us-2025-11-13.csv",
      "filePath": "/absolute/path/to/file.csv",
      "fileSize": 52428800,
      "fileSizeFormatted": "50 MB",
      "createdAt": "2025-11-13T08:18:30.458Z",
      "downloadUrl": "/api/download-csv/job/export_evisu-us_1763017706706"
    }
  ],
  "count": 1
}
```

## Using in Browser

### Direct Download Link

Simply open the URL in your browser:

```
http://localhost:3000/api/download-csv/evisu-us/latest
```

The browser will automatically download the file with the correct filename.

### From Status Response

When you check export status, you can see if a CSV was generated:

```bash
curl http://localhost:3000/api/status/evisu-us | jq
```

**Response:**
```json
{
  "storeName": "evisu-us",
  "isExporting": false,
  "customerCount": 280000,
  "latestJob": {
    "id": "export_evisu-us_1763017706706",
    "status": "completed",
    "csvFilePath": "/path/to/exports/customers-evisu-us-2025-11-13.csv"
  }
}
```

If `csvFilePath` exists, you can download it:

```bash
# Get the job ID from status
JOB_ID=$(curl -s http://localhost:3000/api/status/evisu-us | jq -r '.latestJob.id')

# Download the CSV
curl -O -J http://localhost:3000/api/download-csv/job/$JOB_ID
```

## Complete Workflow Example

### 1. Start Export with CSV Generation

```bash
curl -X POST http://localhost:3000/api/export/evisu-us \
  -H "Content-Type: application/json" \
  -d '{"exportCsv": true}'
```

**Response includes download URL:**
```json
{
  "message": "Export started",
  "storeName": "evisu-us",
  "jobId": "export_evisu-us_1763017706706",
  "downloadUrl": "/api/download-csv/evisu-us/latest"
}
```

### 2. Wait for Export to Complete

Monitor progress:

```bash
watch -n 5 'curl -s http://localhost:3000/api/status/evisu-us | jq'
```

### 3. Download the CSV

Once status shows `"status": "completed"`:

```bash
# Method 1: Direct download
curl -O -J http://localhost:3000/api/download-csv/evisu-us/latest

# Method 2: List first, then download specific file
curl http://localhost:3000/api/csv-files/evisu-us | jq
# Then use the downloadUrl from the response
```

## File Headers

The download endpoints set proper HTTP headers:

```
Content-Type: text/csv
Content-Disposition: attachment; filename="customers-evisu-us-2025-11-13.csv"
```

This ensures:
- Browser recognizes it as CSV
- File downloads with correct filename
- File doesn't open in browser (downloads instead)

## File Naming Convention

CSV files are named with this pattern:

```
customers-{storeName}-{YYYY-MM-DD}.csv
```

Example: `customers-evisu-us-2025-11-13.csv`

## Error Handling

### "No CSV file found"

**Cause:** The export didn't generate a CSV file.

**Solution:** Generate CSV first:

```bash
curl -X POST http://localhost:3000/api/export-csv/evisu-us
```

### "CSV file not found on disk"

**Cause:** The file was deleted or moved.

**Solution:** 
1. Check if file exists: `ls -lh exports/`
2. Regenerate CSV: `curl -X POST http://localhost:3000/api/export-csv/evisu-us`

### "Job not found"

**Cause:** Invalid job ID.

**Solution:** 
1. List jobs: `curl http://localhost:3000/api/history/evisu-us`
2. Use correct job ID

## Programmatic Usage

### JavaScript/TypeScript

```javascript
// Download latest CSV
async function downloadLatestCSV(storeName) {
  const response = await fetch(`http://localhost:3000/api/download-csv/${storeName}/latest`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Download failed');
  }
  
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = response.headers.get('Content-Disposition').split('filename=')[1].replace(/"/g, '');
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
```

### Python

```python
import requests

def download_latest_csv(store_name, base_url="http://localhost:3000"):
    url = f"{base_url}/api/download-csv/{store_name}/latest"
    response = requests.get(url, stream=True)
    
    if response.status_code == 404:
        error = response.json()
        raise Exception(error.get('error', 'Download failed'))
    
    # Get filename from Content-Disposition header
    content_disposition = response.headers.get('Content-Disposition', '')
    filename = content_disposition.split('filename=')[1].replace('"', '') if 'filename=' in content_disposition else f'customers-{store_name}.csv'
    
    with open(filename, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    
    return filename
```

## Tips

1. **Large Files**: For very large CSV files (>100MB), consider using `wget` or a download manager:
   ```bash
   wget http://localhost:3000/api/download-csv/evisu-us/latest
   ```

2. **Check File Size First**: Use the list endpoint to see file size before downloading:
   ```bash
   curl http://localhost:3000/api/csv-files/evisu-us | jq '.csvFiles[0].fileSizeFormatted'
   ```

3. **Download in Background**: Use `nohup` or `screen` for long downloads:
   ```bash
   nohup curl -O -J http://localhost:3000/api/download-csv/evisu-us/latest &
   ```

4. **Verify Download**: Check file integrity:
   ```bash
   # Download
   curl -O -J http://localhost:3000/api/download-csv/evisu-us/latest
   
   # Verify it's a valid CSV
   head -5 customers-evisu-us-2025-11-13.csv
   wc -l customers-evisu-us-2025-11-13.csv
   ```

## Summary

| Action | Endpoint | Method |
|--------|----------|--------|
| Download latest CSV | `/api/download-csv/:storeName/latest` | GET |
| Download by job ID | `/api/download-csv/job/:jobId` | GET |
| List all CSV files | `/api/csv-files/:storeName` | GET |
| Generate CSV | `/api/export-csv/:storeName` | POST |

All download endpoints return the file directly with proper headers for browser download.

