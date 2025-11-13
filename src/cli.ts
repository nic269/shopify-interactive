#!/usr/bin/env ts-node

// CRITICAL: Load environment variables FIRST before any other imports
require('dotenv').config({ 
  path: require('path').resolve(__dirname, '../.env') 
});

import * as path from 'path';
import { fetchAndSaveCustomers, exportCustomersToCSV } from './export-service';
import { storeConfigs } from './shopify-client';
import { getCustomerCount } from './database';

async function main() {
  const command = process.argv[2];
  const storeName = process.argv[3];

  if (!command) {
    console.log(`
Customer Export CLI

Usage:
  npm run export -- <command> <storeName>

Commands:
  fetch <storeName>   - Fetch customers from Shopify and save to database
  csv <storeName>     - Export customers from database to CSV
  both <storeName>    - Fetch from Shopify then export to CSV
  count <storeName>   - Show customer count in database
  list                - List all stores and their customer counts

Examples:
  npm run export -- fetch evisu-us
  npm run export -- csv evisu-us
  npm run export -- both evisu-us
  npm run export -- count evisu-us
  npm run export -- list

Available stores: ${Object.keys(storeConfigs).join(', ')}
    `);
    process.exit(0);
  }

  if (command === 'list') {
    console.log('\n📊 Stores and Customer Counts:\n');
    Object.keys(storeConfigs).forEach((store) => {
      const count = getCustomerCount(store);
      console.log(`  ${store.padEnd(20)} ${count.toLocaleString()} customers`);
    });
    console.log('');
    process.exit(0);
  }

  if (!storeName) {
    console.error('❌ Error: Store name is required');
    console.error(`Available stores: ${Object.keys(storeConfigs).join(', ')}`);
    process.exit(1);
  }

  if (!(storeName in storeConfigs)) {
    console.error(`❌ Error: Invalid store name: ${storeName}`);
    console.error(`Available stores: ${Object.keys(storeConfigs).join(', ')}`);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'fetch':
        console.log(`\n📥 Fetching customers from ${storeName}...\n`);
        const fetchResult = await fetchAndSaveCustomers(storeName);
        console.log(`\n✅ Success! Fetched ${fetchResult.totalCustomers} customers`);
        console.log(`Job ID: ${fetchResult.jobId}`);
        break;

      case 'csv':
        console.log(`\n📝 Exporting customers to CSV for ${storeName}...\n`);
        const csvPath = await exportCustomersToCSV(storeName);
        console.log(`\n✅ Success! CSV file created:`);
        console.log(`   ${csvPath}`);
        break;

      case 'both':
        console.log(`\n📥 Fetching customers from ${storeName}...\n`);
        const bothResult = await fetchAndSaveCustomers(storeName);
        console.log(`\n✅ Fetched ${bothResult.totalCustomers} customers`);
        
        console.log(`\n📝 Exporting to CSV...\n`);
        const csvPath2 = await exportCustomersToCSV(storeName, bothResult.jobId);
        console.log(`\n✅ Success! CSV file created:`);
        console.log(`   ${csvPath2}`);
        break;

      case 'count':
        const count = getCustomerCount(storeName);
        console.log(`\n📊 ${storeName}: ${count.toLocaleString()} customers in database\n`);
        break;

      default:
        console.error(`❌ Error: Unknown command: ${command}`);
        console.error(`Available commands: fetch, csv, both, count, list`);
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();

