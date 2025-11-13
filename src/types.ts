export type CustomerAddress = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  country: string | null;
  countryCodeV2: string | null;
  province: string | null;
  provinceCode: string | null;
  zip: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
};

export type CustomerEvent = {
  action: string;
  appTitle: string | null;
  message: string;
};

export type CustomerOrder = {
  createdAt: string;
  email: string | null;
  id: string;
  paymentGatewayNames: string[];
  customerAcceptsMarketing: boolean;
  customer: {
    displayName: string;
  } | null;
  discountCode: string | null;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  lineItems: {
    nodes: Array<{
      id: string;
      name: string;
      quantity: number;
    }>;
  };
  returns: {
    nodes: Array<{
      id: string;
      name: string;
      status: string;
      totalQuantity: number;
    }>;
  };
  shippingAddress: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    country: string | null;
    countryCodeV2: string | null;
    company: string | null;
    formattedArea: string | null;
  } | null;
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
};

export type CustomerData = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  defaultEmailAddress: {
    emailAddress: string;
  } | null;
  defaultPhoneNumber: {
    phoneNumber: string;
  } | null;
  verifiedEmail: boolean;
  state: string;
  locale: string | null;
  note: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  amountSpent: {
    amount: string;
    currencyCode: string;
  };
  numberOfOrders: string;
  lifetimeDuration: string | null;
  addresses: CustomerAddress[];
  defaultAddress: CustomerAddress | null;
  lastOrder: {
    id: string;
    name: string;
    createdAt: string;
  } | null;
  productSubscriberStatus: string | null;
  mergeable: {
    isMergeable: boolean;
  } | null;
  originalCreatedDate: {
    value: string;
  } | null;
  events: {
    nodes: CustomerEvent[];
  };
  orders: {
    nodes: CustomerOrder[];
  };
  statistics: {
    predictedSpendTier: string | null;
    rfmGroup: string | null;
  };
};

export type ExportStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ExportJob {
  id: string;
  storeName: string;
  status: ExportStatus;
  totalCustomers: number;
  processedCustomers: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  csvFilePath?: string;
  lastCursor?: string; // For resuming failed exports
}

