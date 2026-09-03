// Church 2.0 - external message delivery (group announcements + broadcasts).
//
// Channels and providers:
//   - Email:    Resend / Brevo / SendGrid (EMAIL_PROVIDER + EMAIL_API_KEY +
//               EMAIL_FROM) - see email.js for the exact env vars. Powers MFA
//               codes, password resets and announcements.
//   - SMS:      Africa's Talking (SMS_USERNAME + SMS_API_KEY, optional
//               SMS_FROM) or a generic JSON gateway (SMS_API_URL + optional
//               SMS_API_KEY). Requires live SMS credit to deliver.
//   - WhatsApp: Meta WhatsApp Cloud API (WHATSAPP_META_TOKEN +
//               WHATSAPP_META_PHONE_ID) OR a custom JSON gateway
//               (WHATSAPP_API_URL + optional WHATSAPP_API_KEY), e.g. 360dialog.
//               When WhatsApp is not configured but SMS is, the WhatsApp
//               channel falls back to SMS so members with phones are reached.
//
// Unconfigured channels log to the console in development (flows stay testable
// locally) and fail closed in production with a clear error.
// MFA_DEV_DEBUG=1 (development only) forces the console-log path even when a
// provider is configured - it is the "simulate delivery" switch used in demos.
//
// Bulk sends ("mail merge" to many members) run with bounded concurrency so a
// few hundred recipients do not take forever, and one bad address does not
// stop the rest - failures are counted and reported instead.

import { sendEmail } from './email.js';

const isProd = () => process.env.NODE_ENV === 'production';
const appName = () => process.env.EMAIL_FROM_NAME || 'Church Connect';

const debugOverride = () => process.env.NODE_ENV !== 'production' && process.env.MFA_DEV_DEBUG === '1';
const emailConfigured = () => !debugOverride() && Boolean(process.env.EMAIL_API_KEY || process.env.EMAIL_API_URL);
const smsConfigured = () => Boolean(process.env.SMS_API_URL) || Boolean(process.env.SMS_USERNAME && process.env.SMS_API_KEY);
const whatsappMetaConfigured = () => Boolean(process.env.WHATSAPP_META_TOKEN && process.env.WHATSAPP_META_PHONE_ID);
const whatsappGatewayConfigured = () => Boolean(process.env.WHATSAPP_API_URL);

// Live connection report - shown to admins in the Broadcast panel so they can
// see at a glance which channels will actually deliver.
export function channelStatus() {
  const whatsapp = whatsappMetaConfigured() ? 'meta' : (whatsappGatewayConfigured() ? 'gateway' : false);
  const from = process.env.EMAIL_FROM || `${appName()} <no-reply@yourchurch.org>`;
  return {
    env: isProd() ? 'production' : 'development',
    provider: String(process.env.EMAIL_PROVIDER || 'resend').toLowerCase(),
    email: emailConfigured(),
    emailFrom: from,
    emailTestSender: /@resend\.dev\s*>/.test(from),
    sms: smsConfigured(),
    whatsapp,
    simulating: debugOverride(), // true => channels print to the server log
  };
}

// Whether EMAIL_FROM is Resend's temporary onboarding@resend.dev sender, which
// only delivers to the account owner - real member mail needs a verified domain.
export function emailSenderStatus() {
  const from = process.env.EMAIL_FROM || `${appName()} <no-reply@yourchurch.org>`;
  return {
    configured: emailConfigured(),
    from,
    usingTestSender: /@resend\.dev\s*>/.test(from),
  };
}

// Send a confirmation email to an address (used by the admin "test email"
// button so a misconfigured provider surfaces its real error immediately).
export async function sendTestEmail(to) {
  if (!emailConfigured()) {
    throw new Error('Email delivery is not configured - set EMAIL_API_KEY (and clear MFA_DEV_DEBUG) in server/.env.');
  }
  await deliverEmail(
    { email: to },
    {
      title: 'Test email from ' + appName(),
      body: 'If you can read this, email delivery is working correctly.',
      channels: [],
    },
    null
  );
}

