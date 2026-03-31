-- First migration: create PostgreSQL schemas
-- auth: owned by Better Auth (user, session, account, verification)
-- core: owned by Clair app (workspaces, bank_accounts, transactions, etc.)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS core;
