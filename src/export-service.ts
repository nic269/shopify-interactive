// CRITICAL: Load environment variables FIRST
require('dotenv').config({ 
  path: require('path').resolve(__dirname, '../.env') 
});

import * as fs from 'fs';
import * as path from 'path';
import { createShopifyClient, storeConfigs } from './shopify-client';
import { CustomerData } from './types';
import {
  saveCustomers,
  createExportJob,
  updateExportJob,
  getExportJob,
} from './database';

const CUSTOMERS_PER_REQUEST = 250;
const DELAY_BETWEEN_REQUESTS_MS = 500;

/**
 * Fetches all customers from Shopify and saves them to the database
 */
export async function fetchAndSaveCustomers(
  storeName: string,
  jobId?: string
): Promise<{ totalCustomers: number; jobId: string }> {
  const shopify = createShopifyClient(storeName as keyof typeof storeConfigs);

  // Create or get export job
  const job = jobId ? getExportJob(jobId) : null;
  const exportJobId = job?.id || createExportJob(storeName).id;

  // Update job status to in_progress
  updateExportJob(exportJobId, { status: 'in_progress' });

  let hasNextPage = true;
  let cursor: string | null = null;
  let batchNumber = 0;
  let totalCustomers = 0;

  console.log(`Starting to fetch customers for ${storeName}`);

  try {
    while (hasNextPage) {
      batchNumber++;

      const query = `
        query getCustomers($first: Int!, $after: String) {
          customers(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                firstName
                lastName
                displayName
                defaultEmailAddress {
                  emailAddress
                }
                defaultPhoneNumber {
                  phoneNumber
                }
                verifiedEmail
                state
                locale
                note
                tags
                createdAt
                updatedAt
                amountSpent {
                  amount
                  currencyCode
                }
                numberOfOrders
                lifetimeDuration
                addresses {
                  address1
                  address2
                  city
                  country
                  countryCodeV2
                  province
                  provinceCode
                  zip
                  phone
                  firstName
                  lastName
                  company
                }
                defaultAddress {
                  address1
                  address2
                  city
                  country
                  countryCodeV2
                  province
                  provinceCode
                  zip
                  phone
                  firstName
                  lastName
                  company
                }
                lastOrder {
                  id
                  name
                  createdAt
                }
                productSubscriberStatus
                mergeable {
                  isMergeable
                }
                originalCreatedDate: metafield(key: "created_at", namespace: "magento") {
                  value
                }
                events(first: 5, reverse: true) {
                  nodes {
                    action
                    appTitle
                    message
                  }
                }
                orders(first: 5, reverse: true) {
                  nodes {
                    createdAt
                    email
                    id
                    paymentGatewayNames
                    customerAcceptsMarketing
                    customer {
                      displayName
                    }
                    discountCode
                    displayFinancialStatus
                    displayFulfillmentStatus
                    lineItems(first: 20) {
                      nodes {
                        id
                        name
                        quantity
                      }
                    }
                    returns(first: 20) {
                      nodes {
                        id
                        name
                        status
                        totalQuantity
                      }
                    }
                    shippingAddress {
                      address1
                      address2
                      city
                      country
                      countryCodeV2
                      company
                      formattedArea
                    }
                    totalPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
                statistics {
                  predictedSpendTier
                  rfmGroup
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      console.log(`Fetching batch ${batchNumber} for ${storeName}...`);

      const response = (await shopify.request(query, {
        variables: {
          first: CUSTOMERS_PER_REQUEST,
          after: cursor,
        },
      })) as any;

      // Check for GraphQL errors (can be in different formats)
      if (response.errors) {
        // If errors is an object with graphQLErrors property
        if (response.errors.graphQLErrors && response.errors.graphQLErrors.length > 0) {
          console.error(`GraphQL errors:`, JSON.stringify(response.errors.graphQLErrors, null, 2));
          throw new Error(`GraphQL Error: ${JSON.stringify(response.errors.graphQLErrors)}`);
        }
        // If errors is an array
        if (Array.isArray(response.errors) && response.errors.length > 0) {
          console.error(`GraphQL errors:`, JSON.stringify(response.errors, null, 2));
          throw new Error(`GraphQL Error: ${JSON.stringify(response.errors)}`);
        }
      }

      if (!response || !response.data || !response.data.customers) {
        console.error(`Invalid response structure:`, JSON.stringify(response, null, 2));
        throw new Error(`Invalid response from Shopify API`);
      }

      const customers = response.data.customers.edges.map((edge: any) => edge.node);

      // Save customers to database
      if (customers.length > 0) {
        saveCustomers(storeName, customers);
        totalCustomers += customers.length;

        // Update job progress
        updateExportJob(exportJobId, {
          processedCustomers: totalCustomers,
        });

        console.log(
          `Batch ${batchNumber}: Saved ${customers.length} customers (Total: ${totalCustomers})`
        );
      }

      hasNextPage = response.data.customers.pageInfo.hasNextPage;
      cursor = response.data.customers.pageInfo.endCursor;
      // if (batchNumber >= 3) {
      //   hasNextPage = false;
      // }

      // Add delay between requests
      if (hasNextPage) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
      }
    }

    // Update job as completed
    updateExportJob(exportJobId, {
      status: 'completed',
      totalCustomers,
      completedAt: new Date().toISOString(),
    });

    console.log(`Successfully fetched and saved ${totalCustomers} customers for ${storeName}`);

    return { totalCustomers, jobId: exportJobId };
  } catch (error) {
    console.error(`Error fetching customers:`, error);

    // Update job as failed
    updateExportJob(exportJobId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });

    throw error;
  }
}

/**
 * Exports customers from database to CSV file
 */
export async function exportCustomersToCSV(
  storeName: string,
  jobId?: string
): Promise<string> {
  // Get customers from database
  const { getCustomersByStore } = await import('./database');
  const customers = getCustomersByStore(storeName);

  if (customers.length === 0) {
    throw new Error(`No customers found in database for store: ${storeName}`);
  }

  // Create output directory
  const outputDir = path.resolve(__dirname, '../exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const outputFile = path.join(outputDir, `customers-${storeName}-${timestamp}.csv`);

  // Create write stream
  const writeStream = fs.createWriteStream(outputFile, { flags: 'w' });

  // Write CSV header
  const headers = [
    'id',
    'firstName',
    'lastName',
    'displayName',
    'email',
    'phone',
    'verifiedEmail',
    'state',
    'locale',
    'note',
    'tags',
    'createdAt',
    'updatedAt',
    'amountSpent',
    'amountSpentCurrency',
    'numberOfOrders',
    'lifetimeDuration',
    'defaultAddress_address1',
    'defaultAddress_address2',
    'defaultAddress_city',
    'defaultAddress_country',
    'defaultAddress_countryCodeV2',
    'defaultAddress_province',
    'defaultAddress_provinceCode',
    'defaultAddress_zip',
    'defaultAddress_phone',
    'defaultAddress_firstName',
    'defaultAddress_lastName',
    'defaultAddress_company',
    'lastOrder_id',
    'lastOrder_name',
    'lastOrder_createdAt',
    'productSubscriberStatus',
    'isMergeable',
    'originalCreatedDate (metafield: magento.created_at)',
    'allAddresses',
    'lastFiveEvents',
    'lastFiveOrders',
    'statistics_predictedSpendTier',
    'statistics_rfmGroup',
  ];

  writeStream.write(headers.join(',') + '\n');

  // Write customer rows
  for (const customer of customers) {
    const row = customerToCSVRow(customer);
    writeStream.write(csvRowToLine(row) + '\n');
  }

  writeStream.end();

  // Wait for stream to finish
  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  // Update job with CSV file path
  if (jobId) {
    updateExportJob(jobId, { csvFilePath: outputFile });
  }

  console.log(`CSV file created: ${outputFile}`);

  return outputFile;
}

function customerToCSVRow(customer: CustomerData): any {
  return {
    id: customer.id || '',
    firstName: customer.firstName || '',
    lastName: customer.lastName || '',
    displayName: customer.displayName || '',
    email: customer.defaultEmailAddress?.emailAddress || '',
    phone: customer.defaultPhoneNumber?.phoneNumber || '',
    verifiedEmail: customer.verifiedEmail ? 'true' : 'false',
    state: customer.state || '',
    locale: customer.locale || '',
    note: (customer.note || '').replace(/"/g, '""'),
    tags: customer.tags.join(', '),
    createdAt: customer.createdAt || '',
    updatedAt: customer.updatedAt || '',
    amountSpent: customer.amountSpent?.amount || '0',
    amountSpentCurrency: customer.amountSpent?.currencyCode || '',
    numberOfOrders: customer.numberOfOrders || '0',
    lifetimeDuration: customer.lifetimeDuration || '',
    defaultAddress_address1: customer.defaultAddress?.address1 || '',
    defaultAddress_address2: customer.defaultAddress?.address2 || '',
    defaultAddress_city: customer.defaultAddress?.city || '',
    defaultAddress_country: customer.defaultAddress?.country || '',
    defaultAddress_countryCodeV2: customer.defaultAddress?.countryCodeV2 || '',
    defaultAddress_province: customer.defaultAddress?.province || '',
    defaultAddress_provinceCode: customer.defaultAddress?.provinceCode || '',
    defaultAddress_zip: customer.defaultAddress?.zip || '',
    defaultAddress_phone: customer.defaultAddress?.phone || '',
    defaultAddress_firstName: customer.defaultAddress?.firstName || '',
    defaultAddress_lastName: customer.defaultAddress?.lastName || '',
    defaultAddress_company: customer.defaultAddress?.company || '',
    lastOrder_id: customer.lastOrder?.id || '',
    lastOrder_name: customer.lastOrder?.name || '',
    lastOrder_createdAt: customer.lastOrder?.createdAt || '',
    productSubscriberStatus: customer.productSubscriberStatus || '',
    isMergeable: customer.mergeable?.isMergeable ? 'true' : 'false',
    originalCreatedDate: customer.originalCreatedDate?.value || '',
    allAddresses: JSON.stringify(customer.addresses || []),
    allEvents: JSON.stringify(customer.events?.nodes || []),
    allOrders: JSON.stringify(customer.orders?.nodes || []),
    statistics_predictedSpendTier: customer.statistics?.predictedSpendTier || '',
    statistics_rfmGroup: customer.statistics?.rfmGroup || '',
  };
}

function escapeCSVField(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRowToLine(row: any): string {
  return Object.values(row)
    .map((v) => escapeCSVField(String(v)))
    .join(',');
}

