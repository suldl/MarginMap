import type { ReviewState } from '../types';

export type Grade = 1 | 2 | 3 | 4; // again, hard, good, easy

const DAY = 86_400_000;
const MIN = 60_000;

export function newReviewState(now = Date.now()): ReviewState {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

/** SM-2 style scheduler (close to Anki's defaults, simplified). */
export function schedule(state: ReviewState, grade: Grade, now = Date.now()): ReviewState {
  let { interval, ease, reps, lapses } = state;
  if (grade === 1) {
    lapses += reps > 0 ? 1 : 0;
    reps = 0;
    ease = Math.max(1.3, ease - 0.2);
    return { due: now + 10 * MIN, interval: 0, ease, reps, lapses, last: now };
  }
  if (grade === 2) {
    interval = reps === 0 ? 1 : Math.max(1, interval * 1.2);
    ease = Math.max(1.3, ease - 0.15);
  } else if (grade === 3) {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : interval * ease;
  } else {
    interval = reps === 0 ? 4 : Math.max(interval + 1, interval * ease * 1.3);
    ease += 0.15;
  }
  interval = Math.round(interval * 10) / 10;
  return { due: now + interval * DAY, interval, ease, reps: reps + 1, lapses, last: now };
}

export function describeNext(state: ReviewState, grade: Grade): string {
  const next = schedule(state, grade, 0);
  if (next.due < DAY) return `${Math.round(next.due / MIN)}m`;
  const d = next.interval;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
