import http from 'http';
import { WebSocketServer } from 'ws';
import { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';

const prisma = new PrismaClient();
const symbol = 'BTCUSDT';
const displaySymbol = 'BTC/USDT';
const tfs = ['1m', '5m', '30m', '1h', '2h', '1d', '1w'];

const tfMs: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '30m': 1800_000,
  '1h': 3_600_000, '2h': 7_200_000,
  '1d': 86_400_000, '1w': 604_800_000
};

// --- WebSocket сервер для фронта ---
const server = http.createServer();
const wss = new WebSocketServer({ server });
const sockets = new Set<WebSocket>();
server.listen(8080, () => console.log('📡 WS live on ws://localhost:8080'));

wss.on('connection', socket => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

function broadcast(data: unknown) {
  const json = JSON.stringify(data);
  for (const socket of sockets) socket.send(json);
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchBinanceOHLCV(tf: string, from: number, limit = 1000): Promise<number[][]> {
  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', tf);
  url.searchParams.set('startTime', from.toString());
  url.searchParams.set('limit', limit.toString());

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('❌ Неверный формат ответа от Binance');
    return data;
  } catch (err) {
    console.error(`❌ Ошибка загрузки OHLCV (${tf}):`, err);
    return [];
  }
}

async function upsertCandle(tf: string, ts: number, o: any, h: any, l: any, c: any, v: any) {
  const open = +o, high = +h, low = +l, close = +c, volume = +v;
  if ([open, high, low, close, volume].some(n => isNaN(n))) {
    console.warn(`[${tf}] ⚠️ Пропущена свеча с некорректными значениями: ${ts}`);
    return;
  }

  await prisma.candle.upsert({
    where: { symbol_timeframe_timestamp: { symbol: displaySymbol, timeframe: tf, timestamp: ts } },
    update: { open, high, low, close, volume },
    create: { symbol: displaySymbol, timeframe: tf, timestamp: ts, open, high, low, close, volume }
  });
}

async function checkAndFillGaps(tf: string) {
  const duration = tfMs[tf];
  const now = Date.now();
  const start = now - 30 * 24 * 60 * 60 * 1000;

  try {
    const rows = await prisma.candle.findMany({
      where: { symbol: displaySymbol, timeframe: tf, timestamp: { gte: BigInt(start) } },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true }
    });

    if (rows.length === 0) {
      // 🆕 Если база пуста — загружаем историю полностью
      let from = start - (start % duration);
      while (from <= now) {
        const limit = Math.min(1000, Math.floor((now - from) / duration) + 1);
        const candles = await fetchBinanceOHLCV(tf, from, limit);
        if (!candles.length) break;

        for (const [ts, o, h, l, c, v] of candles) {
          await upsertCandle(tf, ts, o, h, l, c, v);
        }

        console.log(`📦 ${tf}: загружено ${candles.length} свечей с ${new Date(from).toISOString()}`);
        from = candles.at(-1)![0] + duration;
        await delay(300);
      }
      return;
    }

    const timestamps = rows.map(r => Number(r.timestamp));

    // 🧩 Ищем дыры между свечами
    for (let i = 1; i < timestamps.length; i++) {
      const prev = timestamps[i - 1];
      const curr = timestamps[i];
      if (curr > prev + duration) {
        let from = prev + duration;
        const to = curr - duration;

        while (from <= to) {
          const limit = Math.min(1000, Math.floor((to - from) / duration) + 1);
          const candles = await fetchBinanceOHLCV(tf, from, limit);
          if (!candles.length) break;

          for (const [ts, o, h, l, c, v] of candles) {
            await upsertCandle(tf, ts, o, h, l, c, v);
          }

          console.log(`🧩 ${tf}: заполнено ${candles.length} свечей в пропуске с ${new Date(from).toISOString()}`);
          from = candles.at(-1)![0] + duration;
          await delay(300);
        }
      }
    }

    // ⏳ Дозагружаем хвост до now
    let from = timestamps.at(-1)! + duration;
    while (from <= now) {
      const limit = Math.min(1000, Math.floor((now - from) / duration) + 1);
      const candles = await fetchBinanceOHLCV(tf, from, limit);
      if (!candles.length) break;

      for (const [ts, o, h, l, c, v] of candles) {
        await upsertCandle(tf, ts, o, h, l, c, v);
      }

      console.log(`📥 ${tf}: дозагружено ${candles.length} свечей до текущего момента`);
      from = candles.at(-1)![0] + duration;
      await delay(300);
    }
    const last = await prisma.candle.findFirst({
      where: { symbol: displaySymbol, timeframe: tf },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true }
    });
    console.log(`🧼 ${tf}: Последняя свеча в БД: ${new Date(Number(last?.timestamp)).toISOString()}`);

  } catch (err) {
    console.error(`❌ checkAndFillGaps(${tf}):`, err);
  }
}





function handleKline(tf: string, k: any) {
  const ts = k.t;
  const o = k.o;
  const h = k.h;
  const l = k.l;
  const c = k.c;
  const v = k.v;
  const isClosed = k.x;

  upsertCandle(tf, ts, o, h, l, c, v).then(() => {
    if (isClosed) {
      broadcast({ tf, closed: [ts, +o, +h, +l, +c, +v] });
      console.log(`[${tf}] ✅ Закрыта свеча: ${new Date(ts).toISOString()}`);
    } else {
      broadcast({ tf, forming: [ts, +o, +h, +l, +c, +v] });
    }
  }).catch(err => {
    console.error(`[${tf}] ❌ Ошибка записи в БД:`, err);
  });
}

function subscribeToMultiStream(tfs: string[]) {
  const streams = tfs.map(tf => `${symbol.toLowerCase()}@kline_${tf}`).join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(`🔌 Подключен к Binance WebSocket (${tfs.join(', ')})`);
  });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.data?.e !== 'kline') return;
      const tf = msg.stream.split('@kline_')[1];
      handleKline(tf, msg.data.k);
    } catch (err) {
      console.error('❌ Ошибка парсинга сообщения Binance:', err);
    }
  });

  ws.on('close', () => {
    console.warn('🔁 Переподключение к Binance через 5с...');
    setTimeout(() => subscribeToMultiStream(tfs), 5000);
  });

  ws.on('error', err => {
    console.error('❌ WebSocket Binance ошибка:', err);
    ws.close();
  });
}

// 🚀 Старт
(async () => {
  for (const tf of tfs) {
    await checkAndFillGaps(tf);
  }
  subscribeToMultiStream(tfs);
})();
