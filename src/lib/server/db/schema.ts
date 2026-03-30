import {
	pgTable,
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
import { user, session, account } from './auth.schema';

export * from './auth.schema';

// ─── Enums ─────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['owner', 'member']);

export const accountStatusEnum = pgEnum('account_status', ['no_data', 'active']);

export const shareStatusEnum = pgEnum('share_status', [
	'pending',
	'accepted',
	'declined',
	'revoked'
]);

export const transactionStatusEnum = pgEnum('transaction_status', ['pending', 'posted', 'review']);

export const syncSourceEnum = pgEnum('sync_source', ['csv_upload', 'cron', 'manual']);

// ─── Workspaces ────────────────────────────────────────────────────────────

export const workspaces = pgTable('workspaces', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	ownerId: text('owner_id').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// ─── Invites ───────────────────────────────────────────────────────────────

export const invites = pgTable('invites', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspaces.id),
	email: text('email').notNull(),
	tokenHash: text('token_hash').notNull().unique(),
	invitedById: text('invited_by_id')
		.notNull()
		.references(() => user.id),
	expiresAt: timestamp('expires_at').notNull(),
	usedAt: timestamp('used_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// ─── Bank accounts ─────────────────────────────────────────────────────────

export const bankAccounts = pgTable('bank_accounts', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	ownerUserId: text('owner_user_id')
		.notNull()
		.references(() => user.id),
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
	deletedAt: timestamp('deleted_at'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// ─── Account shares ────────────────────────────────────────────────────────

export const accountShares = pgTable('account_shares', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	bankAccountId: text('bank_account_id')
		.notNull()
		.references(() => bankAccounts.id),
	sharedById: text('shared_by_id')
		.notNull()
		.references(() => user.id),
	sharedWithId: text('shared_with_id')
		.notNull()
		.references(() => user.id),
	status: shareStatusEnum('status').default('pending').notNull(),
	requestedAt: timestamp('requested_at').defaultNow().notNull(),
	respondedAt: timestamp('responded_at')
});

// ─── CSV uploads ───────────────────────────────────────────────────────────

export const csvUploads = pgTable('csv_uploads', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	bankAccountId: text('bank_account_id')
		.notNull()
		.references(() => bankAccounts.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	filename: text('filename').notNull(),
	bankProfileId: text('bank_profile_id').notNull(),
	rowCount: integer('row_count').notNull(),
	importedCount: integer('imported_count').notNull(),
	duplicateCount: integer('duplicate_count').notNull(),
	flaggedCount: integer('flagged_count').notNull(),
	openingBalance: numeric('opening_balance', { precision: 15, scale: 4 }),
	dateRangeFrom: timestamp('date_range_from', { mode: 'date' }),
	dateRangeTo: timestamp('date_range_to', { mode: 'date' }),
	uploadedAt: timestamp('uploaded_at').defaultNow().notNull()
});

// ─── Transactions ──────────────────────────────────────────────────────────

export const transactions = pgTable(
	'transactions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		bankAccountId: text('bank_account_id')
			.notNull()
			.references(() => bankAccounts.id),
		csvUploadId: text('csv_upload_id').references(() => csvUploads.id),
		externalId: text('external_id'),

		bookingDate: timestamp('booking_date', { mode: 'date' }).notNull(),
		valueDate: timestamp('value_date', { mode: 'date' }),

		amount: numeric('amount', { precision: 15, scale: 4 }).notNull(),
		currency: text('currency').notNull(),
		amountEur: numeric('amount_eur', { precision: 15, scale: 4 }),
		amountOriginal: numeric('amount_original', { precision: 15, scale: 4 }),
		currencyOriginal: text('currency_original'),

		description: text('description').notNull(),
		creditorName: text('creditor_name'),
		debtorName: text('debtor_name'),

		category: text('category'),
		categoryConfidence: numeric('category_confidence', { precision: 4, scale: 3 }),
		categoryOverride: text('category_override'),
		categoryOverrideById: text('category_override_by_id').references(() => user.id),

		isTransfer: boolean('is_transfer').default(false).notNull(),
		transferCounterpartId: text('transfer_counterpart_id'),
		transferLinkedById: text('transfer_linked_by_id').references(() => user.id),
		transferLinkedAt: timestamp('transfer_linked_at'),

		isOpeningBalance: boolean('is_opening_balance').default(false).notNull(),
		payerUserId: text('payer_user_id')
			.notNull()
			.references(() => user.id),
		tags: text('tags').array().default([]).notNull(),

		status: transactionStatusEnum('status').default('posted').notNull(),
		syncSource: syncSourceEnum('sync_source').default('csv_upload').notNull(),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	(t) => [
		uniqueIndex('transactions_dedup_idx').on(t.bankAccountId, t.externalId),
		index('transactions_date_idx').on(t.bankAccountId, t.bookingDate),
		index('transactions_transfer_idx').on(t.transferCounterpartId)
	]
);

// ─── Per-user category overrides ──────────────────────────────────────────

export const transactionOverrides = pgTable(
	'transaction_overrides',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		transactionId: text('transaction_id')
			.notNull()
			.references(() => transactions.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		category: text('category').notNull(),
		tags: text('tags').array().default([]).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	(t) => [uniqueIndex('tx_override_user_idx').on(t.transactionId, t.userId)]
);

// ─── Categories ────────────────────────────────────────────────────────────

export const categories = pgTable('categories', {
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

export const csvColumnMappings = pgTable('csv_column_mappings', {
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

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
	owner: one(user, { fields: [workspaces.ownerId], references: [user.id] }),
	bankAccounts: many(bankAccounts),
	categories: many(categories),
	csvColumnMappings: many(csvColumnMappings)
}));

// Overrides auth.schema's userRelations — includes both auth and business relations
export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account),
	bankAccounts: many(bankAccounts),
	sentShares: many(accountShares, { relationName: 'SharedBy' }),
	receivedShares: many(accountShares, { relationName: 'SharedWith' }),
	transactionOverrides: many(transactionOverrides),
	csvUploads: many(csvUploads)
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
	owner: one(user, { fields: [bankAccounts.ownerUserId], references: [user.id] }),
	workspace: one(workspaces, { fields: [bankAccounts.workspaceId], references: [workspaces.id] }),
	transactions: many(transactions),
	shares: many(accountShares),
	csvUploads: many(csvUploads)
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
	bankAccount: one(bankAccounts, {
		fields: [transactions.bankAccountId],
		references: [bankAccounts.id]
	}),
	csvUpload: one(csvUploads, { fields: [transactions.csvUploadId], references: [csvUploads.id] }),
	payer: one(user, { fields: [transactions.payerUserId], references: [user.id] }),
	counterpart: one(transactions, {
		fields: [transactions.transferCounterpartId],
		references: [transactions.id],
		relationName: 'TransferPair'
	}),
	overrides: many(transactionOverrides)
}));
