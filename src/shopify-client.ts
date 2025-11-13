import { createAdminApiClient, AdminApiClient } from '@shopify/admin-api-client';

type StoreConfig = {
  domain: string;
  accessToken: string;
};

// Store configurations map
export const storeConfigs: Record<string, StoreConfig> = {
  'evisu-hk-staging': {
    domain: process.env.EVISU_HK_STAGING_SHOP_DOMAIN!,
    accessToken: process.env.EVISU_HK_STAGING_ACCESS_TOKEN!,
  },
  'evisu-hk': {
    domain: process.env.EVISU_HK_SHOP_DOMAIN!,
    accessToken: process.env.EVISU_HK_ACCESS_TOKEN!,
  },
  'evisu-ap': {
    domain: process.env.EVISU_AP_SHOP_DOMAIN!,
    accessToken: process.env.EVISU_AP_ACCESS_TOKEN!,
  },
  'evisu-eu': {
    domain: process.env.EVISU_EU_SHOP_DOMAIN!,
    accessToken: process.env.EVISU_EU_ACCESS_TOKEN!,
  },
  'evisu-jp': {
    domain: process.env.EVISU_JP_SHOP_DOMAIN!,
    accessToken: process.env.EVISU_JP_ACCESS_TOKEN!,
  },
  'evisu-sa': {
    domain: process.env.EVISU_SA_SHOP_DOMAIN!,
    accessToken: process.env.EVISU_SA_ACCESS_TOKEN!,
  },
  'evisu-tw': {
    domain: process.env.EVISU_TW_SHOP_DOMAIN!,
    accessToken: process.env.EVISU_TW_ACCESS_TOKEN!,
  },
  'evisu-us': {
    domain: process.env.EVISU_US_SHOP_DOMAIN!,
    accessToken: process.env.EVISU_US_ACCESS_TOKEN!,
  },
};

// Store Shopify client instances
const clientInstances: Record<string, AdminApiClient> = {};

export function createShopifyClient(storeName: keyof typeof storeConfigs) {
  // Return existing instance if available
  if (clientInstances[storeName]) {
    return clientInstances[storeName];
  }

  const config = storeConfigs[storeName];

  if (!config || !config.domain || !config.accessToken) {
    const envVarPrefix = storeName.replace(/-/g, '_').toUpperCase();
    const domainVar = `${envVarPrefix}_SHOP_DOMAIN`;
    const tokenVar = `${envVarPrefix}_ACCESS_TOKEN`;
    
    console.error(`\n❌ Store configuration error for: ${storeName}`);
    console.error(`Missing or invalid environment variables:`);
    console.error(`  ${domainVar}=${config?.domain || 'undefined'}`);
    console.error(`  ${tokenVar}=${config?.accessToken ? '[SET]' : 'undefined'}`);
    console.error(`\nMake sure your .env file contains:`);
    console.error(`  ${domainVar}=your-store.myshopify.com`);
    console.error(`  ${tokenVar}=shpat_xxxxxxxxxxxxx\n`);
    
    throw new Error(`Store configuration not found or incomplete for ${storeName}. Check environment variables.`);
  }

  console.log(`Creating Shopify client for store: ${storeName}`);

  // Create new instance and store it
  const client = createAdminApiClient({
    storeDomain: config.domain,
    apiVersion: '2025-04',
    accessToken: config.accessToken,
    retries: 3,
  });

  clientInstances[storeName] = client;

  return client;
}

export function clearShopifyClients() {
  Object.keys(clientInstances).forEach((key) => {
    delete clientInstances[key];
  });
}

