import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isAiAvailable } from '$lib/server/ai/tagger.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { user: locals.user, aiAvailable: isAiAvailable() };
};