// Turn provider errors into advice the admin can act on. Resend's most common
// failure is "test mode": onboarding@resend.dev only delivers to the account
// owner until a domain is verified.
export function readableProviderError(e) {
  const msg = (e && e.message) || String(e);
  if (/testing emails to your own email address/.test(msg)) {
    return "Resend is still in test mode. Verify a domain at https://resend.com/domains (add the DNS records it gives you), then set EMAIL_FROM to an address on that domain, e.g. 'Church Connect <no-reply@maximummiracle.org>'. Until a domain is verified, Resend only delivers to the account owner's own email.";
  }
  return msg;
}

// Production fail-closed preflight. Throws a helpful error naming the missing
// variables before any announcement is stored or any member is contacted.
export function assertDeliveryReady(channels) {
  if (!isProd()) return;
  const missing = [];
  if (channels.includes('email') && !emailConfigured()) missing.push('Email (EMAIL_API_KEY + verified EMAIL_FROM)');
  if (channels.includes('sms') && !smsConfigured()) missing.push('SMS (SMS_USERNAME + SMS_API_KEY or SMS_API_URL)');
  if (channels.includes('whatsapp') && !whatsappMetaConfigured() && !whatsappGatewayConfigured() && !smsConfigured()) {
    missing.push('WhatsApp (WHATSAPP_META_TOKEN + WHATSAPP_META_PHONE_ID, WHATSAPP_API_URL, or SMS fallback)');
  }
  if (missing.length) {
    throw new Error('Delivery is not configured for: ' + missing.join(', ') + '. Add them to server/.env and restart.');
  }
}

// POST JSON with a timeout and strict status checking so a misconfigured
// provider fails loudly instead of silently dropping messages.
async function httpJson(url, { headers = {}, body, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, signal: controller.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`provider responded ${res.status}: ${text.slice(0, 200) || 'no body'}`);
    return { status: res.status, text };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`provider timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Digits-only Kenyan number (2547... when we can tell) - WhatsApp/Meta want no
// "+" and Africa's Talking is happy either way.
function kePhone(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  else if (/^[17]\d{8}$/.test(p)) p = '254' + p;
  return p || null;
}

// Plain-text body shared by every channel.
function plainMessage(announcement, groupName) {
  const lead = groupName ? `${groupName}: ` : '';
  const via = Array.isArray(announcement.channels) && announcement.channels.length
    ? `\nDelivered via ${announcement.channels.join(' & ')}.`
    : '';
  return `${lead}${announcement.title}\n\n${announcement.body}${via}`;
}

// ---- Email (Resend/Brevo/SendGrid via email.js) ---------------------------
async function deliverEmail(member, announcement, groupName) {
  const name = appName();
  const subject = `${groupName ? groupName + ': ' : ''}${announcement.title}`;
  const text = plainMessage(announcement, groupName);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    <p style="font-size:13px;color:#6b7280;margin:0 0 4px;">${groupName ? escHtml(groupName) + ' announcement' : 'Announcement'}</p>
    <h2 style="margin:0 0 10px;color:#1f2937;">${escHtml(announcement.title)}</h2>
    <p style="color:#374151;white-space:pre-wrap;line-height:1.5;">${escHtml(announcement.body)}</p>
    <p style="font-size:12px;color:#9ca3af;margin-top:16px;">${escHtml(name)}</p>
  </div>`;
  await sendEmail({ to: member.email, subject, text, html });
}

