import http from 'http';
import { WebSocketServer } from 'ws';
import ccxt from 'ccxt';
import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import WebSocket from 'ws';

const prisma = new PrismaClient();
const exchange = new ccxt.binance({ enableRateLimit: true });
const symbol = 'BTC/USDT';
const binanceStreamSymbol = symbol.toLowerCase().replace('/', '');
const tfs = ['1m', '5m', '30m', '1h', '2h', '1d', '1w'];

const storage = 'storage';
const progressFile = path.join(storage, 'progress.json');
let progress: Record<string, Record<string, number>> = {};

const server = http.createServer();
const wss = new WebSocketServer({ server });
const sockets = new Set<WebSocket>();
server.listen(8080, () => console.log('📡 WS live on port 8080'));

wss.on('connection', socket => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

function broadcast(data: any) {
  const json = JSON.stringify(data);
  for (const socket of sockets) socket.send(json);
}

function msForTf(tf: string) {
  return exchange.parseTimeframe(tf) * 1000;
}

async function loadProgress() {
  try {
    await fs.mkdir(storage, { recursive: true });
    const raw = await fs.readFile(progressFile, 'utf8');
    progress = JSON.parse(raw);
  } catch {
    progress = {};
  }
}

async function saveProgress() {
  await fs.writeFile(progressFile, JSON.stringify(progress, null, 2));
}

async function checkAndFillGaps(tf: string) {
  const gapDuration = msForTf(tf);
  const rows = await prisma.candle.findMany({
    where: { symbol, timeframe: tf },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true }
  });

  for (let i = 1; i < rows.length; i++) {
    const prev = Number(rows[i - 1].timestamp);
    const curr = Number(rows[i].timestamp);
    if (curr > prev + gapDuration) {
      const from = prev + gapDuration;
      const count = Math.min(1000, Math.floor((curr - from) / gapDuration));
      const gap = await exchange.fetchOHLCV(symbol, tf, from, count);
      for (const [ts, o, h, l, c, v] of gap) {
        await prisma.candle.upsert({
          where: { symbol_timeframe_timestamp: { symbol, timeframe: tf, timestamp: ts } },
          update: { open: o, high: h, low: l, close: c, volume: v },
          create: { symbol, timeframe: tf, timestamp: ts, open: o, high: h, low: l, close: c, volume: v },
        });
      }
      console.log(`🧩 Заполнил ${gap.length} свечей в ${tf}`);
    }
  }

  const lastTs = Number(rows.at(-1)?.timestamp ?? 0);
  const now = Date.now();
  if (lastTs + gapDuration < now - gapDuration) {
    const from = lastTs + gapDuration;
    const limit = Math.floor((now - from) / gapDuration);
    const tailCandles = await exchange.fetchOHLCV(symbol, tf, from, limit);

    for (const [ts, o, h, l, c, v] of tailCandles) {
      await prisma.candle.upsert({
        where: { symbol_timeframe_timestamp: { symbol, timeframe: tf, timestamp: ts } },
        update: { open: o, high: h, low: l, close: c, volume: v },
        create: { symbol, timeframe: tf, timestamp: ts, open: o, high: h, low: l, close: c, volume: v },
      });
    }

    console.log(`📥 Дозагружено ${tailCandles.length} свечей от ${new Date(from).toISOString()}`);
  }
}

function handleKline(tf: string, kline: any) {
  const ts = kline.t;
  const o = parseFloat(kline.o);
  const h = parseFloat(kline.h);
  const l = parseFloat(kline.l);
  const c = parseFloat(kline.c);
  const v = parseFloat(kline.v);
  const closed = kline.x;

  if (closed) {
    prisma.candle.upsert({
      where: { symbol_timeframe_timestamp: { symbol, timeframe: tf, timestamp: ts } },
      update: { open: o, high: h, low: l, close: c, volume: v },
      create: { symbol, timeframe: tf, timestamp: ts, open: o, high: h, low: l, close: c, volume: v },
    }).then(() => {
      progress[symbol] = progress[symbol] || {};
      progress[symbol][tf] = ts + msForTf(tf);
      saveProgress();
      broadcast({ tf, closed: [ts, o, h, l, c, v] });
      console.log(`[${tf}] ✅ Закрыта свеча: ${new Date(ts).toISOString()}`);
    }).catch(err => {
      console.error(`[${tf}] ❌ Ошибка записи в БД:`, err);
    });
  } else {
    broadcast({ tf, forming: [ts, o, h, l, c, v] });
  }
}

function subscribeToMultiStream(tfs: string[]) {
  const streams = tfs.map(tf => `${binanceStreamSymbol}@kline_${tf}`).join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(`🔌 Подключен к Binance мульти-стриму (${tfs.join(', ')})`);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const stream = msg.stream;
      const data = msg.data;
      console.log(msg);

      if (data.e === 'kline') {
        const tf = stream.split('@kline_')[1];
        handleKline(tf, data.k);
      }
    } catch (e) {
      console.error(`❌ Ошибка парсинга сообщения Binance:`, e);
    }
  });

  ws.on('close', () => {
    console.warn('🔁 Binance мульти-стрим закрыт. Повторное подключение через 5 секунд...');
    setTimeout(() => subscribeToMultiStream(tfs), 5000);
  });

  ws.on('error', (err) => {
    console.error('❌ Ошибка WebSocket подключения Binance:', err);
    ws.close();
  });
}

// Main
(async () => {
  await loadProgress();
  await exchange.loadMarkets();

  for (const tf of tfs) {
    await checkAndFillGaps(tf);
  }

  subscribeToMultiStream(tfs);
})();

