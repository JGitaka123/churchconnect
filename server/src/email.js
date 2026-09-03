// Email delivery - one sender, three provider adapters.
//
// Resend (default) needs a VERIFIED DOMAIN before it will email anyone except
// the account owner (its onboarding@resend.dev sender is test-only). If you do
// not have (or cannot verify) a domain yet, Brevo or SendGrid can be used
// instead - both let you verify a single sender EMAIL ADDRESS with a link
// (no DNS records needed) and are free for small volumes:
//
//   EMAIL_PROVIDER=brevo       # https://brevo.com (free: 300 emails/day)
//   EMAIL_API_KEY=xkeysib-...  # Brevo -> SMTP & API -> API keys
//   EMAIL_FROM=Church Connect <you@gmail.com>
//   # ^ any address whose inbox you can open - Brevo emails you a
//   #   "verify sender" link; click it once and sending is live.
//
//   EMAIL_PROVIDER=sendgrid    # https://sendgrid.com (free: 100 emails/day)
//   EMAIL_API_KEY=SG.xxxx      # SendGrid -> Settings -> API Keys
//   EMAIL_FROM=Church Connect <you@gmail.com>
//   # SendGrid emails a "verify sender" link to that address too.
//
// Everything is read from the environment (server/.env locally, the host's
// env vars in production) - never from committed code.

export function emailProvider() {
  const p = String(process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
  return p === 'sendgrid' || p === 'brevo' ? p : 'resend';
}

export function emailConfigured() {
  return Boolean(process.env.EMAIL_API_KEY || process.env.EMAIL_API_URL);
}

export function emailSenderStatus() {
  const from = process.env.EMAIL_FROM || 'Church Connect <no-reply@yourchurch.org>';
  return {
    provider: emailProvider(),
    from,
    usingTestSender: /@resend\.dev\s*>/.test(from),
  };
}

function splitSender(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from || '');
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: '', email: String(from || '').trim() };
}

async function postJson(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      let message = `provider responded ${res.status}: ${(text || '').slice(0, 300)}`;
      try {
        const j = JSON.parse(text);
        if (j && j.message) message = j.message;
        else if (j && j.errors) message = (Array.isArray(j.errors) ? j.errors.map((e) => e.message || JSON.stringify(e)).join('; ') : JSON.stringify(j.errors));
      } catch { /* keep raw text */ }
      throw new Error(message);
    }
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Email provider timed out after 15000ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Send one email. `text` and `html` are the plain and HTML bodies.
export async function sendEmail({ to, subject, text, html }) {
  const key = process.env.EMAIL_API_KEY;
  if (!key && !process.env.EMAIL_API_URL) {
    throw new Error('EMAIL_API_KEY is not set - add it to server/.env (or your host environment variables).');
  }
  const provider = emailProvider();
  const fromRaw = process.env.EMAIL_FROM || 'Church Connect <no-reply@yourchurch.org>';
  const sender = splitSender(fromRaw);

  if (process.env.EMAIL_API_URL) {
    // Custom Resend-style JSON gateway override.
    await postJson(process.env.EMAIL_API_URL, key ? { Authorization: `Bearer ${key}` } : {}, { from: fromRaw, to: [to], subject, text, html });
    return;
  }
  if (provider === 'brevo') {
    // Brevo authenticates with an "api-key" header (not Bearer).
    await postJson('https://api.brevo.com/v3/smtp/email', key ? { 'api-key': key } : {}, {
      sender: { name: sender.name || 'Church Connect', email: sender.email },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    });
    return;
  }
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  if (provider === 'sendgrid') {
    await postJson('https://api.sendgrid.com/v3/mail/send', headers, {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: sender.email, name: sender.name || undefined },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    });
    return;
  }
  // Resend (default).
  await postJson('https://api.resend.com/emails', headers, { from: fromRaw, to: [to], subject, text, html });
}
