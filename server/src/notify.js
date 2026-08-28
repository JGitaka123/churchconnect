// Church 2.0 - group announcement delivery (email / WhatsApp).
//
// Reuses the same provider style as MFA (server/src/mfa.js):
//   - Email:    Resend (https://resend.com) - EMAIL_API_KEY, optional
//               EMAIL_API_URL override for any Resend-style JSON gateway,
//               EMAIL_FROM / EMAIL_FROM_NAME for sender details.
//   - WhatsApp: WHATSAPP_API_URL (custom JSON gateway, e.g. 360dialog or
//               Meta Cloud API webhook) with optional WHATSAPP_API_KEY.
//               Falls back to Africa's Talking SMS (SMS_USERNAME/SMS_API_KEY)
//               so members with phones still get the message.
// If a channel is not configured, non-production logs every delivery to the
// console (so the flow stays testable locally); production fails closed.

const isProd = () => process.env.NODE_ENV === 'production';
const appName = () => process.env.EMAIL_FROM_NAME || 'Church Connect';

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

// MFA_DEV_DEBUG=1 (dev only) forces the console-log path even when a
// provider is configured - same switch the MFA module honours.
const debugOverride = () => process.env.NODE_ENV !== 'production' && process.env.MFA_DEV_DEBUG === '1';
const emailConfigured = () => !debugOverride() && Boolean(process.env.EMAIL_API_KEY || process.env.EMAIL_API_URL);
const whatsappConfigured = () => Boolean(process.env.WHATSAPP_API_URL);
const smsConfigured = () => Boolean(process.env.SMS_API_URL) || Boolean(process.env.SMS_USERNAME && process.env.SMS_API_KEY);

// Build the message body shared by every channel.
function composeMessage(group, announcement) {
  const channel = announcement.channels && announcement.channels.length
    ? `\nDelivered via ${announcement.channels.join(' & ')}.`
    : '';
  return `${group.name}: ${announcement.title}\n\n${announcement.body}${channel}`;
}

async function deliverEmail(member, group, announcement) {
  const url = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
  const key = process.env.EMAIL_API_KEY;
  if (!key && !process.env.EMAIL_API_URL) throw new Error('EMAIL_API_KEY is not set - get a key at https://resend.com and add it to .env');
  const name = appName();
  const from = process.env.EMAIL_FROM || `${name} <no-reply@yourchurch.org>`;
  const subject = `${group.name}: ${announcement.title}`;
  const text = composeMessage(group, announcement);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    <p style="font-size:13px;color:#6b7280;margin:0 0 4px;">${escHtml(group.name)} announcement</p>
    <h2 style="margin:0 0 10px;color:#1f2937;">${escHtml(announcement.title)}</h2>
    <p style="color:#374151;white-space:pre-wrap;line-height:1.5;">${escHtml(announcement.body)}</p>
    <p style="font-size:12px;color:#9ca3af;margin-top:16px;">${escHtml(name)}</p>
  </div>`;
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  await httpJson(url, { headers, body: JSON.stringify({ from, to: [member.email], subject, text, html }) });
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// WhatsApp through a custom JSON gateway. If no WhatsApp gateway is configured
// but Africa's Talking SMS is, we fall back to SMS so the member is still
// reached. Unconfigured + dev => console log (visible in the server output).
async function deliverWhatsApp(member, group, announcement) {
  const message = composeMessage(group, announcement);
  if (process.env.WHATSAPP_API_URL) {
    const headers = {};
    if (process.env.WHATSAPP_API_KEY) headers.Authorization = `Bearer ${process.env.WHATSAPP_API_KEY}`;
    await httpJson(process.env.WHATSAPP_API_URL, { headers, body: JSON.stringify({ to: member.phone, message, from: process.env.WHATSAPP_FROM }) });
    return 'whatsapp';
  }
  if (smsConfigured()) {
    const url = process.env.SMS_API_URL || 'https://api.africastalking.com/version1/messaging';
    if (process.env.SMS_API_URL) {
      await httpJson(url, { body: JSON.stringify({ to: member.phone, message }) });
    } else {
      await httpJson(url + '?username=' + encodeURIComponent(process.env.SMS_USERNAME), {
        headers: { apiKey: process.env.SMS_API_KEY, Accept: 'application/json' },
        body: JSON.stringify({ username: process.env.SMS_USERNAME, to: member.phone, message, from: process.env.SMS_FROM || 'ChurchConnect' }),
      });
    }
    return 'sms';
  }
  if (isProd()) throw new Error('WhatsApp delivery is not configured (set WHATSAPP_API_URL or SMS_API_KEY)');
  console.log(`[announce-dev] WhatsApp to ${member.first_name} ${member.last_name} <${member.phone}>: ${message.slice(0, 160)}${message.length > 160 ? '...' : ''}`);
  return 'whatsapp-dev';
}

// Deliver one announcement to every current group member over the requested
// channels. Members without the needed contact detail are counted as skipped.
// Returns { channelCounts, delivered, skipped }.
export async function sendGroupAnnouncement({ group, members, announcement }) {
  const channels = Array.isArray(announcement.channels) && announcement.channels.length
    ? announcement.channels
    : ['email'];
  const channelCounts = { email: 0, whatsapp: 0, sms: 0 };
  let delivered = 0;
  let skipped = 0;

  for (const m of members) {
    for (const ch of channels) {
      if (ch === 'email') {
        if (!m.email) { skipped += 1; continue; }
        if (!emailConfigured() && isProd()) throw new Error('Email delivery is not configured (set EMAIL_API_KEY)');
        if (!emailConfigured()) {
          console.log(`[announce-dev] Email to ${m.first_name} ${m.last_name} <${m.email}>: "${announcement.title}"`);
          channelCounts.email += 1; delivered += 1;
          continue;
        }
        await deliverEmail(m, group, announcement);
        channelCounts.email += 1; delivered += 1;
      } else if (ch === 'whatsapp') {
        if (!m.phone) { skipped += 1; continue; }
        const via = await deliverWhatsApp(m, group, announcement);
        if (via === 'whatsapp' || via === 'whatsapp-dev') channelCounts.whatsapp += 1;
        else channelCounts.sms += 1;
        delivered += 1;
      } else {
        skipped += 1; // unknown channel - count as skipped so we never hang
      }
    }
  }
  return { channelCounts, delivered, skipped };
}
