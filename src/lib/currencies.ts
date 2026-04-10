/**
 * The workspace's primary (home) currency.
 * All dashboards, totals, and charts are expressed in this currency.
 * In a future version this will be a per-workspace setting; for now it is fixed.
 */
export const PRIMARY_CURRENCY = 'EUR';

/** Supported currencies with their display labels. */
export const CURRENCIES: { code: string; label: string }[] = [
	{ code: 'EUR', label: 'EUR — Euro' },
	{ code: 'USD', label: 'USD — US Dollar' },
	{ code: 'GBP', label: 'GBP — British Pound' },
	{ code: 'SEK', label: 'SEK — Swedish Krona' },
	{ code: 'DKK', label: 'DKK — Danish Krone' },
	{ code: 'NOK', label: 'NOK — Norwegian Krone' },
	{ code: 'CHF', label: 'CHF — Swiss Franc' },
	{ code: 'JPY', label: 'JPY — Japanese Yen' },
	{ code: 'CAD', label: 'CAD — Canadian Dollar' },
	{ code: 'AUD', label: 'AUD — Australian Dollar' },
	{ code: 'NZD', label: 'NZD — New Zealand Dollar' },
	{ code: 'SGD', label: 'SGD — Singapore Dollar' },
	{ code: 'HKD', label: 'HKD — Hong Kong Dollar' },
	{ code: 'CNY', label: 'CNY — Chinese Yuan' },
	{ code: 'KRW', label: 'KRW — South Korean Won' },
	{ code: 'INR', label: 'INR — Indian Rupee' },
	{ code: 'BRL', label: 'BRL — Brazilian Real' },
	{ code: 'MXN', label: 'MXN — Mexican Peso' },
	{ code: 'ZAR', label: 'ZAR — South African Rand' },
	{ code: 'TRY', label: 'TRY — Turkish Lira' },
	{ code: 'PLN', label: 'PLN — Polish Zloty' },
	{ code: 'CZK', label: 'CZK — Czech Koruna' },
	{ code: 'HUF', label: 'HUF — Hungarian Forint' },
	{ code: 'RON', label: 'RON — Romanian Leu' },
	{ code: 'BGN', label: 'BGN — Bulgarian Lev' },
	{ code: 'ISK', label: 'ISK — Icelandic Króna' },
	{ code: 'THB', label: 'THB — Thai Baht' },
	{ code: 'MYR', label: 'MYR — Malaysian Ringgit' },
	{ code: 'IDR', label: 'IDR — Indonesian Rupiah' }
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);
