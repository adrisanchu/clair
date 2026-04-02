import {
	pgSchema,
	pgEnum,
	text,
	timestamp,
	boolean,
	numeric,
	integer,
	uniqueIndex,
	index
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { authUser } from './auth.schema';

export { authUser, authSession, authAccount, authVerification } from './auth.schema';

const coreSchema = pgSchema('core');

// ─── Enums ─────────────────────────────────────────────────────────────────
// Enums live in the public schema (Postgres default) for simplicity.

export const accountStatusEnum = pgEnum('account_status', ['no_data', 'active']);

export const accountVisibilityEnum = pgEnum('account_visibility', [
	'private',
	'stats_only',
	'full'
]);

export const transactionStatusEnum = pgEnum('transaction_status', ['pending', 'posted', 'review']);

export const syncSourceEnum = pgEnum('sync_source', ['csv_upload', 'cron', 'manual']);

// ─── Workspaces ────────────────────────────────────────────────────────────

export const workspaces = coreSchema.table('workspaces', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	// ownerId references auth.user.id — enforced at app layer (cross-schema)
	ownerId: text('owner_id').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// ─── Invites ───────────────────────────────────────────────────────────────

export const invites = coreSchema.table('invites', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspaces.id),
	email: text('email').notNull(),
	tokenHash: text('token_hash').notNull().unique(),
	// invitedById references auth.user.id — enforced at app layer (cross-schema)
	invitedById: text('invited_by_id').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	usedAt: timestamp('used_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// ─── Bank accounts ─────────────────────────────────────────────────────────

export const bankAccounts = coreSchema.table('bank_accounts', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	// ownerUserId references auth.user.id — enforced at app layer (cross-schema)
	ownerUserId: text('owner_user_id').notNull(),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspaces.id),
	displayName: text('display_name').notNull(),
	institutionName: text('institution_name').notNull(),
	bankProfileId: text('bank_profile_id').notNull(),
	ibanLast4: text('iban_last4').notNull(),
	currency: text('currency').default('EUR').notNull(),
	currentBalance: numeric('current_balance', { precision: 15, scale: 4 }).default('0').notNull(),
	status: accountStatusEnum('status').default('no_data').notNull(),
	// Controls partner access: private = owner only, stats_only = aggregated data, full = all transactions
	visibility: accountVisibilityEnum('visibility').default('private').notNull(),
	deletedAt: timestamp('deleted_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// ─── CSV uploads ───────────────────────────────────────────────────────────

export const csvUploads = coreSchema.table('csv_uploads', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	bankAccountId: text('bank_account_id')
		.notNull()
		.references(() => bankAccounts.id, { onDelete: 'cascade' }),
	// userId references auth.user.id — enforced at app layer
	userId: text('user_id').notNull(),
	filename: text('filename').notNull(),
	bankProfileId: text('bank_profile_id').notNull(),
	rowCount: integer('row_count').notNull(),
	importedCount: integer('imported_count').notNull(),
	duplicateCount: integer('duplicate_count').notNull(),
	flaggedCount: integer('flagged_count').notNull(),
	statusUpdates: integer('status_updates').default(0).notNull(),
	openingBalance: numeric('opening_balance', { precision: 15, scale: 4 }),
	dateRangeFrom: timestamp('date_range_from', { mode: 'date' }),
	dateRangeTo: timestamp('date_range_to', { mode: 'date' }),
	uploadedAt: timestamp('uploaded_at').defaultNow().notNull()
});

// ─── Transactions ──────────────────────────────────────────────────────────

export const transactions = coreSchema.table(
	'transactions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		bankAccountId: text('bank_account_id')
			.notNull()
			.references(() => bankAccounts.id, { onDelete: 'cascade' }),
		csvUploadId: text('csv_upload_id').references(() => csvUploads.id, { onDelete: 'set null' }),
		externalId: text('external_id'),

		accountingDate: timestamp('accounting_date', { mode: 'date' }).notNull(),
		valueDate: timestamp('value_date', { mode: 'date' }),

		amount: numeric('amount', { precision: 15, scale: 4 }).notNull(),
		currency: text('currency').notNull(),
		amountEur: numeric('amount_eur', { precision: 15, scale: 4 }),
		amountOriginal: numeric('amount_original', { precision: 15, scale: 4 }),
		currencyOriginal: text('currency_original'),

		description: text('description').notNull(),
		creditorName: text('creditor_name'),
		debtorName: text('debtor_name'),

		// AI tagging — never overwritten on re-upload
		category: text('category'),
		categoryConfidence: numeric('category_confidence', { precision: 4, scale: 3 }),

		// User corrections — never overwritten on re-upload
		categoryOverride: text('category_override'),
		// categoryOverrideById references auth.user.id — enforced at app layer
		categoryOverrideById: text('category_override_by_id'),
		notes: text('notes'),
		city: text('city'),
		tags: text('tags').array().default([]).notNull(),

		// Transfer linking — self-referential; set via UPDATE after insert
		isTransfer: boolean('is_transfer').default(false).notNull(),
		transferCounterpartId: text('transfer_counterpart_id'), // → transactions.id
		// transferLinkedById references auth.user.id — enforced at app layer
		transferLinkedById: text('transfer_linked_by_id'),
		transferLinkedAt: timestamp('transfer_linked_at'),

		// Expense split — null means 100% mine; 0.5 means I pay half, etc.
		// Used for dashboard "effective expense" calculation without a full Splitwise model.
		myPortion: numeric('my_portion', { precision: 4, scale: 3 }),

		// System flags
		isOpeningBalance: boolean('is_opening_balance').default(false).notNull(),
		// payerUserId references auth.user.id — enforced at app layer
		payerUserId: text('payer_user_id').notNull(),

		status: transactionStatusEnum('status').default('posted').notNull(),
		syncSource: syncSourceEnum('sync_source').default('csv_upload').notNull(),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	(t) => [
		uniqueIndex('transactions_dedup_idx').on(t.bankAccountId, t.externalId),
		index('transactions_accounting_date_idx').on(t.bankAccountId, t.accountingDate),
		index('transactions_transfer_idx').on(t.transferCounterpartId)
	]
);

// ─── Per-user category overrides ──────────────────────────────────────────

export const transactionOverrides = coreSchema.table(
	'transaction_overrides',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		transactionId: text('transaction_id')
			.notNull()
			.references(() => transactions.id, { onDelete: 'cascade' }),
		// userId references auth.user.id — enforced at app layer
		userId: text('user_id').notNull(),
		category: text('category').notNull(),
		tags: text('tags').array().default([]).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	(t) => [uniqueIndex('tx_override_user_idx').on(t.transactionId, t.userId)]
);

// ─── Categories ────────────────────────────────────────────────────────────

export const categories = coreSchema.table('categories', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspaces.id),
	name: text('name').notNull(),
	color: text('color').default('#6b7280').notNull(),
	sortOrder: integer('sort_order').default(0).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// ─── CSV column mappings ───────────────────────────────────────────────────

export const csvColumnMappings = coreSchema.table('csv_column_mappings', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspaces.id),
	columnKey: text('column_key').notNull(),
	columnLabel: text('column_label').notNull(),
	sortOrder: integer('sort_order').notNull(),
	enabled: boolean('enabled').default(true).notNull()
});

// ─── Relations ─────────────────────────────────────────────────────────────
// Cross-schema relations (touching authUser) use Drizzle relation API without
// a DB-level FK. This is fine — relations are used only by the query builder.

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
	owner: one(authUser, { fields: [workspaces.ownerId], references: [authUser.id] }),
	bankAccounts: many(bankAccounts),
	categories: many(categories),
	csvColumnMappings: many(csvColumnMappings),
	invites: many(invites)
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
	owner: one(authUser, { fields: [bankAccounts.ownerUserId], references: [authUser.id] }),
	workspace: one(workspaces, { fields: [bankAccounts.workspaceId], references: [workspaces.id] }),
	transactions: many(transactions),
	csvUploads: many(csvUploads)
}));