// ---- SMS (Africa's Talking or a generic JSON gateway) ---------------------
async function deliverSms(member, message) {
  const to = kePhone(member.phone);
  if (process.env.SMS_API_URL) {
    const headers = {};
    if (process.env.SMS_API_KEY) headers.Authorization = `Bearer ${process.env.SMS_API_KEY}`;
    await httpJson(process.env.SMS_API_URL, {
      headers,
      body: JSON.stringify({ from: process.env.SMS_FROM || 'ChurchConnect', to, message }),
    });
    return;
  }
  const username = process.env.SMS_USERNAME;
  const key = process.env.SMS_API_KEY;
  if (!username || !key) throw new Error('SMS delivery is not configured (set SMS_USERNAME + SMS_API_KEY or SMS_API_URL in server/.env)');
  const url = `https://api.africastalking.com/version1/messaging?username=${encodeURIComponent(username)}`;
  const params = new URLSearchParams({ to, message });
  if (process.env.SMS_FROM) params.set('from', process.env.SMS_FROM);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', apiKey: key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`Africa's Talking responded ${res.status}: ${text.slice(0, 200) || 'no body'}`);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('SMS provider timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- WhatsApp (Meta Cloud API, then custom JSON gateway) ------------------
// Returns 'whatsapp' on a real send, or null when no gateway is configured so
// the caller can decide on the SMS fallback.
async function deliverWhatsApp(member, message) {
  const to = kePhone(member.phone);
  if (whatsappMetaConfigured()) {
    const phoneNumberId = String(process.env.WHATSAPP_META_PHONE_ID).trim();
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
    await httpJson(url, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_META_TOKEN}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: message },
      }),
    });
    return 'whatsapp';
  }
  if (whatsappGatewayConfigured()) {
    const headers = {};
    if (process.env.WHATSAPP_API_KEY) headers.Authorization = `Bearer ${process.env.WHATSAPP_API_KEY}`;
    await httpJson(process.env.WHATSAPP_API_URL, {
      headers,
      body: JSON.stringify({ to, message, from: process.env.WHATSAPP_FROM }),
    });
    return 'whatsapp';
  }
  return null;
}

// One member, one requested channel. Returns the channel actually used
// ('whatsapp' | 'sms' | 'email' | 'dev' | 'skipped') and never throws for a
// missing provider in development. In production an unconfigured provider is
// a hard error (the routes preflight this with assertDeliveryReady too).
async function deliverOne(member, channel, announcement, groupName, stats) {
  const message = plainMessage(announcement, groupName);
  if (channel === 'email') {
    if (!member.email) return 'skipped';
    if (!emailConfigured()) {
      if (isProd()) throw new Error('Email delivery is not configured (set EMAIL_API_KEY in the host environment)');
      console.log(`[announce-dev] Email to ${member.first_name || ''} ${member.last_name || ''} <${member.email}>: ${announcement.title}`);
      stats.dev = true;
      return 'email-dev';
    }
    await deliverEmail(member, announcement, groupName);
    return 'email';
  }
  if (channel === 'whatsapp') {
    if (!member.phone) return 'skipped';
    const via = await deliverWhatsApp(member, message);
    if (via) return via;
    // WhatsApp not configured -> SMS fallback keeps members reachable.
    if (smsConfigured()) {
      await deliverSms(member, message);
      return 'sms';
    }
    if (isProd()) throw new Error('WhatsApp delivery is not configured (set WHATSAPP_META_TOKEN + WHATSAPP_META_PHONE_ID or WHATSAPP_API_URL, or SMS)');
    console.log(`[announce-dev] WhatsApp to ${member.first_name || ''} ${member.last_name || ''} <${member.phone}>: ${message.slice(0, 160)}${message.length > 160 ? '...' : ''}`);
    stats.dev = true;
    return 'whatsapp-dev';
  }
  if (channel === 'sms') {
    if (!member.phone) return 'skipped';
    if (!smsConfigured()) {
      if (isProd()) throw new Error('SMS delivery is not configured (set SMS_USERNAME + SMS_API_KEY or SMS_API_URL)');
      console.log(`[announce-dev] SMS to ${member.first_name || ''} ${member.last_name || ''} <${member.phone}>: ${message.slice(0, 160)}${message.length > 160 ? '...' : ''}`);
      stats.dev = true;
      return 'sms-dev';
    }
    await deliverSms(member, message);
    return 'sms';
  }
  return 'skipped';
}

// Run async jobs with bounded concurrency so a big member list does not run
// one-by-one (slow) or all-at-once (rate limits / connection floods).
async function runLimited(jobs, limit, fn) {
  const workerCount = Math.max(1, Math.min(limit, jobs.length));
  let cursor = 0;
  const errors = [];
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        await fn(job);
      } catch (e) {
        errors.push((e && e.message) || String(e));
      }
    }
  }));
  return errors;
}

function countUsed(stats, channelCounts, used) {
  if (used === 'whatsapp' || used === 'whatsapp-dev') channelCounts.whatsapp += 1;
  else if (used === 'sms' || used === 'sms-dev') channelCounts.sms += 1;
  else if (used === 'email' || used === 'email-dev') channelCounts.email += 1;
}

// Deliver one announcement to every group member over the requested channels.
// Returns { channelCounts, delivered, skipped, errors, dev }.
export async function sendGroupAnnouncement({ group, members, announcement }) {
  const channels = Array.isArray(announcement.channels) && announcement.channels.length
    ? announcement.channels
    : ['email'];
  const picked = channels.filter((ch) => ch === 'email' || ch === 'sms' || ch === 'whatsapp');
  assertDeliveryReady(picked);
  const channelCounts = { email: 0, whatsapp: 0, sms: 0 };
  const stats = { dev: false };
  // One job per member per channel actually used. When WhatsApp is not live it
  // falls back to SMS, so asking for both never sends a member two texts.
  const jobs = [];
  for (const member of members) {
    if (picked.includes('email') && member.email) jobs.push({ member, channel: 'email' });
    if (!member.phone) continue;
    const wantsWhatsApp = picked.includes('whatsapp');
    const wantsSms = picked.includes('sms');
    if (wantsWhatsApp) {
      jobs.push({ member, channel: 'whatsapp' });
      if (wantsSms && (whatsappMetaConfigured() || whatsappGatewayConfigured())) {
        jobs.push({ member, channel: 'sms' });
      }
    } else if (wantsSms) {
      jobs.push({ member, channel: 'sms' });
    }
  }
  let skipped = 0;
  let delivered = 0;
  const errors = await runLimited(jobs, 8, async ({ member, channel }) => {
    const used = await deliverOne(member, channel, announcement, group ? group.name : null, stats);
    if (used === 'skipped') { skipped += 1; return; }
    delivered += 1;
    countUsed(stats, channelCounts, used);
  });
  return { channelCounts, delivered, skipped, errors, dev: stats.dev };
}

// Broadcast to a whole audience (all members / one branch). 'push' is handled
// by the in-app feed, so it is skipped here. Returns counts the route can
// report back to the admin.
export async function sendBroadcastToMembers({ members, announcement }) {
  const channels = (Array.isArray(announcement.channels) ? announcement.channels : [])
    .filter((ch) => ch === 'email' || ch === 'sms' || ch === 'whatsapp');
  assertDeliveryReady(channels);
  const channelCounts = { email: 0, whatsapp: 0, sms: 0 };
  const stats = { dev: false };
  const jobs = [];
  for (const member of members) {
    if (channels.includes('email') && member.email) jobs.push({ member, channel: 'email' });
    if (!member.phone) continue;
    const wantsWhatsApp = channels.includes('whatsapp');
    const wantsSms = channels.includes('sms');
    if (wantsWhatsApp) {
      jobs.push({ member, channel: 'whatsapp' });
      // When WhatsApp is not live, deliverOne falls back to SMS, so one job
      // covers both requests and a member never gets two texts.
      if (wantsSms && (whatsappMetaConfigured() || whatsappGatewayConfigured())) {
        jobs.push({ member, channel: 'sms' });
      }
    } else if (wantsSms) {
      jobs.push({ member, channel: 'sms' });
    }
  }
  let delivered = 0;
  let skipped = 0;
  const errors = await runLimited(jobs, 8, async ({ member, channel }) => {
    const used = await deliverOne(member, channel, announcement, null, stats);
    if (used === 'skipped') { skipped += 1; return; }
    delivered += 1;
    countUsed(stats, channelCounts, used);
  });
  return { channelCounts, delivered, skipped, errors, dev: stats.dev };
}
