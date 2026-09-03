// M-Pesa STK Push (Safaricom Daraja) - start a Lipa Na M-Pesa prompt on a
// phone and reconcile Safaricom's callback into the giving ledger.
//
//   POST /api/mpesa/callback                          (public - Safaricom calls it)
//   POST /api/mpesa/stkpush                           (authenticated)
//   GET  /api/mpesa/payments/:checkoutRequestId       (authenticated, polling)
//
// Each prompt is persisted as an intent row in mpesa_payments (created lazily
// and idempotently, so a restart between the push and the callback never loses
// a payment). The transaction is recorded ONLY when the callback reports
// ResultCode 0 - a failed/cancelled prompt records nothing.

import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireRole, resolveChurch, resolveScope } from '../auth.js';
import { defaultBranchForChurch, genId, resolveBranch, wrap } from './util.js';
import { mpesaConfigured, mpesaEnv, normalizePhone, stkPush } from '../mpesa.js';

const router = Router();

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = query(`
      CREATE TABLE IF NOT EXISTS mpesa_payments (
        id                   TEXT PRIMARY KEY,
        checkout_request_id  TEXT,
        merchant_request_id  TEXT,
        phone                TEXT,
        amount               NUMERIC(12,2) NOT NULL,
        account_ref          TEXT,
        member_id            TEXT,
        member_name          TEXT,
        branch_id            TEXT NOT NULL,
        church_id            TEXT NOT NULL,
        category             TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'pending',
        result_code          INTEGER,
        result_desc          TEXT,
        mpesa_receipt        TEXT,
        transaction_id       TEXT,
        raw                  JSONB,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_mpesa_checkout ON mpesa_payments(checkout_request_id);
      CREATE INDEX IF NOT EXISTS idx_mpesa_status ON mpesa_payments(status);
    `).then(() => true).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

// Start an STK prompt. Requires a signed-in user; the phone can be supplied by
// the client or taken from the caller's profile. The gift itself is only
// recorded when Safaricom confirms it in the callback below.
router.post('/stkpush', authenticate, requireRole('hq_admin', 'branch_admin', 'ministry_leader', 'member'), wrap(async (req, res) => {
  await ensureTable();
  const church = resolveChurch(req);
  const scope = resolveScope(req);
  const { memberId, memberName, phone, amount, category = 'Offering', accountRef, branchId, description } = req.body || {};

  if (!mpesaConfigured()) {
    return res.status(503).json({
      error: 'M-Pesa is not configured on this server yet. Add the MPESA_* variables to server/.env (see server/.env.example).',
      code: 'MPESA_NOT_CONFIGURED',
    });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'A valid amount greater than 0 is required' });
  }

  const payerPhone = normalizePhone(phone || (req.user && req.user.phone));
  if (!payerPhone) {
    return res.status(400).json({
      error: 'A valid Kenyan phone number (e.g. 0712 345 678 or 254712345678) is required for M-Pesa',
    });
  }

  // The member record supplies the branch/church scope and the receipt name.
  let member = null;
  if (memberId && memberId !== 'anonymous') {
    const { rows } = await query(
      'SELECT id, branch_id, church_id, first_name, last_name, phone FROM members WHERE id=$1',
      [memberId]
    );
    member = rows[0] || null;
  }

  let targetBranch = scope || (member && member.branch_id) || branchId;
  if (!targetBranch) targetBranch = await defaultBranchForChurch(church);
  if (!targetBranch) return res.status(400).json({ error: 'branchId is required - this church has no branches yet' });
  const resolved = await resolveBranch(targetBranch, church);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  const name = member ? `${member.first_name} ${member.last_name}` : (memberName || 'Anonymous');
  const ref = accountRef || (member ? `CH-${member.id}` : 'OFFERING');

  let daraja;
  try {
    daraja = await stkPush({
      phone: payerPhone,
      amount: amt,
      accountRef: ref,
      description: description || 'Church giving',
    });
  } catch (e) {
    console.error('[mpesa/stkpush]', e.code || e.message, e.detail || '');
    const status = e.code === 'MPESA_NOT_CONFIGURED' ? 503 : 502;
    return res.status(status).json({ error: e.message || 'Could not start the M-Pesa prompt', code: e.code || 'MPESA_STK_FAILED' });
  }

  const intentId = genId('mp');
  await query(
    `INSERT INTO mpesa_payments
       (id, checkout_request_id, merchant_request_id, phone, amount, account_ref,
        member_id, member_name, branch_id, church_id, category, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')`,
    [intentId, daraja.CheckoutRequestID || null, daraja.MerchantRequestID || null, payerPhone, amt, ref,
     member ? member.id : null, name, resolved.branchId, resolved.churchId, category]
  );

  res.status(200).json({
    status: 'pending',
    id: intentId,
    checkoutRequestId: daraja.CheckoutRequestID || null,
    merchantRequestId: daraja.MerchantRequestID || null,
    message: daraja.CustomerMessage || daraja.ResponseDescription || 'STK prompt sent',
    phone: payerPhone,
    mode: mpesaEnv(),
  });
}));

