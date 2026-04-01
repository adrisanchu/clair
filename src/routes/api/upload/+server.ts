import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProfile, detectProfile, parseCSV, fileToText } from '$lib/server/parsers/index.js'
import { getAccessibleAccountIds } from '$lib/server/db/access.js'
import { classifyRow, applyStatusUpdate, applyDescUpdate } from '$lib/server/dedup.js'
import {
	computeOpeningBalance,
	upsertOpeningBalance,
	refreshCurrentBalance
} from '$lib/server/balance.js'
import { detectAndLinkTransfers } from '$lib/server/transfer-detector.js'
import { db } from '$lib/server/db/index.js'
import { transactions, csvUploads, bankAccounts } from '$lib/server/db/schema.js'
import { and, eq, inArray, isNull } from 'drizzle-orm'

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized')

	const form = await request.formData()
	const file = form.get('file')
	const profileIdParam = form.get('bankProfileId')
	const bankAccountId = form.get('bankAccountId')
	const currentBalanceParam = form.get('currentBalance')

	if (!(file instanceof File)) throw error(400, 'Missing file')
	if (typeof bankAccountId !== 'string' || !bankAccountId)
		throw error(400, 'Missing bankAccountId')
	if (file.size > 10 * 1024 * 1024) throw error(400, 'File too large (max 10 MB)')

	// Verify the user has access to this bank account
	const accessible = await getAccessibleAccountIds(locals.user.id)
	if (!accessible.includes(bankAccountId)) throw error(403, 'Access denied to this account')

	const csvText = await fileToText(file)

	const profileId =
		typeof profileIdParam === 'string' && profileIdParam
			? profileIdParam
			: detectProfile(csvText)

	if (!profileId) throw error(400, 'Could not detect bank profile. Please select one manually.')

	const profile = getProfile(profileId)
	if (!profile) throw error(400, `Unknown bank profile: ${profileId}`)

	// 1. Parse + normalise all rows
	const { rows, skippedCount, errors } = parseCSV(csvText, profile)
	if (rows.length === 0) {
		throw error(422, `No rows could be parsed. ${errors[0] ?? ''}`.trim())
	}

	// 2. Run deduplication for each row
	let importedCount = 0
	let statusUpdateCount = 0
	let duplicateCount = 0
	let flaggedCount = 0
	const insertedIds: string[] = []

	for (const row of rows) {
		const { action, existingId } = await classifyRow(row, bankAccountId)

		switch (action) {
			case 'insert': {
				const [inserted] = await db
					.insert(transactions)
					.values({
						bankAccountId,
						csvUploadId: null, // filled after csvUploads insert below
						accountingDate: row.accountingDate,
						valueDate: row.valueDate,
						amount: row.amount.toFixed(4),
						currency: row.currency,
						amountOriginal: row.amountOriginal.toFixed(4),
						currencyOriginal: row.currencyOriginal,
						description: row.description,
						isTransfer: row.isTransferCandidate,
						payerUserId: locals.user.id,
						status: row.status,
						syncSource: 'csv_upload'
					})
					.returning({ id: transactions.id })
				insertedIds.push(inserted.id)
				importedCount++
				break
			}

			case 'update_status': {
				await applyStatusUpdate(existingId!, row)
				statusUpdateCount++
				break
			}

			case 'update_desc': {
				await applyDescUpdate(existingId!, row)
				duplicateCount++ // counts as a soft duplicate (no net-new row)
				break
			}

			case 'skip': {
				duplicateCount++
				break
			}

			case 'review': {
				// Insert with status='review' so the user can resolve manually
				const [inserted] = await db
					.insert(transactions)
					.values({
						bankAccountId,
						accountingDate: row.accountingDate,
						valueDate: row.valueDate,
						amount: row.amount.toFixed(4),
						currency: row.currency,
						amountOriginal: row.amountOriginal.toFixed(4),
						currencyOriginal: row.currencyOriginal,
						description: row.description,
						isTransfer: row.isTransferCandidate,
						payerUserId: locals.user.id,
						status: 'review',
						syncSource: 'csv_upload'
					})
					.returning({ id: transactions.id })
				insertedIds.push(inserted.id)
				flaggedCount++
				break
			}
		}
	}

	// 3. Balance initialisation
	const postedRows = rows.filter((r) => r.status === 'posted')
	const latestBalanceFromCSV = postedRows
		.filter((r) => r.runningBalance !== null)
		.sort((a, b) => b.accountingDate.getTime() - a.accountingDate.getTime())[0]?.runningBalance

	if (latestBalanceFromCSV != null) {
		// Profile provides balance (e.g. Revolut Saldo) — use it directly
		await db
			.update(bankAccounts)
			.set({ currentBalance: latestBalanceFromCSV.toFixed(4), status: 'active' })
			.where(eq(bankAccounts.id, bankAccountId))
	} else if (currentBalanceParam) {
		// No balance column — user entered current balance manually (Step 3)
		const enteredBalance = parseFloat(String(currentBalanceParam))
		if (!isNaN(enteredBalance)) {
			const opening = await computeOpeningBalance(bankAccountId, enteredBalance, rows)
			const earliest = rows.reduce(
				(min, r) => (r.accountingDate < min ? r.accountingDate : min),
				rows[0].accountingDate
			)
			await upsertOpeningBalance(bankAccountId, opening, earliest, locals.user.id)
			await refreshCurrentBalance(bankAccountId)
		}
	}

	// Ensure account status is active after any successful upload
	await db
		.update(bankAccounts)
		.set({ status: 'active' })
		.where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.status, 'no_data')))

	// 4. Create csv_uploads record
	const dates = rows.map((r) => r.accountingDate)
	const dateRangeFrom = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null
	const dateRangeTo = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null

	const [upload] = await db
		.insert(csvUploads)
		.values({
			bankAccountId,
			userId: locals.user.id,
			filename: file.name,
			bankProfileId: profileId,
			rowCount: rows.length + skippedCount,
			importedCount,
			duplicateCount,
			flaggedCount,
			statusUpdates: statusUpdateCount,
			dateRangeFrom,
			dateRangeTo
		})
		.returning({ id: csvUploads.id })

	// Back-fill csvUploadId only on the rows we inserted in this upload
	if (insertedIds.length > 0) {
		await db
			.update(transactions)
			.set({ csvUploadId: upload.id })
			.where(inArray(transactions.id, insertedIds))
	}

	// 5. Transfer auto-detection on newly inserted transfer candidates
	const unresolvedTransfers = await detectAndLinkTransfers(
		insertedIds,
		accessible,
		locals.user.id
	)

	return json({
		imported: importedCount,
		statusUpdates: statusUpdateCount,
		duplicates: duplicateCount,
		flagged: flaggedCount,
		unresolvedTransfers
	})
}
