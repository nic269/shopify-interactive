// CRITICAL: Load environment variables FIRST before any other imports
// This must be done using require() to ensure it executes before ES6 imports
require('dotenv').config({ 
  path: require('path').resolve(__dirname, '../.env') 
});

import express, { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { fetchAndSaveCustomers, exportCustomersToCSV } from './export-service';
import {
  getExportJob,
  getExportJobsByStore,
  getLatestExportJob,
  getCustomerCount,
} from './database';
import { storeConfigs } from './shopify-client';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Track active exports (in-memory for simplicity)
const activeExports = new Map<string, boolean>();

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get available stores
app.get('/api/stores', (req: Request, res: Response) => {
  const stores = Object.keys(storeConfigs).map((storeName) => ({
    name: storeName,
    customerCount: getCustomerCount(storeName),
  }));

  res.json({ stores });
});

// Trigger customer export for a store
app.post('/api/export/:storeName', async (req: Request, res: Response) => {
  const { storeName } = req.params;
  const { exportCsv = false } = req.body;

  // Validate store name
  if (!(storeName in storeConfigs)) {
    return res.status(400).json({
      error: 'Invalid store name',
      availableStores: Object.keys(storeConfigs),
    });
  }

  // Check if export is already running for this store
  if (activeExports.get(storeName)) {
    return res.status(409).json({
      error: 'Export already in progress for this store',
      storeName,
    });
  }

  // Start export in background
  activeExports.set(storeName, true);

  // Return immediately with job info
  const latestJob = getLatestExportJob(storeName);

  // Run export in background
  (async () => {
    try {
      console.log(`Starting export for ${storeName}...`);
      const result = await fetchAndSaveCustomers(storeName);
      console.log(`Export completed for ${storeName}: ${result.totalCustomers} customers`);

      // Optionally export to CSV
      if (exportCsv) {
        await exportCustomersToCSV(storeName, result.jobId);
        console.log(`CSV export completed for ${storeName}`);
      }
    } catch (error) {
      console.error(`Export failed for ${storeName}:`, error);
    } finally {
      activeExports.delete(storeName);
    }
  })();

  res.json({
    message: 'Export started',
    storeName,
    jobId: latestJob?.id || 'pending',
    status: 'Export running in background. Use /api/status/:storeName to check progress.',
    downloadUrl: exportCsv ? `/api/download-csv/${storeName}/latest` : null,
  });
});

// Resume a failed export
app.post('/api/export/:storeName/resume', async (req: Request, res: Response) => {
  const { storeName } = req.params;
  const { exportCsv = false, jobId } = req.body;

  // Validate store name
  if (!(storeName in storeConfigs)) {
    return res.status(400).json({
      error: 'Invalid store name',
      availableStores: Object.keys(storeConfigs),
    });
  }

  // Check if export is already running for this store
  if (activeExports.get(storeName)) {
    return res.status(409).json({
      error: 'Export already in progress for this store',
      storeName,
    });
  }

  // Get the job to resume (either specified jobId or latest failed job)
  let jobToResume = jobId ? getExportJob(jobId) : null;
  
  if (!jobToResume) {
    // Find the latest failed job for this store
    const jobs = getExportJobsByStore(storeName, 10);
    jobToResume = jobs.find(job => job.status === 'failed' || job.status === 'in_progress') || null;
  }

  if (!jobToResume) {
    return res.status(404).json({
      error: 'No failed job found to resume',
      storeName,
      hint: 'Use POST /api/export/:storeName to start a new export',
    });
  }

  if (jobToResume.status !== 'failed' && jobToResume.status !== 'in_progress') {
    return res.status(400).json({
      error: 'Can only resume failed or in_progress jobs',
      jobStatus: jobToResume.status,
      jobId: jobToResume.id,
    });
  }

  if (!jobToResume.lastCursor) {
    return res.status(400).json({
      error: 'Job has no saved cursor to resume from',
      jobId: jobToResume.id,
      hint: 'The job may have failed or is still in progress before processing any batches. Start a new export instead.',
    });
  }

  // Start resume in background
  activeExports.set(storeName, true);

  // Run resume in background
  (async () => {
    try {
      console.log(`Resuming export for ${storeName} from cursor (${jobToResume!.processedCustomers} already processed)...`);
      const result = await fetchAndSaveCustomers(storeName, jobToResume!.id, jobToResume!.lastCursor || undefined);
      console.log(`Export resumed and completed for ${storeName}: ${result.totalCustomers} total customers`);

      // Optionally export to CSV
      if (exportCsv) {
        await exportCustomersToCSV(storeName, result.jobId);
        console.log(`CSV export completed for ${storeName}`);
      }
    } catch (error) {
      console.error(`Resume failed for ${storeName}:`, error);
    } finally {
      activeExports.delete(storeName);
    }
  })();

  res.json({
    message: 'Export resumed',
    storeName,
    jobId: jobToResume.id,
    resumedFrom: jobToResume.processedCustomers,
    status: 'Export running in background. Use /api/status/:storeName to check progress.',
    downloadUrl: exportCsv ? `/api/download-csv/job/${jobToResume.id}` : null,
  });
});

// Get export status for a store
app.get('/api/status/:storeName', (req: Request, res: Response) => {
  const { storeName } = req.params;

  // Validate store name
  if (!(storeName in storeConfigs)) {
    return res.status(400).json({
      error: 'Invalid store name',
      availableStores: Object.keys(storeConfigs),
    });
  }

  const latestJob = getLatestExportJob(storeName);
  const isExporting = activeExports.get(storeName) || false;
  const customerCount = getCustomerCount(storeName);

  res.json({
    storeName,
    isExporting,
    customerCount,
    latestJob: latestJob || null,
  });
});

// Get export job details
app.get('/api/job/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = getExportJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({ job });
});

