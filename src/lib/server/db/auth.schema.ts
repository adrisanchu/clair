// AUTH SCHEMA — manually maintained with pgSchema("auth") namespace.
// Structure mirrors what the Better Auth CLI generates, but wrapped in pgSchema.
// After running `npm run auth:schema`, re-apply the pgSchema wrapper if needed.
import { pgSchema, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const authSchema = pgSchema('auth');

export const authUser = authSchema.table('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull(),
	image: text('image'),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull(),

	// Clair additionalFields — populated by Better Auth after configuring auth.ts
	workspaceId: text('workspace_id'), // FK enforced at app layer (cross-schema)
	role: text('role').default('member').notNull()
});

export const authSession = authSchema.table('session', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	token: text('token').notNull().unique(),
	expiresAt: timestamp('expires_at').notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull()
});

export const authAccount = authSchema.table('account', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at'),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
	scope: text('scope'),
	idToken: text('id_token'),
	password: text('password'), // hashed password for email/password auth
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull()
});

export const authVerification = authSchema.table('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
});
