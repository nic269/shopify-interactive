// CRITICAL: Load environment variables FIRST
require('dotenv').config({ 
  path: require('path').resolve(__dirname, '../.env') 
});

import * as fs from 'fs';
import * as path from 'path';
import { createShopifyClient, storeConfigs } from './shopify-client';
import { CustomerData, OrderData } from './types';
import {
  saveCustomers,
  saveOrders,
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
  jobId?: string,
  startCursor?: string
): Promise<{ totalCustomers: number; jobId: string }> {
  const shopify = createShopifyClient(storeName as keyof typeof storeConfigs);

  // Create or get export job
  const job = jobId ? getExportJob(jobId) : null;
  const exportJobId = job?.id || createExportJob(storeName).id;

  // Update job status to in_progress
  updateExportJob(exportJobId, { status: 'in_progress' });

  let hasNextPage = true;
  let cursor: string | null = startCursor || null;
  let batchNumber = 0;
  let totalCustomers = job?.processedCustomers || 0; // Start from existing count if resuming

  const resumeInfo = startCursor ? ` (resuming from cursor, ${totalCustomers} already processed)` : '';
  console.log(`Starting to fetch customers for ${storeName}${resumeInfo}`);

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

        // Update pagination cursor before updating progress (in case of failure)
        const nextCursor = response.data.customers.pageInfo.endCursor;

        // Update job progress AND cursor after successful batch
        updateExportJob(exportJobId, {
          processedCustomers: totalCustomers,
          lastCursor: nextCursor, // Save cursor for resume capability
        });

        console.log(
          `Batch ${batchNumber}: Saved ${customers.length} customers (Total: ${totalCustomers})`
        );
      }

      hasNextPage = response.data.customers.pageInfo.hasNextPage;
      cursor = response.data.customers.pageInfo.endCursor;
      // if (batchNumber >= 3) {
      //   hasNextPage = false;

      //   const nextCursor = response.data.customers.pageInfo.endCursor;
      //   updateExportJob(exportJobId, {
      //     status: 'failed',
      //     error: 'limit reached',
      //     completedAt: new Date().toISOString(),
      //     lastCursor: nextCursor,
      //   });

      //   console.log(`Failed to fetch customers for ${storeName}: limit reached`);

      //   return { totalCustomers, jobId: exportJobId };
      // }

      // Add delay between requests
      if (hasNextPage) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
      }
    }

    // Update job as completed (clear cursor on success)
    updateExportJob(exportJobId, {
      status: 'completed',
      totalCustomers,
      completedAt: new Date().toISOString(),
      lastCursor: undefined, // Clear cursor on completion
    });

    console.log(`Successfully fetched and saved ${totalCustomers} customers for ${storeName}`);

    return { totalCustomers, jobId: exportJobId };
  } catch (error) {
    console.error(`Error fetching customers:`, error);

    // Update job as failed (cursor is already saved from last successful batch)
    updateExportJob(exportJobId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
      // Note: lastCursor is preserved from the last successful batch
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

const ORDERS_PER_REQUEST = 250;
const DELAY_BETWEEN_ORDERS_REQUESTS_MS = 500;

/**
 * Fetches all orders from Shopify and saves them to the database
 */
export async function fetchAndSaveOrders(
  storeName: string,
  jobId?: string,
  startCursor?: string
): Promise<{ totalOrders: number; jobId: string }> {
  const shopify = createShopifyClient(storeName as keyof typeof storeConfigs);

  // Create or get export job
  const job = jobId ? getExportJob(jobId) : null;
  const exportJobId = job?.id || createExportJob(storeName).id;

  // Update job status to in_progress
  updateExportJob(exportJobId, { status: 'in_progress' });

  let hasNextPage = true;
  let cursor: string | null = startCursor || null;
  let batchNumber = 0;
  let totalOrders = job?.processedCustomers || 0; // Reuse processedCustomers field for orders

  const resumeInfo = startCursor ? ` (resuming from cursor, ${totalOrders} already processed)` : '';
  console.log(`Starting to fetch orders for ${storeName}${resumeInfo}`);

  try {
    while (hasNextPage) {
      batchNumber++;

      const query = `
        query getOrders($first: Int!, $after: String) {
          orders(first: $first, after: $after) {
            edges {
              cursor
              node {
                email
                name
                displayFinancialStatus
                displayFulfillmentStatus
                fulfillments(first: 1) {
                  createdAt
                }
                currencyCode
                subtotalPriceSet {
                  shopMoney {
                    amount
                  }
                }
                tags
                shippingLine {
                  title
                }
                createdAt
                lineItems(first: 100) {
                  nodes {
                    title
                    originalTotalSet {
                      shopMoney {
                        amount
                      }
                    }
                    quantity
                    sku
                    fulfillmentStatus
                  }
                }
                shippingAddress {
                  name
                  phone
                  country
                }
                paymentGatewayNames
                refunds(first: 100) {
                  totalRefundedSet {
                    shopMoney {
                      amount
                    }
                  }
                }
                sourceName
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      console.log(`Fetching orders batch ${batchNumber} for ${storeName}...`);

      const response = (await shopify.request(query, {
        variables: {
          first: ORDERS_PER_REQUEST,
          after: cursor,
        },
      })) as any;

      // Check for GraphQL errors
      if (response.errors) {
        if (response.errors.graphQLErrors && response.errors.graphQLErrors.length > 0) {
          console.error(`GraphQL errors:`, JSON.stringify(response.errors.graphQLErrors, null, 2));
          throw new Error(`GraphQL Error: ${JSON.stringify(response.errors.graphQLErrors)}`);
        }
        if (Array.isArray(response.errors) && response.errors.length > 0) {
          console.error(`GraphQL errors:`, JSON.stringify(response.errors, null, 2));
          throw new Error(`GraphQL Error: ${JSON.stringify(response.errors)}`);
        }
      }

      if (!response || !response.data || !response.data.orders) {
        console.error(`Invalid response structure:`, JSON.stringify(response, null, 2));
        throw new Error(`Invalid response from Shopify API`);
      }

      const orders = response.data.orders.edges.map((edge: any) => edge.node);

      // Save orders to database
      if (orders.length > 0) {
        saveOrders(storeName, orders);
        totalOrders += orders.length;

        // Update pagination cursor before updating progress
        const nextCursor = response.data.orders.pageInfo.endCursor;

        // Update job progress AND cursor after successful batch
        updateExportJob(exportJobId, {
          processedCustomers: totalOrders, // Reuse this field for orders count
          lastCursor: nextCursor,
        });

        console.log(
          `Batch ${batchNumber}: Saved ${orders.length} orders (Total: ${totalOrders})`
        );
      }

      hasNextPage = response.data.orders.pageInfo.hasNextPage;
      cursor = response.data.orders.pageInfo.endCursor;

      // Add delay between requests
      if (hasNextPage) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_ORDERS_REQUESTS_MS));
      }
    }

    // Update job as completed
    updateExportJob(exportJobId, {
      status: 'completed',
      totalCustomers: totalOrders, // Reuse this field
      completedAt: new Date().toISOString(),
      lastCursor: undefined,
    });

    console.log(`Successfully fetched and saved ${totalOrders} orders for ${storeName}`);

    return { totalOrders, jobId: exportJobId };
  } catch (error) {
    console.error(`Error fetching orders:`, error);

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
 * Exports orders from database to CSV file
 * Each line item gets its own row with order-level data repeated
 */
export async function exportOrdersToCSV(
  storeName: string,
  jobId?: string
): Promise<string> {
  // Get orders from database
  const { getOrdersByStore } = await import('./database');
  const orders = getOrdersByStore(storeName);

  if (orders.length === 0) {
    throw new Error(`No orders found in database for store: ${storeName}`);
  }

  // Create output directory
  const outputDir = path.resolve(__dirname, '../exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const outputFile = path.join(outputDir, `orders-${storeName}-${timestamp}.csv`);

  // Create write stream
  const writeStream = fs.createWriteStream(outputFile, { flags: 'w' });

  // Write CSV header (matching the example format)
  const headers = [
    'Name',
    'Email',
    'Financial Status',
    'Fulfillment Status',
    'Fulfilled at',
    'Currency',
    'Total',
    'Shipping Method',
    'Created at',
    'Shipping Name',
    'Shipping Country',
    'Shipping Phone',
    'Payment Method',
    'Refunded Amount',
    'Tags',
    'Source',
    'Phone',
    'Lineitem quantity',
    'Lineitem name',
    'Lineitem price',
    'Lineitem sku',
    'Lineitem fulfillment status',
  ];

  writeStream.write(headers.join(',') + '\n');

  // Write order rows (one row per line item)
  for (const order of orders) {
    const rows = orderToCSVRows(order);
    for (const row of rows) {
      writeStream.write(csvRowToLine(row) + '\n');
    }
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

/**
 * Converts an order to CSV rows (one row per line item)
 */
function orderToCSVRows(order: OrderData): any[] {
  const rows: any[] = [];

  // Calculate total refunded amount
  const totalRefunded = order.refunds.reduce((sum, refund) => {
    return sum + parseFloat(refund.totalRefundedSet.shopMoney.amount || '0');
  }, 0);

  // Format fulfillment date
  const fulfilledAt = order.fulfillments && order.fulfillments.length > 0
    ? formatDate(order.fulfillments[0].createdAt)
    : '';

  // Format created date
  const createdAt = formatDate(order.createdAt);

  // Convert financial status to lowercase
  const financialStatus = order.displayFinancialStatus?.toLowerCase() || '';
  
  // Convert fulfillment status to lowercase
  const fulfillmentStatus = order.displayFulfillmentStatus?.toLowerCase() || '';

  // Payment method (first one or comma-separated)
  const paymentMethod = order.paymentGatewayNames?.join(', ') || '';

  // Tags (comma-separated)
  const tags = order.tags?.join(', ') || '';

  // Order-level data
  const orderData = {
    name: order.name || '',
    email: order.email || '',
    financialStatus,
    fulfillmentStatus,
    fulfilledAt,
    currency: order.currencyCode || '',
    total: order.subtotalPriceSet?.shopMoney?.amount || '0',
    shippingMethod: order.shippingLine?.title || '',
    createdAt,
    shippingName: order.shippingAddress?.name || '',
    shippingCountry: order.shippingAddress?.country || '',
    shippingPhone: order.shippingAddress?.phone || '',
    paymentMethod,
    refundedAmount: totalRefunded.toString(),
    tags,
    source: order.sourceName || '',
    phone: order.shippingAddress?.phone || '',
  };

  // Create one row per line item
  if (order.lineItems?.nodes && order.lineItems.nodes.length > 0) {
    for (const lineItem of order.lineItems.nodes) {
      rows.push({
        ...orderData,
        lineitemQuantity: lineItem.quantity || 0,
        lineitemName: lineItem.title || '',
        lineitemPrice: lineItem.originalTotalSet?.shopMoney?.amount || '0',
        lineitemSku: lineItem.sku || '',
        lineitemFulfillmentStatus: lineItem.fulfillmentStatus || '',
      });
    }
  } else {
    // If no line items, create one row with empty line item data
    rows.push({
      ...orderData,
      lineitemQuantity: '',
      lineitemName: '',
      lineitemPrice: '',
      lineitemSku: '',
      lineitemFulfillmentStatus: '',
    });
  }

  return rows;
}

/**
 * Formats a date string to the format used in the example CSV
 * Example: "2025-06-22T14:30:21Z" -> "2025-06-22 22:30:21 +0800"
 */
function formatDate(dateString: string): string {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    // Format as: YYYY-MM-DD HH:MM:SS +0800
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    // Get timezone offset
    const offset = -date.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';
    const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}${String(offsetMinutes).padStart(2, '0')}`;
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${offsetString}`;
  } catch (error) {
    return dateString;
  }
}

