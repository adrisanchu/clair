import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';
import { queryTransactionsForExport } from '$lib/server/db/queries.js';
import { toCsv } from '$lib/server/export/toCsv.js';
import { isDateFormatId, DEFAULT_DATE_FORMAT_ID } from '$lib/constants/dateFormats.js';

/**
 * GET /api/export[?accountId=…&accountId=…]
 *
 * Streams a round-trip-safe CSV of the user's transactions. Without any
 * `accountId` params it exports every accessible account; with them it exports
 * only the requested subset (intersected with what the user may view).
 *
 * An optional `dateFormat` param controls how the Date column is rendered; anything
 * unrecognised falls back to the default (`yyyy-MM-dd`).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401);

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);
	const requested = url.searchParams.getAll('accountId');

	const dateFormatParam = url.searchParams.get('dateFormat');
	const dateFormat = isDateFormatId(dateFormatParam) ? dateFormatParam : DEFAULT_DATE_FORMAT_ID;

	const rows = await queryTransactionsForExport(accessibleIds, requested);
	const csv = toCsv(rows, dateFormat);

	const today = new Date().toISOString().slice(0, 10);

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="clair-transactions-${today}.csv"`
		}
	});
};
