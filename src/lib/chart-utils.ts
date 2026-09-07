import { addWeeks, addMonths, addQuarters, format, getQuarter, getYear } from 'date-fns';
import type { Granularity } from '$lib/server/db/queries.js';

export interface ProjectedPoint {
	bucket: string;
	cumulativeBalance: number;
	isProjected: true;
}

// ---------------------------------------------------------------------------
// Shared axis / tooltip formatters (reused by BalanceChart + insights timeline)
// ---------------------------------------------------------------------------

/** Short x-axis tick per granularity, e.g. "Mar 5" / "Mar 26" / "Q1 '26". */
export function formatBucketTick(date: Date, granularity: Granularity): string {
	if (granularity === 'week') return format(date, 'MMM d');
	// Shorten quarter label so 4 labels always fit: "Q1 '26"
	if (granularity === 'quarter') return `Q${getQuarter(date)} '${String(getYear(date)).slice(2)}`;
	return format(date, 'MMM yy');
}

/** Full tooltip label per granularity, e.g. "5 Mar 2026" / "March 2026" / "Q1 2026". */
export function formatBucketLabel(date: Date, granularity: Granularity): string {
	if (granularity === 'week') return format(date, 'd MMM yyyy');
	if (granularity === 'quarter') return `Q${getQuarter(date)} ${getYear(date)}`;
	return format(date, 'MMMM yyyy');
}

/** Compact EUR for y-axis — avoids the Spanish "mil €" ambiguity by using a K suffix. */
export function formatCompactEur(v: number): string {
	const abs = Math.abs(v);
	const sign = v < 0 ? '-' : '';
	if (abs >= 1000) {
		const k = abs / 1000;
		return `${sign}${k.toLocaleString('es-ES', { maximumFractionDigits: 1 })}K €`;
	}
	return `${sign}${abs.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`;
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
	const lastBucketDate =
		points.length > 0 ? new Date(points[points.length - 1].bucket) : new Date(last.bucket);
	if (lastBucketDate < endDate) {
		const lastBalance =
			points.length > 0 ? points[points.length - 1].cumulativeBalance : last.cumulativeBalance;
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
