/**
 * News ingestion: RSS polling (CoinDesk, CoinTelegraph) and optional CryptoPanic API.
 * Filters by tickers (NEWS_FILTER_CURRENCIES), dedupes, and stores in FeedItem.
 */

import Parser from "rss-parser";
import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";

const RSS_FEEDS: { url: string; source: string }[] = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "RSS_COINDESK" },
  { url: "https://cointelegraph.com/rss", source: "RSS_COINTELEGRAPH" },
];

export interface NormalizedFeedItem {
  source: string;
  externalId: string;
  title: string;
  body: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  metadata: { currencies?: string[] } | null;
}

const parser = new Parser({
  timeout: 10_000,
  headers: { "User-Agent": "Sub0-NewsIngest/1.0" },
});

function matchesFilter(title: string, body: string | null, filterTickers: string[]): boolean {
  if (filterTickers.length === 0) return true;
  const text = `${title} ${body ?? ""}`.toUpperCase();
  return filterTickers.some((t) => text.includes(t));
}

/**
 * Fetch and parse RSS feeds; return normalized items that pass the ticker filter.
 */
export async function fetchRssFeeds(): Promise<NormalizedFeedItem[]> {
  const filterTickers = config.newsFilterCurrencies;
  const items: NormalizedFeedItem[] = [];

  for (const { url, source } of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      const entries = feed.items ?? [];
      for (const entry of entries) {
        const title = entry.title?.trim() ?? "";
        const body = entry.contentSnippet ?? entry.content ?? null;
        if (!title) continue;
        if (!matchesFilter(title, body, filterTickers)) continue;
        const link = entry.link?.trim() ?? entry.guid ?? "";
        const externalId = link || `${source}-${entry.pubDate ?? Date.now()}-${title.slice(0, 80)}`;
        const publishedAt = entry.pubDate ? new Date(entry.pubDate) : new Date();
        if (Number.isNaN(publishedAt.getTime())) continue;
        items.push({
          source,
          externalId,
          title,
          body: body ? body.slice(0, 10_000) : null,
          sourceUrl: link || null,
          imageUrl: entry.enclosure?.url ?? null,
          publishedAt,
          metadata: null,
        });
      }
    } catch (err) {
      console.error(`RSS fetch ${source} failed:`, err instanceof Error ? err.message : String(err));
    }
  }
  return items;
}

const CRYPTOPANIC_BASE = "https://cryptopanic.com/api/v1/posts/";

/**
 * Fetch from CryptoPanic (requires CRYPTOPANIC_API_KEY). Filter by currencies in config.
 */
export async function fetchCryptoPanic(): Promise<NormalizedFeedItem[]> {
  const apiKey = config.cryptopanicApiKey;
  if (!apiKey) return [];

  const filterTickers = config.newsFilterCurrencies;
  const currencies = filterTickers.length > 0 ? filterTickers.join(",") : "BTC,ETH";
  const url = `${CRYPTOPANIC_BASE}?auth_token=${encodeURIComponent(apiKey)}&currencies=${encodeURIComponent(currencies)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{
      id?: number;
      title?: string;
      url?: string;
      created_at?: string;
      kind?: string;
      currencies?: Array<{ code?: string }>;
      metadata?: { description?: string };
    }> };
    const results = data.results ?? [];
    const items: NormalizedFeedItem[] = [];
    for (const r of results) {
      const title = r.title?.trim() ?? "";
      if (!title) continue;
      const externalId = `CP-${r.id ?? r.url ?? title.slice(0, 80)}`;
      const publishedAt = r.created_at ? new Date(r.created_at) : new Date();
      if (Number.isNaN(publishedAt.getTime())) continue;
      const currenciesList: string[] = r.currencies?.map((c) => c.code?.toUpperCase()).filter((x): x is string => typeof x === "string") ?? [];
      items.push({
        source: "CRYPTOPANIC",
        externalId,
        title,
        body: r.metadata?.description?.slice(0, 10_000) ?? null,
        sourceUrl: r.url ?? null,
        imageUrl: null,
        publishedAt,
        metadata: currenciesList.length > 0 ? { currencies: currenciesList } : null,
      });
    }
    return items;
  } catch (err) {
    console.error("CryptoPanic fetch failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Upsert normalized items into FeedItem (by source + externalId). Skips duplicates.
 */
export async function saveFeedItems(items: NormalizedFeedItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const prisma = getPrismaClient();
  let saved = 0;
  for (const it of items) {
    try {
      await prisma.feedItem.upsert({
        where: {
          source_externalId: { source: it.source, externalId: it.externalId },
        },
        create: {
          source: it.source,
          externalId: it.externalId,
          title: it.title,
          body: it.body,
          sourceUrl: it.sourceUrl,
          imageUrl: it.imageUrl,
          publishedAt: it.publishedAt,
          metadata: it.metadata ?? undefined,
        },
        update: {},
      });
      saved++;
    } catch {
      // duplicate or constraint; skip
    }
  }
  return saved;
}

/**
 * Run one ingest cycle: fetch RSS + CryptoPanic, filter, save. Returns count saved.
 */
export async function runIngestCycle(): Promise<number> {
  const [rssItems, cpItems] = await Promise.all([fetchRssFeeds(), fetchCryptoPanic()]);
  const all = [...rssItems, ...cpItems];
  return saveFeedItems(all);
}