// Poll the status of a prompt (the member app checks this while the phone is
// waiting for the user to enter their PIN).
router.get('/payments/:checkoutRequestId', authenticate, requireRole('hq_admin', 'branch_admin', 'ministry_leader', 'member'), wrap(async (req, res) => {
  await ensureTable();
  const { rows } = await query(
    `SELECT id, checkout_request_id, phone, amount, account_ref, member_id, member_name,
            category, status, result_code, result_desc, mpesa_receipt, transaction_id, created_at, updated_at
     FROM mpesa_payments WHERE checkout_request_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [req.params.checkoutRequestId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });
  res.json(rows[0]);
}));

// Public Safaricom callback. No auth token - Safaricom's servers post the
// payment result here. Always answer fast with the exact {ResultCode, ResultDesc}
// envelope Daraja expects; retries are safe because intents are guarded by
// their pending status.
router.post('/callback', wrap(async (req, res) => {
  const stk = req.body && req.body.Body && req.body.Body.stkCallback;
  if (!stk || !stk.CheckoutRequestID) {
    return res.json({ ResultCode: 1, ResultDesc: 'No stkCallback found' });
  }
  const checkoutId = stk.CheckoutRequestID;

  try {
    await ensureTable();
    const { rows } = await query(
      'SELECT * FROM mpesa_payments WHERE checkout_request_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 1',
      [checkoutId, 'pending']
    );
    const intent = rows[0];
    if (!intent) {
      // Unknown or already-finalised payment - acknowledge so Safaricom stops
      // retrying the callback.
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    const code = Number(stk.ResultCode);
    const desc = stk.ResultDesc || '';
    const meta = {};
    (stk.CallbackMetadata && Array.isArray(stk.CallbackMetadata.Item) ? stk.CallbackMetadata.Item : [])
      .forEach((item) => { if (item && item.Name !== undefined) meta[item.Name] = item.Value; });

    if (code !== 0) {
      const status = code === 1032 ? 'cancelled' : (code === 1037 ? 'timeout' : 'failed');
      await query(
        'UPDATE mpesa_payments SET status=$1, result_code=$2, result_desc=$3, raw=$4, updated_at=now() WHERE id=$5',
        [status, code, desc, JSON.stringify(req.body), intent.id]
      );
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    // Paid - record the gift exactly once and close the intent.
    const receipt = meta.MpesaReceiptNumber ? String(meta.MpesaReceiptNumber) : 'MP' + Date.now();
    const txId = genId('t');
    const txDate = new Date().toISOString().split('T')[0];
    const { rows: txRows } = await query(
      `INSERT INTO transactions (id,branch_id,church_id,member_id,member_name,amount,category,date,payment_method,receipt_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'M-Pesa',$9) RETURNING id`,
      [txId, intent.branch_id, intent.church_id, intent.member_id, intent.member_name || 'Anonymous',
       Number(intent.amount), intent.category || 'Offering', txDate, receipt]
    );
    await query(
      `UPDATE mpesa_payments
          SET status='success', result_code=$1, result_desc=$2, mpesa_receipt=$3,
              transaction_id=$4, raw=$5, updated_at=now()
        WHERE id=$6`,
      [code, desc, receipt, txRows[0].id, JSON.stringify(req.body), intent.id]
    );
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (e) {
    console.error('[mpesa/callback]', e);
    res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal error - please retry the callback' });
  }
}));

export default router;