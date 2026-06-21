import { env } from '$env/dynamic/private';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '$lib/constants/ai.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CategoryMapping {
	csvCategory: string;
	matchedCategory: string | null;
	confidence: number;
}

export interface TagItem {
	id: string;
	description: string;
	amount: number;
	currency: string;
}

export interface TagResult {
	id: string;
	category: string;
	confidence: number;
	isTransfer: boolean;
}

// ─── Client ─────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
	if (_client) return _client;
	const key = env.ANTHROPIC_API_KEY;
	if (!key) return null;
	_client = new Anthropic({ apiKey: key });
	return _client;
}

export function isAiAvailable(): boolean {
	return !!env.ANTHROPIC_API_KEY;
}

// ─── Category Matching ──────────────────────────────────────────────────────

/**
 * Uses AI to fuzzy-match CSV category values against workspace categories.
 * Handles case differences, translations (e.g. Spanish ↔ English),
 * abbreviations, and semantic similarity.
 *
 * Falls back to case-insensitive exact matching when AI is unavailable.
 */
export async function matchCategories(
	csvCategories: string[],
	workspaceCategories: string[]
): Promise<CategoryMapping[]> {
	if (csvCategories.length === 0) return [];

	// Fallback: case-insensitive exact matching
	const client = getClient();
	if (!client || workspaceCategories.length === 0) {
		const lowerMap = new Map(workspaceCategories.map((c) => [c.toLowerCase(), c]));
		return csvCategories.map((csv) => {
			const match = lowerMap.get(csv.toLowerCase().trim()) ?? null;
			return { csvCategory: csv, matchedCategory: match, confidence: match ? 1.0 : 0 };
		});
	}

	try {
		const res = await client.messages.create({
			model: AI_MODEL,
			max_tokens: 1024,
			messages: [
				{
					role: 'user',
					content: `You are a personal finance category matcher.

I have a list of category names from a CSV bank export and a list of canonical categories from the user's workspace. Match each CSV category to the best workspace category.

Consider:
- Case differences ("GROCERIES" → "Groceries")
- Translations between Spanish and English ("Alimentación" → "Groceries", "Restaurantes" → "Restaurants")
- Abbreviations and partial matches ("restaurants & other" → "Restaurants")
- Semantic similarity ("Comida fuera" → "Restaurants", "Transporte público" → "Transport")

Workspace categories: ${JSON.stringify(workspaceCategories)}
CSV categories to match: ${JSON.stringify(csvCategories)}

Return ONLY a valid JSON array. No explanation, no markdown.
Each item: {"csv":"<original csv value>","match":"<workspace category name or null>","confidence":0.00}

Set match to null if no good match exists (confidence < 0.5).
Confidence should reflect how certain you are: 1.0 for exact/trivial matches, 0.85+ for clear semantic matches, 0.6-0.84 for plausible but uncertain matches.`
				}
			]
		});

		logUsage('matchCategories', res.usage);

		const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
		const parsed = JSON.parse(text) as Array<{
			csv: string;
			match: string | null;
			confidence: number;
		}>;

		// Validate: only return matches that are in the workspace categories list
		const validNames = new Set(workspaceCategories);
		return parsed.map((r) => ({
			csvCategory: r.csv,
			matchedCategory: r.match && validNames.has(r.match) ? r.match : null,
			confidence: r.match && validNames.has(r.match) ? r.confidence : 0
		}));
	} catch (err) {
		console.error('[AI] matchCategories failed:', err);
		// Fallback to case-insensitive exact matching
		const lowerMap = new Map(workspaceCategories.map((c) => [c.toLowerCase(), c]));
		return csvCategories.map((csv) => {
			const match = lowerMap.get(csv.toLowerCase().trim()) ?? null;
			return { csvCategory: csv, matchedCategory: match, confidence: match ? 1.0 : 0 };
		});
	}
}

// ─── Transaction Tagging ────────────────────────────────────────────────────

/**
 * Classifies a batch of uncategorised transactions using AI.
 * Returns category assignments with confidence scores.
 *
 * Returns empty array when AI is unavailable.
 */
export async function tagBatch(
	items: TagItem[],
	categories: string[],
	fewShot?: string
): Promise<TagResult[]> {
	if (items.length === 0) return [];

	const client = getClient();
	if (!client) return [];

	try {
		const res = await client.messages.create({
			model: AI_MODEL,
			max_tokens: 1024,
			messages: [
				{
					role: 'user',
					content: `You are a personal finance transaction classifier for a Spanish user.
Return ONLY a valid JSON array. No explanation, no markdown.
${fewShot ? `\nKnown corrections:\n${fewShot}\n` : ''}
Categories: ${categories.join(', ')}
Classify these ${items.length} transactions:
${JSON.stringify(items)}
Each item: {"id":"...","category":"...","confidence":0.00,"isTransfer":false}`
				}
			]
		});

		logUsage('tagBatch', res.usage);

		const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
		const parsed = JSON.parse(text) as TagResult[];

		// Validate: only accept categories from the provided list
		const validNames = new Set(categories);
		return parsed.filter(
			(r) => r.id && validNames.has(r.category) && typeof r.confidence === 'number'
		);
	} catch (err) {
		console.error('[AI] tagBatch failed:', err);
		return [];
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function logUsage(fn: string, usage: Anthropic.Usage) {
	console.info(`[AI] ${fn}: ${usage.input_tokens} in / ${usage.output_tokens} out tokens`);
}