export const csvUploadsRelations = relations(csvUploads, ({ one, many }) => ({
	bankAccount: one(bankAccounts, {
		fields: [csvUploads.bankAccountId],
		references: [bankAccounts.id]
	}),
	uploadedBy: one(authUser, { fields: [csvUploads.userId], references: [authUser.id] }),
	transactions: many(transactions)
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
	bankAccount: one(bankAccounts, {
		fields: [transactions.bankAccountId],
		references: [bankAccounts.id]
	}),
	csvUpload: one(csvUploads, {
		fields: [transactions.csvUploadId],
		references: [csvUploads.id]
	}),
	payer: one(authUser, { fields: [transactions.payerUserId], references: [authUser.id] }),
	counterpart: one(transactions, {
		fields: [transactions.transferCounterpartId],
		references: [transactions.id],
		relationName: 'TransferPair'
	}),
	counterpartOf: many(transactions, { relationName: 'TransferPair' }),
	overrides: many(transactionOverrides)
}));

export const transactionOverridesRelations = relations(transactionOverrides, ({ one }) => ({
	transaction: one(transactions, {
		fields: [transactionOverrides.transactionId],
		references: [transactions.id]
	}),
	user: one(authUser, { fields: [transactionOverrides.userId], references: [authUser.id] })
}));

export const categoriesRelations = relations(categories, ({ one }) => ({
	workspace: one(workspaces, { fields: [categories.workspaceId], references: [workspaces.id] })
}));

export const csvColumnMappingsRelations = relations(csvColumnMappings, ({ one }) => ({
	workspace: one(workspaces, {
		fields: [csvColumnMappings.workspaceId],
		references: [workspaces.id]
	})
}));

export const invitesRelations = relations(invites, ({ one }) => ({
	workspace: one(workspaces, { fields: [invites.workspaceId], references: [workspaces.id] }),
	invitedBy: one(authUser, { fields: [invites.invitedById], references: [authUser.id] })
}));

// Cross-schema inverse: authUser many-sides for all core references.
// Defined here (not in auth.schema.ts) to keep auth schema auto-regenerable.
export const userRelations = relations(authUser, ({ many }) => ({
	ownedWorkspaces: many(workspaces),
	bankAccounts: many(bankAccounts),
	csvUploads: many(csvUploads),
	paidTransactions: many(transactions),
	transactionOverrides: many(transactionOverrides),
	invitesSent: many(invites)
}));
