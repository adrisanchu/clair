export type AccountVisibility = 'private' | 'stats_only' | 'full';

export interface CategoryRow {
	id: string;
	workspaceId: string;
	parentId: string | null;
	name: string;
	color: string;
	sortOrder: number;
	createdAt: Date | string;
}

/** One node in a batch category reorder/re-nest request. */
export interface CategoryReorderItem {
	id: string;
	parentId: string | null;
	sortOrder: number;
}

export interface CostGroupRow {
	id: string;
	workspaceId: string;
	name: string;
	color: string;
	sortOrder: number;
	createdAt: Date | string;
}

export interface Account {
	id: string;
	displayName: string;
	accountType: 'bank' | 'cash';
	bankProfileId: string | null;
	ibanLast4: string | null;
	currency: string;
	status: string | null;
	visibility: AccountVisibility;
	isOwner: boolean;
	/** Native-currency balance (in `currency`). */
	currentBalance: number;
	/** EUR value of the balance (cost basis on foreign accounts). */
	balanceEur: number;
	/** Some foreign rows have no EUR value yet, so `balanceEur` is incomplete. */
	eurPartial: boolean;
	txCount: number;
	lastUploadedAt: Date | string | null;
}
