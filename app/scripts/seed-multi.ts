import { PrismaClient } from '@prisma/client';
import ccxt from 'ccxt';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();
const exchange = new ccxt.binance({ enableRateLimit: true });

const symbol = 'BTC/USDT';
const tfs = ['1m', '5m', '30m', '1h', '2h', '1d', '1w'];
const limit = 1000;
const storageDir = 'storage';
const progressFile = path.join(storageDir, 'progress.json');
const dayMs = 86_400_000;
const yearMs = 365 * dayMs;
const defaultSince = Date.now() - 5 * yearMs;

let progress: Record<string, Record<string, number>> = {};

async function loadProgress() {
  try {
    await fs.mkdir(storageDir, { recursive: true });
    const data = await fs.readFile(progressFile, 'utf8');
    progress = JSON.parse(data);
  } catch {
    progress = {};
  }
}

async function saveProgress() {
  await fs.writeFile(progressFile, JSON.stringify(progress, null, 2));
}

const maxHistoryPerTf: Record<string, number> = {
  '1m': 30 * dayMs,
  '5m': 60 * dayMs,
  '30m': 180 * dayMs,
  '1h': 365 * dayMs,
  '2h': 2 * yearMs,
  '1d': 5 * yearMs,
  '1w': 10 * yearMs,
};

async function fetchAndInsert(tf: string) {
  console.log(`\n⏳ Загрузка ${tf}...`);
  await exchange.loadMarkets();
  const now = Date.now();
  const historyCap = maxHistoryPerTf[tf] ?? 5 * yearMs;
  const fromLimit = now - historyCap;
  console.log(`🔐 fromLimit для ${tf}: ${new Date(fromLimit).toISOString()}`);
  // если сидер уже дошёл до "капнутого" начала — уважаем это
  const tfProgress = progress[symbol]?.[tf] ?? fromLimit;
  let from = Math.max(tfProgress, fromLimit);
  let total = 0;

  while (from < now) {
    const candles = await exchange.fetchOHLCV(symbol, tf, from, limit);
    const duration = exchange.parseTimeframe(tf) * 1000;
    const last = candles.at(-1);
    const isLive = last && (last[0] + duration > Date.now());

    if (isLive) {
      candles.pop(); // 🧼 убираем незавершённую свечу из конца массива
    }


    if (!candles.length) break;

    for (const [timestamp, open, high, low, close, volume] of candles) {
      await prisma.candle.upsert({
        where: { symbol_timeframe_timestamp: { symbol, timeframe: tf, timestamp } },
        update: { open, high, low, close, volume },
        create: { symbol, timeframe: tf, timestamp, open, high, low, close, volume },
      });
    }

    from = candles.at(-1)![0] + exchange.parseTimeframe(tf) * 1000;
    progress[symbol] = progress[symbol] || {};
    progress[symbol][tf] = from;
    await saveProgress();
    await new Promise(res => setTimeout(res, 300)); // 0.3 сек пауза

    total += candles.length;
    console.log(`📦 ${tf}: ещё ${candles.length}, всего: ${total}`);
  }

  console.log(`✅ Готово для ${tf}: всего ${total} свечей`);
}

export async function runFullSeeder() {
  await loadProgress();
  for (const tf of tfs) {
    await fetchAndInsert(tf);
  }
  await prisma.$disconnect();
}


