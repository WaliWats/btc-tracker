<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  Chart, LineController, LineElement, PointElement,
  LinearScale, TimeScale, Title, Tooltip, Filler
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
import zoomPlugin from 'chartjs-plugin-zoom';
import { timeframeToMs } from '../utils/timeframe';
import { computeLimit, computeSince } from '../utils/chartMath';

Chart.register(
  LineController, LineElement, PointElement,
  CandlestickController, CandlestickElement,
  LinearScale, TimeScale, Title, Tooltip, Filler, zoomPlugin
);

const props = defineProps<{
  timeframe: string;
  days: number;
  type: 'line' | 'candlestick';
  customStart?: string;
  customEnd?: string;
}>();

const canvasContainer = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;
let resizeObserver: ResizeObserver | null = null;
let socket: WebSocket | null = null;
let lastFormingX: number | null = null;

function handleMouseDown(e: MouseEvent) {
  if (e.button === 2 && chart) {
    e.preventDefault();
    canvas.value!.style.cursor = 'grabbing';
    lastPos = { x: e.clientX, y: e.clientY };
    isRightMousePanning = true;
  }
}

function handleMouseMove(e: MouseEvent) {
  if (!isRightMousePanning || !chart || !lastPos) return;
  const dx = e.clientX - lastPos.x;
  const dy = e.clientY - lastPos.y;
  chart.pan({ x: dx, y: dy }, undefined, 'default');
  lastPos = { x: e.clientX, y: e.clientY };
}

function handleMouseUp(e: MouseEvent) {
  if (e.button === 2 && chart) {
    canvas.value!.style.cursor = 'default';
    isRightMousePanning = false;
    lastPos = null;
  }
}

function handleMouseClick(e: MouseEvent) {
  if (e.button === 1) chart?.resetZoom();
}
function handleContextMenu(e: MouseEvent) {
  e.preventDefault();
}

let isRightMousePanning = false;
let lastPos: { x: number; y: number } | null = null;

async function drawChart() {
  const msPerCandle = timeframeToMs(props.timeframe);
  let since: number;
  let to: number;

  if (props.customStart && props.customEnd) {
    since = new Date(props.customStart).getTime();
    to = new Date(props.customEnd).getTime();

    // 🔐 Защита от будущего времени
    if (to > Date.now()) {
      console.warn('⏳ customEnd в будущем — сдвигаем на now');
      to = Date.now();
    }

    // 🔐 Защита от backward диапазонов
    if (since >= to) {
      alert('⛔ Начало периода позже конца. Уточни диапазон.');
      return;
    }
  } else {
    since = computeSince(Number(props.days));
    if (since > Date.now()) {
      console.warn('🛑 since в будущем — сбрасываем на now - 1d');
      since = Date.now() - 86400000;
    }
    to = Date.now();
  }

  const raw: any[] = [];
  let cursor = since;
  const max = to;

  while (cursor < max) {
    const res = await $fetch<{ meta: any; data: any[] }>(
      `/api/getPrices?tf=${props.timeframe}&since=${cursor}&to=${max}&limit=1000`
    );

    if (res.meta?.warning === 'since is in the future') {
      alert('🕒 Выбран диапазон в будущем. Нет данных.');
      return;
    }

    if (!res.data.length) break;
    raw.push(...res.data);

    const last = res.meta.lastTimestamp;
    if (!last || last + msPerCandle >= max) break;

    cursor = last + msPerCandle;
  }

  const rawClipped = raw.filter(p => p.timestamp + msPerCandle <= to);

  const data = props.type === 'candlestick'
  ? rawClipped.map(p => ({ x: p.timestamp, o: p.open, h: p.high, l: p.low, c: p.close }))
  : rawClipped.map(p => ({ x: p.timestamp, y: p.close }));


  if (chart) {
    chart.destroy();
    chart = null;
  }

  chart = new Chart(canvas.value!, {
    type: props.type,
    data: {
      datasets: [
        {
          label: `BTC/USDT (${props.timeframe})`,
          data,
          ...(props.type === 'line'
            ? {
                borderColor: '#f7931a',
                backgroundColor: 'rgba(247,147,26,0.1)',
                fill: true,
                tension: 0.3
              }
            : {
                color: {
                  up: '#26a69a',
                  down: '#ef5350',
                  unchanged: '#999'
                }
              })
        }
      ]
    },
    options: {
      parsing: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: props.timeframe.includes('d') ? 'day' : 'hour'
          },
          title: { display: true, text: 'Время' }
        },
        y: {
          position: 'right',
          beginAtZero: false,
          title: { display: true, text: 'Цена, USDT' }
        }
      },
      plugins: {
        filler: {
          propagate: true
        },
        zoom: {
          pan: { enabled: false },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            drag: {
              enabled: true,
              borderColor: 'rgba(247,147,26,0.5)',
              borderWidth: 1,
              backgroundColor: 'rgba(247,147,26,0.15)'
            },
            mode: 'xy'
          }
        }
      }
    }
  });

  lastFormingX = null;
}

