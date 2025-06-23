<template>
  <NavBar
  v-model:timeframe="timeframe"
  v-model:period="selectedPeriod"
  v-model:type="chartType"
  v-model:customStart="customStart"
  v-model:customEnd="customEnd"
  />
  <ClientOnly>
  <BtcChart
    :timeframe="timeframe"
    :days="periodDays"
    :type="chartType"
    :custom-start="customStart"
    :custom-end="customEnd"  />
  </ClientOnly>
</template>

<script setup lang="ts">
import NavBar from '../components/NavBar.vue';
import BtcChart from '../components/BtcChart.vue';
import { useChartState } from '../composables/useChartState';
import { ref } from 'vue';

const customStart = ref('');
const customEnd = ref('');

const { timeframe, selectedPeriod, chartType, periodDays } = useChartState();
</script>


