/**
 * The canonical demo stores. They match tests/fixtures (genuine, discount, impersonator): same
 * names, domains, prices and payee emails. Every brand and domain is invented.
 *
 * Payee email and payee merchant id come from environment variables when set, so a store can be
 * pointed at a PayPal sandbox business account: STORE_GENUINE_PAYEE_EMAIL,
 * STORE_GENUINE_PAYEE_MERCHANT_ID, and the same for DISCOUNT and IMPERSONATOR. Without them the
 * fixture values are used (simulation mode).
 */

export type StoreKind = 'genuine' | 'discount' | 'impersonator';

export interface CatalogStore {
  storeId: string;
  kind: StoreKind;
  domain: string;
  brand: string;
  product: string;
  price: number;
  benchmark: number;
  currency: string;
  /** What the account that receives the payment is called. */
  payeeName: string;
  payeeEmail: string;
  /** The merchant id of the account that receives the payment. */
  payeeMerchantId: string;
  payeeTier: string;
  /** The merchant id the brand is registered under. Differs from payeeMerchantId for the impersonator. */
  registeredMerchantId: string;
  ageDays: number;
  registryRecords: number;
  /** True when the payee email comes from an environment variable naming a PayPal sandbox business account. */
  sandboxPayee: boolean;
}

const override = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;
const KIND_ENV: Record<StoreKind, string> = {
  genuine: 'STORE_GENUINE',
  discount: 'STORE_DISCOUNT',
  impersonator: 'STORE_IMPERSONATOR',
};

export function loadStoreCatalog(): CatalogStore[] {
  return CATALOG_BASE().map((s) => ({ ...s, sandboxPayee: Boolean(process.env[`${KIND_ENV[s.kind]}_PAYEE_EMAIL`]?.trim()) }));
}

function CATALOG_BASE(): Array<Omit<CatalogStore, 'sandboxPayee'>> {
  return [
    {
      storeId: 'harborline-outfitters',
      kind: 'genuine',
      domain: 'www.harborline-outfitters.example',
      brand: 'Harborline Outfitters',
      product: 'Canvas weekender bag',
      price: 84.5,
      benchmark: 84.5,
      currency: 'USD',
      payeeName: 'Harborline Outfitters Ltd',
      payeeEmail: override('STORE_GENUINE_PAYEE_EMAIL', 'payments@harborline-outfitters.example'),
      payeeMerchantId: override('STORE_GENUINE_PAYEE_MERCHANT_ID', 'MERCH-HARBORLINE'),
      payeeTier: 'Registered Merchant',
      registeredMerchantId: override('STORE_GENUINE_PAYEE_MERCHANT_ID', 'MERCH-HARBORLINE'),
      ageDays: 3285,
      registryRecords: 1,
    },
    {
      storeId: 'bargainbarn-outlet',
      kind: 'discount',
      domain: 'www.bargainbarn-outlet.example',
      brand: 'Bargain Barn Outlet',
      product: 'Insulated trail jacket',
      price: 39,
      benchmark: 139,
      currency: 'USD',
      payeeName: 'Bargain Barn Outlet',
      payeeEmail: override('STORE_DISCOUNT_PAYEE_EMAIL', 'orders@bargainbarn-outlet.example'),
      payeeMerchantId: override('STORE_DISCOUNT_PAYEE_MERCHANT_ID', 'MERCH-BARGAINBARN'),
      payeeTier: 'Registered Merchant',
      registeredMerchantId: override('STORE_DISCOUNT_PAYEE_MERCHANT_ID', 'MERCH-BARGAINBARN'),
      ageDays: 210,
      registryRecords: 1,
    },
    {
      storeId: 'harborlyne-outfitters-sale',
      kind: 'impersonator',
      domain: 'www.harborlyne-outfitters-sale.example',
      brand: 'Harborline Outfitters',
      product: 'Canvas weekender bag',
      price: 29,
      benchmark: 84.5,
      currency: 'USD',
      payeeName: 'Quickpay Holdings',
      payeeEmail: override('STORE_IMPERSONATOR_PAYEE_EMAIL', 'collect@quickpay-holdings.example'),
      payeeMerchantId: override('STORE_IMPERSONATOR_PAYEE_MERCHANT_ID', 'MERCH-QUICKPAY-HOLDINGS'),
      payeeTier: 'Unverified Business',
      registeredMerchantId: override('STORE_GENUINE_PAYEE_MERCHANT_ID', 'MERCH-HARBORLINE'),
      ageDays: 6,
      registryRecords: 0,
    },
  ];
}

export function hostOf(input: string): string {
  return input.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0] ?? '';
}

export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.replace(/^www\./, '');
  return strip(hostOf(a)) === strip(hostOf(b));
}

export function findCatalogStore(idOrDomain: string): CatalogStore | undefined {
  const key = idOrDomain.trim().toLowerCase();
  return loadStoreCatalog().find((s) => s.storeId === key || sameSite(s.domain, key));
}
