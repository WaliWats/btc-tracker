<template>
  <header class="navbar">
    <div class="logo">₿ BTC Tracker</div>
    <div class="controls">
      <div class="dropdown" style="margin-right: 1rem;" ref="dropdown">
        <button @click="toggleDropdown">
          {{ timeframeLabels[modelTf] }}
          <span class="arrow">▾</span>
        </button>
        <ul v-show="showDropdown" class="dropdown-list">
          <li
            v-for="tf in timeframes"
            :key="tf"
            @click="selectTimeframe(tf)"
            :class="{ active: modelTf === tf }"
          >
            {{ timeframeLabels[tf] }}
          </li>
        </ul>
      </div>

      <div class="period-buttons">
        <button
          v-for="p in periods"
          :key="p"
          @click="setPeriod(p)"
          :class="{ active: modelPeriod === p }"
        >
          {{ p }}
        </button>
      </div>
      <div class="type-buttons">
        <button
          @click="setChartType('line')"
          :class="{ active: modelType === 'line' }"
          title="Линейный график"
        >
          📈
        </button>
        <button
          @click="setChartType('candlestick')"
          :class="{ active: modelType === 'candlestick' }"
          title="Свечной график"
        >
          🕯️
        </button>
      </div>
      <div class="calendar-wrapper">
        <button
          @click="showDatePicker = !showDatePicker"
          :class="{ active: customStart && customEnd }"
          title="Выбрать период"
        >
          📅
        </button>

        <div v-if="showDatePicker" class="calendar-popup">
          <label>От: <input type="date" v-model="customStart" /></label>
          <label>До: <input type="date" v-model="customEnd" /></label>
          <button @click="applyCustomRange">Применить</button>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

const modelTf = defineModel<string>('timeframe');
const modelPeriod = defineModel<string>('period');
const modelType = defineModel<'line' | 'candlestick'>('type');

const showDropdown = ref(false);
const dropdown = ref<HTMLElement | null>(null);
const showDatePicker = ref(false);
const customStart = defineModel<string>('customStart');
const customEnd = defineModel<string>('customEnd');



const timeframes = ['1m', '5m', '30m', '1h', '2h', '1d', '1w'];
const timeframeLabels: Record<string, string> = {
  '1m': '1 минута',
  '5m': '5 минут',
  '30m': '30 минут',
  '1h': '1 час',
  '2h': '2 часа',
  '1d': '1 день',
  '1w': '1 неделя'
};

const periods = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'];

function toggleDropdown() {
  showDropdown.value = !showDropdown.value;
}

function selectTimeframe(tf: string) {
  modelTf.value = tf;
  showDropdown.value = false;
}

function setPeriod(p: string) {
  modelPeriod.value = p;

  // сбрасываем кастомные даты, если выбран один из пресетов
  if (customStart.value || customEnd.value) {
    customStart.value = '';
    customEnd.value = '';
  }
}


function applyCustomRange() {
  if (customStart.value && customEnd.value) {
    modelPeriod.value = `${customStart.value} → ${customEnd.value}`;
    showDatePicker.value = false;
  }
}


function setChartType(type: 'line' | 'candlestick') {
  modelType.value = type;
}

// Закрытие дропдауна при клике вне
function handleClickOutside(event: MouseEvent) {
  if (dropdown.value && !dropdown.value.contains(event.target as Node)) {
    showDropdown.value = false;
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside));
</script>

<style scoped>
.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.controls > * {
  margin-right: 1rem;
}
.controls > *:last-child {
  margin-right: 0;
}

.dropdown {
  position: relative;
  display: inline-block;
}

.dropdown button {
  background-color: #f4f4f4;
  color: #222;
  border: 1px solid #ccc;
  padding: 0.3rem 0.6rem;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.dropdown button:hover {
  background-color: #e0e0e0;
}

.dropdown-list {
  position: absolute;
  top: 100%;
  left: 0;
  background-color: #fff;
  border: 1px solid #ccc;
  list-style: none;
  padding: 0;
  margin: 0.3rem 0 0;
  width: 100%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  z-index: 1;
}

.dropdown-list li {
  padding: 0.4rem 0.6rem;
  color: #222;
  background-color: #fff;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.dropdown-list li:hover {
  background-color: #f0f0f0;
}

.dropdown-list li.active {
  background-color: #f7931a;
  color: #000;
  font-weight: bold;
}

.type-buttons,
.period-buttons {
  display: flex;
  gap: 0.4rem;
}

button {
  min-width: 80px;
  height: 32px;
  font-size: 0.9rem;
  line-height: 1.2;
  padding: 0.3rem 0.6rem;
  box-sizing: border-box;
  text-align: center;
  background-color: #f4f4f4;
  color: #222;
  border: 1px solid #ccc;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

button:hover {
  background-color: #e0e0e0;
}

button.active {
  background-color: #f7931a;
  color: #000;
  font-weight: bold;
}

.dropdown button {
  padding: 0.4rem 0.8rem;
}

.calendar-popup label {
  display: block;
  margin-bottom: 0.5rem;
}
.calendar-popup input {
  width: 100%;
}

.calendar-wrapper {
  position: relative;
  display: inline-block;
}

.calendar-popup {
  position: absolute;
  top: 110%;
  left: 0;
  background: #fff;
  border: 1px solid #ccc;
  padding: 0.5rem;
  z-index: 10;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.arrow {
  margin-left: 0.4rem;
  font-size: 0.75rem;
}
</style>
