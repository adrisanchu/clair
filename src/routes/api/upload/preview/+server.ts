import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProfile, detectProfile, parseCSV, fileToText } from '$lib/server/parsers/index.js'

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized')

	const form = await request.formData()
	const file = form.get('file')
	const profileIdParam = form.get('bankProfileId')

	if (!(file instanceof File)) throw error(400, 'Missing file')
	if (file.size > 10 * 1024 * 1024) throw error(400, 'File too large (max 10 MB)')

	const csvText = await fileToText(file)

	// Resolve profile: use provided ID or auto-detect from header
	const profileId =
		typeof profileIdParam === 'string' && profileIdParam
			? profileIdParam
			: detectProfile(csvText)

	if (!profileId) throw error(400, 'Could not detect bank profile. Please select one manually.')

	const profile = getProfile(profileId)
	if (!profile) throw error(400, `Unknown bank profile: ${profileId}`)

	const { rows, skippedCount, errors } = parseCSV(csvText, profile)

	if (rows.length === 0 && errors.length > 0) {
		throw error(422, `Could not parse CSV: ${errors[0]}`)
	}

	// Date range from parsed rows
	const dates = rows.map((r) => r.accountingDate.getTime())
	const dateRangeFrom = dates.length ? new Date(Math.min(...dates)).toISOString().split('T')[0] : null
	const dateRangeTo = dates.length ? new Date(Math.max(...dates)).toISOString().split('T')[0] : null

	// Split by status
	const postedCount = rows.filter((r) => r.status === 'posted').length
	const pendingCount = rows.filter((r) => r.status === 'pending').length

	// Latest balance from the most recent completed row (Revolut provides this)
	const latestCompletedRow = rows
		.filter((r) => r.status === 'posted' && r.runningBalance !== null)
		.sort((a, b) => b.accountingDate.getTime() - a.accountingDate.getTime())[0]

	return json({
		detectedProfile: profileId,
		profile: { id: profile.bankProfileId, displayName: profile.displayName },
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
		errors: errors.slice(0, 10)
	})
}