// Get export history for a store
app.get('/api/history/:storeName', (req: Request, res: Response) => {
  const { storeName } = req.params;
  const limit = parseInt(req.query.limit as string) || 10;

  // Validate store name
  if (!(storeName in storeConfigs)) {
    return res.status(400).json({
      error: 'Invalid store name',
      availableStores: Object.keys(storeConfigs),
    });
  }

  const jobs = getExportJobsByStore(storeName, limit);

  res.json({
    storeName,
    jobs,
  });
});

// Export customers to CSV from database (without re-fetching from Shopify)
app.post('/api/export-csv/:storeName', async (req: Request, res: Response) => {
  const { storeName } = req.params;

  // Validate store name
  if (!(storeName in storeConfigs)) {
    return res.status(400).json({
      error: 'Invalid store name',
      availableStores: Object.keys(storeConfigs),
    });
  }

  try {
    const csvPath = await exportCustomersToCSV(storeName);
    res.json({
      message: 'CSV export completed',
      storeName,
      filePath: csvPath,
      downloadUrl: `/api/download-csv/${storeName}/latest`,
    });
  } catch (error) {
    console.error(`CSV export error:`, error);
    res.status(500).json({
      error: 'CSV export failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Download CSV file by job ID
app.get('/api/download-csv/job/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = getExportJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (!job.csvFilePath) {
    return res.status(404).json({
      error: 'No CSV file found for this job',
      jobId,
      hint: 'The export may not have generated a CSV file yet. Use POST /api/export-csv/:storeName to generate one.',
    });
  }

  const filePath = path.resolve(job.csvFilePath);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'CSV file not found on disk',
      filePath: job.csvFilePath,
    });
  }

  // Get filename from path
  const fileName = path.basename(filePath);

  // Set headers for file download
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  // Send file
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`Error sending file:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Error downloading file',
          message: err.message,
        });
      }
    }
  });
});

// Download latest CSV file for a store
app.get('/api/download-csv/:storeName/latest', (req: Request, res: Response) => {
  const { storeName } = req.params;

  // Validate store name
  if (!(storeName in storeConfigs)) {
    return res.status(400).json({
      error: 'Invalid store name',
      availableStores: Object.keys(storeConfigs),
    });
  }

  const latestJob = getLatestExportJob(storeName);

  if (!latestJob) {
    return res.status(404).json({
      error: 'No export job found for this store',
      storeName,
      hint: 'Start an export first using POST /api/export/:storeName',
    });
  }

  if (!latestJob.csvFilePath) {
    return res.status(404).json({
      error: 'No CSV file found for the latest export',
      storeName,
      jobId: latestJob.id,
      hint: 'Generate a CSV file using POST /api/export-csv/:storeName',
    });
  }

  const filePath = path.resolve(latestJob.csvFilePath);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'CSV file not found on disk',
      filePath: latestJob.csvFilePath,
    });
  }

  // Get filename from path
  const fileName = path.basename(filePath);

  // Set headers for file download
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  // Send file
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`Error sending file:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Error downloading file',
          message: err.message,
        });
      }
    }
  });
});

