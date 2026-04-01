import { error, json } from '@sveltejs/kit'
import { and, eq, isNull } from 'drizzle-orm'
import type { RequestHandler } from './$types'
import { db } from '$lib/server/db/index.js'
import { bankAccounts } from '$lib/server/db/schema.js'
import { getProfile, parseCSV, fileToText } from '$lib/server/parsers/index.js'

// ─── POST /api/accounts/[id]/preview ──────────────────────────────────────────
// Parse a CSV for the given bank account and return a preview — no DB writes.

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized')

	const account = await db.query.bankAccounts.findFirst({
		where: and(eq(bankAccounts.id, params.id), isNull(bankAccounts.deletedAt))
	})
	if (!account) throw error(404, 'Account not found')
	if (account.ownerUserId !== locals.user.id) throw error(403, 'Forbidden')

	const formData = await request.formData()
	const file = formData.get('file') as File | null
	if (!file) throw error(400, 'No file provided')

	const profile = getProfile(account.bankProfileId)
	if (!profile) throw error(400, `No parser for bank profile: ${account.bankProfileId}`)

	let csvText: string
	try {
		csvText = await fileToText(file)
	} catch {
		throw error(400, 'Could not read file')
	}

	const { rows, skippedCount } = parseCSV(csvText, profile)

	const preview = rows.slice(0, 5).map((r) => ({
		date: r.accountingDate.toISOString().split('T')[0],
		description: r.description,
		amount: r.amount,
		currency: r.currency
	}))

	return json({
		filename: file.name,
		profile: profile.bankProfileId,
		totalParsed: rows.length,
		skippedCount,
		preview
	})
}
