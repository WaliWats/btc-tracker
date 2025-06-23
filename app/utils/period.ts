// utils/period.ts
export const periodToDays: Record<string, number> = {
  '1D': 1,
  '5D': 5,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  'YTD': Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86_400_000),
  '1Y': 365,
  '5Y': 1825,
  'All': 3650
};