// List all CSV files for a store
app.get('/api/csv-files/:storeName', (req: Request, res: Response) => {
  const { storeName } = req.params;

  // Validate store name
  if (!(storeName in storeConfigs)) {
    return res.status(400).json({
      error: 'Invalid store name',
      availableStores: Object.keys(storeConfigs),
    });
  }

  // Get all jobs with CSV files for this store
  const jobs = getExportJobsByStore(storeName, 100); // Get more jobs to find CSV files
  const csvFiles = jobs
    .filter(job => job.csvFilePath && fs.existsSync(path.resolve(job.csvFilePath)))
    .map(job => {
      const filePath = path.resolve(job.csvFilePath!);
      const stats = fs.statSync(filePath);
      return {
        jobId: job.id,
        fileName: path.basename(filePath),
        filePath: job.csvFilePath,
        fileSize: stats.size,
        fileSizeFormatted: formatFileSize(stats.size),
        createdAt: job.completedAt || job.startedAt,
        downloadUrl: `/api/download-csv/job/${job.id}`,
      };
    })
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());

  res.json({
    storeName,
    csvFiles,
    count: csvFiles.length,
  });
});

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Get all export statuses
app.get('/api/status', (req: Request, res: Response) => {
  const allStores = Object.keys(storeConfigs).map((storeName) => {
    const latestJob = getLatestExportJob(storeName);
    const isExporting = activeExports.get(storeName) || false;
    const customerCount = getCustomerCount(storeName);

    return {
      storeName,
      isExporting,
      customerCount,
      latestJob: latestJob || null,
    };
  });

  res.json({ stores: allStores });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Verify environment variables are loaded
const configuredStores = Object.keys(storeConfigs).filter((storeName) => {
  const config = storeConfigs[storeName];
  return config && config.domain && config.accessToken;
});

if (configuredStores.length === 0) {
  console.error('\n⚠️  WARNING: No stores are properly configured!');
  console.error('Please check your .env file and ensure it has the required variables.\n');
}

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Customer Export Service started`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🏪 Configured stores: ${configuredStores.join(', ') || 'NONE'}`);
  
  if (configuredStores.length < Object.keys(storeConfigs).length) {
    const unconfigured = Object.keys(storeConfigs).filter(s => !configuredStores.includes(s));
    console.log(`⚠️  Unconfigured stores: ${unconfigured.join(', ')}`);
  }
  
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health                          - Health check`);
  console.log(`  GET  /api/stores                      - List all stores`);
  console.log(`  POST /api/export/:storeName           - Start export for a store`);
  console.log(`  POST /api/export/:storeName/resume    - Resume failed export`);
  console.log(`  GET  /api/status/:storeName           - Get export status`);
  console.log(`  GET  /api/status                      - Get all store statuses`);
  console.log(`  GET  /api/job/:jobId                  - Get job details`);
  console.log(`  GET  /api/history/:storeName          - Get export history`);
  console.log(`  POST /api/export-csv/:storeName       - Export to CSV from database`);
  console.log(`  GET  /api/download-csv/:storeName/latest - Download latest CSV`);
  console.log(`  GET  /api/download-csv/job/:jobId     - Download CSV by job ID`);
  console.log(`  GET  /api/csv-files/:storeName        - List all CSV files for store`);
  console.log(`\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...');
  process.exit(0);
});

