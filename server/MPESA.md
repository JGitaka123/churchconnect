# M-Pesa STK Push (Safaricom Daraja) integration

The church's Giving flow uses **Lipa Na M-Pesa Online (STK Push)**. The browser
never touches your Safaricom credentials: it asks the ChurchConnect server to
push a prompt to the giver's phone, and the gift is recorded **only after
Safaricom's callback confirms payment**.

## Credentials - read this first

- Real keys live in `server/.env` (gitignored). Never put them in `app.js`,
  `index.html`, this doc, or any file you `git push`.
- The values pasted on 2026-09-03 are **sandbox** keys (shortcode `174379` +
  the public sandbox passkey). They were shared in plain chat text, so before
  going live: open https://developer.safaricom.co.ke -> My Apps, regenerate the
  consumer key/secret, and keep the new pair in `server/.env` only.

## Environment variables (`server/.env`)

| Variable | Meaning |
| --- | --- |
| `MPESA_ENV` | `sandbox` (default) or `production` |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | Daraja app credentials |
| `MPESA_SHORTCODE` | PayBill/Till that receives money (sandbox demo `174379`) |
| `MPESA_PASSKEY` | Lipa Na M-Pesa passkey for the shortcode |
| `MPESA_CALLBACK_URL` | **Public HTTPS** URL that receives the result |
| `MPESA_ACCOUNT_REF` | PayBill account name shown on the prompt |

`MPESA_CALLBACK_URL` must be reachable by Safaricom over public HTTPS. For local
testing expose the server first, e.g. with ngrok or `cloudflared tunnel`, then
set it to e.g. `https://<tunnel>.ngrok-free.app/api/mpesa/callback`.

The server refuses to push prompts until the callback URL is set (Safaricom
rejects empty callback URLs).

## Endpoints

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/mpesa/stkpush` | Bearer token (admin or member) | Push an STK prompt to a phone |
| `GET /api/mpesa/payments/:checkoutRequestId` | Bearer token | Poll the payment status |
| `POST /api/mpesa/callback` | none (public) | Safaricom posts the result here |

The callback answers fast with the `{ResultCode: 0, ResultDesc: "Success"}`
envelope Daraja expects, then reconciles the confirmed payment into the
`transactions` ledger (payment method `M-Pesa`, receipt = Mpesa receipt number).
Failed/cancelled/timeout prompts record nothing.

## Flow

1. Member taps Give -> M-Pesa, amount + phone number.
2. `POST /api/mpesa/stkpush` -> Daraja `stkpush/v1/processrequest` -> an intent
   row is saved in the `mpesa_payments` table (created lazily on first use).
3. Giver enters their PIN; the member app polls the payment status every 2.5 s.
4. Safaricom calls `/api/mpesa/callback`. On `ResultCode 0` the server writes
   the transaction and marks the intent `success`.
5. The member app shows the confirmation + M-Pesa receipt.

## Sandbox testing notes

- Use a test phone number in the `254...` format in the simulator.
- Sandbox STK pushes do not always produce a real prompt; Safaricom's sandbox
  is intended for contract testing. Expect to simulate/verify the callback via
  the Daraja sandbox tools or your own POST to `/api/mpesa/callback`.
- `ResultCode` reference: `0` success, `1032` cancelled by user, `1037`
  timeout. Other codes are failures - the `result_desc` is stored on the intent.