import { ref, computed } from 'vue';

const timeframe = ref('1m');
const selectedPeriod = ref('1D');
const chartType = ref<'line' | 'candlestick'>('candlestick');

const periodToDays: Record<string, number> = {
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

const periodDays = computed(() => periodToDays[selectedPeriod.value] || 30);

export function useChartState() {
  return {
    timeframe,
    selectedPeriod,
    chartType,
    periodDays
  };
}
