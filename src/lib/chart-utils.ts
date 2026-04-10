import { addWeeks, addMonths, addQuarters } from 'date-fns';
import type { Granularity } from '$lib/server/db/queries.js';

export interface ProjectedPoint {
	bucket: string;
	cumulativeBalance: number;
	isProjected: true;
}

const adders: Record<Granularity, (date: Date, amount: number) => Date> = {
	week: addWeeks,
	month: addMonths,
	quarter: addQuarters
};

/**
 * Build a linear projection from the last actual data point to year-end.
 * Returns an empty array if there are fewer than 2 actual points.
 */
export function buildProjection(
	actual: Array<{ bucket: string; cumulativeBalance: number }>,
	granularity: Granularity,
	endDate: Date = new Date(new Date().getFullYear(), 11, 31)
): ProjectedPoint[] {
	if (actual.length < 2) return [];

	const first = actual[0];
	const last = actual[actual.length - 1];
	const avgChangePerBucket =
		(last.cumulativeBalance - first.cumulativeBalance) / (actual.length - 1);

	const add = adders[granularity];
	const points: ProjectedPoint[] = [];
	let step = 1;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const bucketDate = add(new Date(last.bucket), step);
		if (bucketDate > endDate) break;
		points.push({
			bucket: bucketDate.toISOString().slice(0, 10),
			cumulativeBalance: last.cumulativeBalance + avgChangePerBucket * step,
			isProjected: true
		});
		step++;
	}

	return points;
}
