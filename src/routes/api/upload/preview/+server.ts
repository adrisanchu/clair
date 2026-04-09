import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uploadAndParse, getProfile } from '$lib/server/parsers/index.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	const form = await request.formData();
	const file = form.get('file');
	const profileIdParam = form.get('bankProfileId');

	if (!(file instanceof File)) throw error(400, 'Missing file');
	if (file.size > 10 * 1024 * 1024) throw error(400, 'File too large (max 10 MB)');

	let profileId: string;
	let rows: Awaited<ReturnType<typeof uploadAndParse>>['result']['rows'];
	let skippedCount: number;
	let errors: string[];
	let detectionMeta: Awaited<ReturnType<typeof uploadAndParse>>['result']['detectionMeta'];

	try {
		const parsed = await uploadAndParse(
			file,
			typeof profileIdParam === 'string' && profileIdParam ? profileIdParam : null
		);
		profileId = parsed.profileId;
		({ rows, skippedCount, errors, detectionMeta } = parsed.result);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not parse file');
	}

	// getProfile returns null for 'adaptive' — handle gracefully
	const profile = getProfile(profileId);
	const profileDisplay = profile
		? { id: profile.bankProfileId, displayName: profile.displayName }
		: { id: 'adaptive', displayName: 'Auto-detected' };

	if (rows.length === 0 && errors.length > 0) {
		throw error(422, `Could not parse CSV: ${errors[0]}`);
	}

	// Date range from parsed rows
	const dates = rows.map((r) => r.accountingDate.getTime());
	const dateRangeFrom = dates.length
		? new Date(Math.min(...dates)).toISOString().split('T')[0]
		: null;
	const dateRangeTo = dates.length
		? new Date(Math.max(...dates)).toISOString().split('T')[0]
		: null;

	// Split by status
	const postedCount = rows.filter((r) => r.status === 'posted').length;
	const pendingCount = rows.filter((r) => r.status === 'pending').length;

	// Latest balance from the most recent completed row (Revolut provides this)
	const latestCompletedRow = rows
		.filter((r) => r.status === 'posted' && r.runningBalance !== null)
		.sort((a, b) => b.accountingDate.getTime() - a.accountingDate.getTime())[0];

	return json({
		detectedProfile: profileId,
		profile: profileDisplay,
		rowCount: rows.length,
		skippedCount,
		postedCount,
		pendingCount,
		dateRangeFrom,
		dateRangeTo,
		// Balance available from CSV (skip Step 3 in UI when not null)
		latestBalance: latestCompletedRow?.runningBalance ?? null,
		// First 5 rows for preview table
		preview: rows.slice(0, 5).map((r) => ({
			accountingDate: r.accountingDate.toISOString().split('T')[0],
			description: r.description,
			amount: r.amount,
			currency: r.currency,
			status: r.status
		})),
		errors: errors.slice(0, 10),
		// Adaptive detection metadata — null when the strict profile was used successfully
		detection: detectionMeta
			? {
					usedAdaptive: true,
					overallConfidence: detectionMeta.overallConfidence,
					warnings: detectionMeta.warnings,
					detectedDelimiter: detectionMeta.detectedDelimiter.value,
					detectedDateFormat: detectionMeta.detectedDateFormat.value,
					columnMappings: Object.fromEntries(
						Object.entries(detectionMeta.columnMappingDetails).map(([f, d]) => [
							f,
							{ header: d.value, confidence: d.confidence }
						])
					)
				}
			: null
	});
};
