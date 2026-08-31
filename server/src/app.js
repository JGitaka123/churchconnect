import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { authenticate } from './auth.js';
import authRoutes from './routes/auth.js';
import v1Routes, { v1AuthRouter } from './routes/v1.js';
import memberRoutes from './routes/members.js';
import transactionRoutes from './routes/transactions.js';
import attendanceRoutes from './routes/attendance.js';
import dashboardRoutes from './routes/dashboard.js';
import groupRoutes from './routes/groups.js';
import followupRoutes from './routes/followups.js';
import announcementRoutes from './routes/announcements.js';
import prayerRoutes from './routes/prayer.js';
import eventRoutes from './routes/events.js';
import campaignRoutes from './routes/campaigns.js';
import recurringGiftRoutes from './routes/recurringGifts.js';
import careInboxRoutes from './routes/careInbox.js';

// API-only Express app. Used by both the local dev server (index.js) and the
// Cloudflare Pages Functions entry (functions/api/[[path]].js), which mounts
// it under /api/*. Static SPA serving and listen() live in index.js so the
// deployed frontend stays on Pages' static asset pipeline.
export const app = express();
app.set('trust proxy', 1); // behind nginx / Cloudflare
app.use(helmet({ contentSecurityPolicy: config.env !== 'development' }));
app.use(express.json({ limit: '256kb' }));
app.use(
  cors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: false,
  })
);

// Basic rate limiting; stricter on auth.
//
// Limiters are created lazily on the first request instead of at module load:
// express-rate-limit's default MemoryStore starts a setInterval in its
// constructor, and Cloudflare Workers forbid timers at module (global) scope.
function lazyRateLimit(options) {
  let limiter;
  return (req, res, next) => {
    limiter = limiter || rateLimit(options);
    limiter(req, res, next);
  };
}

app.use('/api/', lazyRateLimit({ windowMs: 60_000, max: 300 }));
const authLimiter = lazyRateLimit({ windowMs: 15 * 60_000, max: 30 });
// Credential-stuffing throttle: per-IP cap on password attempts, layered on top
// of the per-account lockout enforced in the login handler itself.
const loginLimiter = lazyRateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// Health check (used by Docker/uptime probes).
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

// ---------------------------------------------------------------- youtube
// Public YouTube proxy for the member app's Sermons tab. Resolves a channel
// handle/URL to a channel id, then returns recent uploads from the channel's
// public RSS feed (no API key required). Cached briefly to stay polite.
const ytCache = new Map();
const YT_CACHE_TTL = 10 * 60 * 1000;
const YT_FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'en'
};

function ytCacheGet(key) {
  const hit = ytCache.get(key);
  if (hit && Date.now() - hit.at < YT_CACHE_TTL) return hit.value;
  return null;
}
function ytCacheSet(key, value) {
  ytCache.set(key, { at: Date.now(), value });
  if (ytCache.size > 60) ytCache.delete(ytCache.keys().next().value);
}

async function ytText(url) {
  const res = await fetch(url, { headers: YT_FETCH_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error('YouTube returned ' + res.status);
  return res.text();
}

function channelIdFromInput(raw) {
  const m =
    /[?&]channel_id=([A-Za-z0-9_-]{20,})/.exec(raw) ||
    /\/channel\/(UC[A-Za-z0-9_-]{20,})/.exec(raw) ||
    /^\s*(UC[A-Za-z0-9_-]{20,})\s*$/.exec(raw);
  return m ? m[1] : null;
}

async function resolveYoutubeChannel(raw) {
  const direct = channelIdFromInput(raw);
  if (direct) return { channelId: direct, url: 'https://www.youtube.com/channel/' + direct };
  const url = /youtube\.com|youtu\.be/.test(raw)
    ? raw
    : (raw.startsWith('@') ? 'https://www.youtube.com/' + raw : raw);
  const html = await ytText(url);
  const m =
    /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/.exec(html) ||
    /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/.exec(html) ||
    /"browseId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/.exec(html);
  if (!m) throw new Error('Could not resolve the channel id');
  return { channelId: m[1], url: 'https://www.youtube.com/channel/' + m[1] };
}

function decodeYtXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
}

function parseYtRss(xml) {
  const videos = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e);
    if (!videoId) continue;
    const title = /<title>([^<]*)<\/title>/.exec(e);
    const published = /<published>([^<]+)<\/published>/.exec(e);
    const name = /<name>([^<]*)<\/name>/.exec(e);
    videos.push({
      videoId: videoId[1],
      title: decodeYtXml(title ? title[1] : ''),
      published: published ? published[1] : '',
      channelName: decodeYtXml(name ? name[1] : ''),
      url: 'https://www.youtube.com/watch?v=' + videoId[1]
    });
  }
  return videos;
}

async function youtubeChannelVideos(channelId) {
  const key = 'videos:' + channelId;
  const cached = ytCacheGet(key);
  if (cached) return cached;
  const xml = await ytText(
    'https://www.youtube.com/feeds/videos.xml?channel_id=' +
    encodeURIComponent(channelId) + '&max-results=50'
  );
  const videos = parseYtRss(xml);
  ytCacheSet(key, videos);
  return videos;
}

// Public: powers the member app's YouTube-style Sermons feed.
app.get('/api/youtube/feed', async (req, res) => {
  try {
    const raw = String(req.query.channel || '').trim();
    if (!raw) return res.status(400).json({ error: 'Missing "channel" query parameter' });
    const resolved = await resolveYoutubeChannel(raw);
    const videos = await youtubeChannelVideos(resolved.channelId);
    if (!videos.length) return res.status(404).json({ error: 'No videos found for this channel' });
    res.json({ channel: { id: resolved.channelId, url: resolved.url }, videos, count: videos.length });
  } catch (e) {
    console.error('[youtube/feed]', e && e.message ? e.message : e);
    res.status(502).json({ error: 'Could not load the YouTube feed. Check the channel link and your internet connection.', detail: (e && e.message) ? String(e.message) : String(e) });
  }
});

// Public auth endpoints
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/v1/auth', authLimiter, v1AuthRouter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/v1/auth/login', loginLimiter);

// Everything below requires a valid token
app.use('/api', authenticate);
app.use('/api/v1', authenticate, v1Routes);
app.use('/api/members', memberRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/prayer-requests', prayerRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/recurring-gifts', recurringGiftRoutes);
app.use('/api/care-inbox', careInboxRoutes);

// 404 + error handlers
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

export const errorHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.publicMessage || 'Internal server error' });
};
app.use(errorHandler);

export default app;
