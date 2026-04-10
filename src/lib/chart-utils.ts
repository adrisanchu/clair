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

	// Always anchor the projection to endDate so the chart domain ends there for all
	// granularities. Without this, quarterly's last bucket (Oct 1) causes scaleUtc.nice(4)
	// to extend the domain to Jan 1 next year, leaving a blank strip on the right.
	const lastBucketDate = points.length > 0 ? new Date(points[points.length - 1].bucket) : new Date(last.bucket);
	if (lastBucketDate < endDate) {
		const lastBalance = points.length > 0 ? points[points.length - 1].cumulativeBalance : last.cumulativeBalance;
		// Use the actual next-step duration from the last bucket to get the correct fraction
		const nextBucketDate = add(lastBucketDate, 1);
		const bucketDurationMs = nextBucketDate.getTime() - lastBucketDate.getTime();
		const fraction = (endDate.getTime() - lastBucketDate.getTime()) / bucketDurationMs;
		points.push({
			bucket: endDate.toISOString().slice(0, 10),
			cumulativeBalance: lastBalance + avgChangePerBucket * fraction,
			isProjected: true
		});
	}

	return points;
}
