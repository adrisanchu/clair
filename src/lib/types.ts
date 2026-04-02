export type AccountVisibility = 'private' | 'stats_only' | 'full';

export interface Account {
	id: string;
	displayName: string;
	bankProfileId: string | null;
	ibanLast4: string | null;
	currency: string;
	status: string | null;
	visibility: AccountVisibility;
	isOwner: boolean;
	currentBalance: number;
	txCount: number;
	lastUploadedAt: Date | string | null;
}
