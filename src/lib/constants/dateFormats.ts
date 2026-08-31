/**
 * Date-format options for CSV export.
 *
 * Shared between the export page (dropdown labels) and the server serialiser
 * (`toCsv` / the export endpoint). Each `id` is a date-fns token string that is
 * also present in the parser's CANDIDATE_DATE_FORMATS (see parsers/detector.ts),
 * so any exported file re-imports without the adaptive parser guessing wrong.
 *
 * Formatting always reads the Date's UTC parts. `accountingDate` is stored as a
 * UTC instant (calendar day at 00:00 when the bank CSV had no time, otherwise the
 * CSV's wall-clock reinterpreted as UTC), so UTC formatting reproduces the stored
 * value regardless of the server's timezone.
 */

export const DATE_FORMAT_OPTIONS = [
	{ id: 'yyyy-MM-dd', label: 'YYYY-MM-DD', withTime: false },
	{ id: 'yyyy-MM-dd HH:mm', label: 'YYYY-MM-DD hh:mm', withTime: true },
	{ id: 'dd/MM/yyyy', label: 'DD/MM/YYYY', withTime: false },
	{ id: 'dd/MM/yyyy HH:mm', label: 'DD/MM/YYYY hh:mm', withTime: true }
] as const;

export type DateFormatId = (typeof DATE_FORMAT_OPTIONS)[number]['id'];

export const DEFAULT_DATE_FORMAT_ID: DateFormatId = 'yyyy-MM-dd';

const IDS = new Set<string>(DATE_FORMAT_OPTIONS.map((o) => o.id));

/** Narrow an untrusted string (e.g. a query param) to a known format id. */
export function isDateFormatId(value: unknown): value is DateFormatId {
	return typeof value === 'string' && IDS.has(value);
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/**
 * Format an accountingDate for export using the given format id (UTC parts).
 * Unknown ids fall back to the default. When the format has no time component
 * the date's time is simply omitted; when it does, `HH:mm` is appended — this is
 * `00:00` for rows whose source CSV carried no time.
 */
export function formatAccountingDate(date: Date, id: DateFormatId): string {
	const yyyy = date.getUTCFullYear();
	const mm = pad(date.getUTCMonth() + 1);
	const dd = pad(date.getUTCDate());
	const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

	switch (id) {
		case 'yyyy-MM-dd HH:mm':
			return `${yyyy}-${mm}-${dd} ${time}`;
		case 'dd/MM/yyyy':
			return `${dd}/${mm}/${yyyy}`;
		case 'dd/MM/yyyy HH:mm':
			return `${dd}/${mm}/${yyyy} ${time}`;
		case 'yyyy-MM-dd':
		default:
			return `${yyyy}-${mm}-${dd}`;
	}
}
