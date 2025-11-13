#!/usr/bin/env node

/**
 * Database Migration Script
 * Adds the last_cursor column to export_jobs table for resume functionality
 * 
 * Run this once after updating to the version with resume support:
 *   node migrate-db.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data/customers.db');

console.log(`\n🔄 Database Migration Script`);
console.log(`Database: ${DB_PATH}\n`);

if (!fs.existsSync(DB_PATH)) {
  console.log('✅ No existing database found. Migration not needed.');
  console.log('   The new schema will be created automatically when you run the service.\n');
  process.exit(0);
}

try {
  const db = new Database(DB_PATH);
  
  // Check if column already exists
  const tableInfo = db.pragma('table_info(export_jobs)');
  const hasLastCursor = tableInfo.some(col => col.name === 'last_cursor');
  
  if (hasLastCursor) {
    console.log('✅ Database already has the last_cursor column. No migration needed.\n');
    db.close();
    process.exit(0);
  }
  
  // Add the column
  console.log('Adding last_cursor column to export_jobs table...');
  db.exec('ALTER TABLE export_jobs ADD COLUMN last_cursor TEXT');
  
  console.log('✅ Migration completed successfully!\n');
  console.log('You can now use the resume functionality:\n');
  console.log('  API:  POST /api/export/:storeName/resume');
  console.log('  CLI:  npm run export -- resume <storeName>\n');
  
  db.close();
  process.exit(0);
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  console.error('\nIf the error says the column already exists, you can ignore this.\n');
  process.exit(1);
}

