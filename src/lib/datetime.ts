import { formatDistanceToNow } from 'date-fns';

/**
 * Coerce a timestamp value into a Date, treating naive (timezone-less) strings
 * as UTC.
 *
 * Postgres `timestamp without time zone` columns store a UTC wall-clock. When
 * read through Drizzle's mapped column they arrive as a correct `Date`, but when
 * they cross a raw `sql<...>` boundary (e.g. a `MAX(uploaded_at)` subquery) they
 * arrive as a naive string like `"2026-08-28 09:00:00"`. `new Date(str)` then
 * parses that as *local* time, shifting the instant by the browser's UTC offset
 * (+2h in CEST). Appending `Z` when no offset/`Z` is present anchors it to UTC so
 * both code paths agree.
 */
export function toUtcDate(value: Date | string): Date {
	if (value instanceof Date) return value;
	const iso = value.replace(' ', 'T');
	// A bare date ("2026-08-28") is already parsed as UTC midnight by the JS spec,
	// so only timestamps with a time component need a zone appended.
	const hasTime = iso.includes(':');
	const hasZone = /[zZ]$/.test(iso) || /[+-]\d{2}(:?\d{2})?$/.test(iso);
	if (!hasTime || hasZone) return new Date(iso);
	return new Date(`${iso}Z`);
}

/**
 * Split a stored timestamp into its UTC wall-clock date (`yyyy-MM-dd`) and time (`HH:mm`),
 * the inverse of how manual entries are saved (see `manualAccountingDate`). The time is
 * empty when it is midnight, i.e. no time was given.
 */
export function wallClockParts(value: Date | string): { date: string; time: string } {
	const iso = toUtcDate(value).toISOString();
	const time = iso.slice(11, 16);
	return { date: iso.slice(0, 10), time: time === '00:00' ? '' : time };
}

/** Build the `accountingDate` a manual entry sends: `yyyy-MM-dd`, or `yyyy-MM-ddTHH:mm`. */
export function manualAccountingDate(date: string, time: string): string {
	return time ? `${date}T${time}` : date;
}

/**
 * Format a timestamp as a relative string ("less than a minute ago"), robust to
 * both mapped `Date` values and naive UTC strings from raw SQL. Shared so the
 * accounts list, dashboard, and account-detail page cannot silently diverge.
 */
export function formatRelativeTime(value: Date | string | null): string {
	if (!value) return 'No uploads yet';
	return formatDistanceToNow(toUtcDate(value), { addSuffix: true });
}