function initSocket() {
  socket = new WebSocket('ws://localhost:8080');

  socket.onmessage = (event) => {
    if (!chart) return;

    const message = JSON.parse(event.data);
    const tf = message.tf;
    if (tf !== props.timeframe) return;

    const dataset = chart.data.datasets[0];
    const data = dataset.data as any[];

    // 🎯 Обработка закрытой свечи
    if (message.closed) {
      const [x, o, h, l, c] = message.closed;
      const point = props.type === 'candlestick'
        ? { x, o, h, l, c }
        : { x, y: c };

      // Удаляем формирующуюся, если совпадает
      const i = data.findIndex(p => p.x === x);
      if (i !== -1) data.splice(i, 1);

      data.push(point);
      lastFormingX = null;
      chart.update('none');
    }

    // 🟡 Обработка формирующейся свечи
    if (message.forming) {
      const [x, o, h, l, c] = message.forming;
      const candleEnd = x + timeframeToMs(props.timeframe);
      if (props.customStart && props.customEnd && candleEnd > new Date(props.customEnd).getTime()) {
        return; // не добавляем "живую" свечу
      }
      const point = props.type === 'candlestick'
        ? { x, o, h, l, c }
        : { x, y: c };

      const i = data.findIndex(p => p.x === x);
      if (i !== -1) {
        data[i] = point; // 🔄 обновляем
      } else {
        data.push(point); // ➕ добавляем
      }

      lastFormingX = x;
      chart.update('none');
    }
  };
}

function resizeChart() {
  if (canvasContainer.value && canvas.value && chart) {
    const { width, height } = canvasContainer.value.getBoundingClientRect();
    canvas.value.width = width;
    canvas.value.height = height;
    chart.resize();
  }
}

onMounted(() => {
  drawChart();
  initSocket();

  if (canvasContainer.value) {
    resizeObserver = new ResizeObserver(resizeChart);
    resizeObserver.observe(canvasContainer.value);
  }

  if (canvas.value) {
    canvas.value.addEventListener('contextmenu', handleContextMenu);
    canvas.value.addEventListener('mousedown', handleMouseDown);
    canvas.value.addEventListener('mousemove', handleMouseMove);
    canvas.value.addEventListener('mouseup', handleMouseUp);
    canvas.value.addEventListener('mousedown', handleMouseClick);
  }
});

onBeforeUnmount(() => {
  if (resizeObserver && canvasContainer.value) {
    resizeObserver.unobserve(canvasContainer.value);
  }

  if (canvas.value) {
    canvas.value.removeEventListener('contextmenu', handleContextMenu);
    canvas.value.removeEventListener('mousedown', handleMouseDown);
    canvas.value.removeEventListener('mousemove', handleMouseMove);
    canvas.value.removeEventListener('mouseup', handleMouseUp);
    canvas.value.removeEventListener('mousedown', handleMouseClick);
  }

  socket?.close();
  chart?.destroy();
  chart = null;
});

watch(
  () => [props.timeframe, props.days, props.type, props.customStart, props.customEnd],
  () => {
    if (typeof window !== 'undefined') drawChart();
  }
);
</script>

<template>
  <div ref="canvasContainer" style="width: 100%; min-height: 400px; height: 100%;">
    <canvas ref="canvas" style="display: block;" />
  </div>
</template>