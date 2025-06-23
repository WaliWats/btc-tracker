import { defineEventHandler, getQuery, createError } from 'h3';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { timeframeToMs } from '../../utils/timeframe';

const querySchema = z.object({
  tf: z.string().optional().default('1h'),
  since: z.string().transform(Number).optional(),
  to: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  symbol: z.string().optional().default('BTC/USDT'),
  fillToNow: z.enum(['true', 'false']).optional().default('true')
});

export default defineEventHandler(async (event) => {
  const parsed = querySchema.safeParse(getQuery(event));

  if (!parsed.success) {
    console.warn('❌ Ошибочные параметры запроса:', parsed.error.format());
    throw createError({ statusCode: 400, statusMessage: 'Неверные query-параметры' });
  }

  const { tf, symbol, since: rawSince, to: rawTo, limit: rawLimit, fillToNow } = parsed.data;
  const symbolNorm = symbol.toUpperCase();
  const now = Date.now();
  const msPerCandle = timeframeToMs(tf);

  const since = rawSince ?? now - 30 * 24 * 60 * 60 * 1000;
  const to = rawTo ?? (fillToNow === 'true' ? now : since + msPerCandle * 500);
  const maxCandles = Math.floor((to - since) / msPerCandle);
  const limit = Math.min(rawLimit ?? maxCandles, 10000); // можно увеличить максимум

  if (isNaN(since) || isNaN(to) || since >= to || limit <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный диапазон времени или лимит' });
  }

  if (since > now) {
    console.warn(`⚠️ since=${new Date(since).toISOString()} в будущем — возвращаем пустой массив`);
    return {
      meta: {
        symbol: symbolNorm,
        timeframe: tf,
        from: since,
        to,
        limit,
        msPerCandle,
        warning: 'since is in the future'
      },
      data: []
    };
  }

  try {
    const candles = [];
    let cursor = since;

    while (candles.length < limit && cursor <= to) {
      const chunk = await prisma.candle.findMany({
        where: {
          symbol: symbolNorm,
          timeframe: tf,
          timestamp: {
            gte: BigInt(cursor),
            lte: BigInt(to)
          }
        },
        orderBy: { timestamp: 'asc' },
        take: Math.min(1000, limit - candles.length)
      });

      if (!chunk.length) break;

      candles.push(...chunk);
      cursor = Number(chunk.at(-1)!.timestamp) + msPerCandle;
    }

    return {
      meta: {
        symbol: symbolNorm,
        timeframe: tf,
        from: since,
        to,
        limit,
        count: candles.length,
        msPerCandle,
        lastTimestamp: candles.at(-1) ? Number(candles.at(-1)!.timestamp) : null
      },
      data: candles.map(c => ({
        ...c,
        timestamp: Number(c.timestamp)
      }))
    };
  } catch (err) {
    console.error('❌ Ошибка Prisma:', err);
    throw createError({ statusCode: 500, statusMessage: 'Ошибка при запросе свечей из базы' });
  }
});



