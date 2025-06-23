import { timeframeToMs } from './timeframe'

export function computeLimit(tf: string, days: number): number {
  const msPerCandle = timeframeToMs(tf);
  return Math.ceil((days * 86_400_000) / msPerCandle);
}

export function computeSince(days: number): number {
  const now = Date.now();
  const duration = 86_400_000; // день
  const safeDays = isNaN(days) ? 30 : Math.min(Math.max(days, 1), 3650); // от 1 до 10 лет
  const since = now - safeDays * duration;
  return since - (since % duration); // округлить вниз до начала дня
}

