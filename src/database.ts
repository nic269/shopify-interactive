import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { CustomerData, ExportJob, ExportStatus } from './types';

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/customers.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Initialize database schema
export function initializeDatabase() {
  // Create customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      store_name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_name);
    CREATE INDEX IF NOT EXISTS idx_customers_updated ON customers(updated_at);
  `);

  // Create export_jobs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS export_jobs (
      id TEXT PRIMARY KEY,
      store_name TEXT NOT NULL,
      status TEXT NOT NULL,
      total_customers INTEGER DEFAULT 0,
      processed_customers INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      csv_file_path TEXT,
      last_cursor TEXT
    )
  `);

  // Create indexes for export jobs
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_store ON export_jobs(store_name);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON export_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_started ON export_jobs(started_at);
  `);

  console.log('✓ Database initialized');
}

// Customer operations
export function saveCustomers(storeName: string, customers: CustomerData[]) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO customers (id, store_name, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((customersData: CustomerData[]) => {
    const now = new Date().toISOString();
    for (const customer of customersData) {
      insert.run(
        customer.id,
        storeName,
        JSON.stringify(customer),
        customer.createdAt || now,
        now
      );
    }
  });

  insertMany(customers);
}

export function getCustomersByStore(storeName: string): CustomerData[] {
  const stmt = db.prepare(`
    SELECT data FROM customers WHERE store_name = ? ORDER BY updated_at DESC
  `);

  const rows = stmt.all(storeName) as Array<{ data: string }>;
  return rows.map(row => JSON.parse(row.data));
}

export function getCustomerCount(storeName: string): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM customers WHERE store_name = ?
  `);

  const result = stmt.get(storeName) as { count: number };
  return result.count;
}

export function deleteCustomersByStore(storeName: string): number {
  const stmt = db.prepare(`DELETE FROM customers WHERE store_name = ?`);
  const result = stmt.run(storeName);
  return result.changes;
}

// Export job operations
export function createExportJob(storeName: string): ExportJob {
  const id = `export_${storeName}_${Date.now()}`;
  const job: ExportJob = {
    id,
    storeName,
    status: 'pending',
    totalCustomers: 0,
    processedCustomers: 0,
    startedAt: new Date().toISOString()
  };

  const stmt = db.prepare(`
    INSERT INTO export_jobs (id, store_name, status, total_customers, processed_customers, started_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(job.id, job.storeName, job.status, job.totalCustomers, job.processedCustomers, job.startedAt);

  return job;
}

export function updateExportJob(jobId: string, updates: Partial<ExportJob>) {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.status) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.totalCustomers !== undefined) {
    fields.push('total_customers = ?');
    values.push(updates.totalCustomers);
  }
  if (updates.processedCustomers !== undefined) {
    fields.push('processed_customers = ?');
    values.push(updates.processedCustomers);
  }
  if (updates.completedAt) {
    fields.push('completed_at = ?');
    values.push(updates.completedAt);
  }
  if (updates.error) {
    fields.push('error = ?');
    values.push(updates.error);
  }
  if (updates.csvFilePath) {
    fields.push('csv_file_path = ?');
    values.push(updates.csvFilePath);
  }
  if (updates.lastCursor !== undefined) {
    fields.push('last_cursor = ?');
    values.push(updates.lastCursor);
  }

  if (fields.length === 0) return;

  values.push(jobId);
  const stmt = db.prepare(`UPDATE export_jobs SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

export function getExportJob(jobId: string): ExportJob | null {
  const stmt = db.prepare(`SELECT * FROM export_jobs WHERE id = ?`);
  const row = stmt.get(jobId) as any;

  if (!row) return null;

  return {
    id: row.id,
    storeName: row.store_name,
    status: row.status as ExportStatus,
    totalCustomers: row.total_customers,
    processedCustomers: row.processed_customers,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    csvFilePath: row.csv_file_path,
    lastCursor: row.last_cursor
  };
}

export function getExportJobsByStore(storeName: string, limit: number = 10): ExportJob[] {
  const stmt = db.prepare(`
    SELECT * FROM export_jobs 
    WHERE store_name = ? 
    ORDER BY started_at DESC 
    LIMIT ?
  `);

  const rows = stmt.all(storeName, limit) as any[];

  return rows.map(row => ({
    id: row.id,
    storeName: row.store_name,
    status: row.status as ExportStatus,
    totalCustomers: row.total_customers,
    processedCustomers: row.processed_customers,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    csvFilePath: row.csv_file_path,
    lastCursor: row.last_cursor
  }));
}

export function getLatestExportJob(storeName?: string): ExportJob | null {
  let stmt;
  if (storeName) {
    stmt = db.prepare(`
      SELECT * FROM export_jobs 
      WHERE store_name = ? 
      ORDER BY started_at DESC 
      LIMIT 1
    `);
    const row = stmt.get(storeName) as any;
    if (!row) return null;
    return {
      id: row.id,
      storeName: row.store_name,
      status: row.status as ExportStatus,
      totalCustomers: row.total_customers,
      processedCustomers: row.processed_customers,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      csvFilePath: row.csv_file_path,
      lastCursor: row.last_cursor
    };
  } else {
    stmt = db.prepare(`SELECT * FROM export_jobs ORDER BY started_at DESC LIMIT 1`);
    const row = stmt.get() as any;
    if (!row) return null;
    return {
      id: row.id,
      storeName: row.store_name,
      status: row.status as ExportStatus,
      totalCustomers: row.total_customers,
      processedCustomers: row.processed_customers,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      csvFilePath: row.csv_file_path,
      lastCursor: row.last_cursor
    };
  }
}

export function closeDatabase() {
  db.close();
}

// Initialize on import
initializeDatabase();

