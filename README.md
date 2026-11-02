# TrustOra

TrustOra authorizes a PayPal order, investigates the merchant, then captures or voids the payment.

## Quick start

1. Install: `npm install`
2. Copy `.env.example` to `.env` and fill in the placeholders.
3. Build: `npm run build`
4. Test: `npm test`
5. Run the API: `npm run dev`

## Frontend (apps/web)

React 18 + TypeScript + Tailwind, styled to the "Autonomous Sentinel" design system.

```bash
npm install
cp apps/web/.env.example apps/web/.env
npm run dev:web          # http://localhost:5173
```

### Demo script (works offline with the built-in mock backend)
1. `/stores` → open **Luxaura Outlet Deals** → Buy now → Pay with PayPal → watch the 4-node pipeline → **Payment Capture Paused** → Cancel & Void.
2. Repeat with **Mega Deals** (WARN, review hold) and **PulseAudio** (ALLOW, captured).
3. `/analyst` for the live judging console (filters, risk slider, evidence cards, reset).

### Connect the real backend
Set `VITE_USE_MOCK=false` and `VITE_API_TARGET` (Vite proxies `/api`). Endpoints used:

| Method | Path | Purpose |
|---|---|---|
| POST | /api/orders | create AUTHORIZE order → `{orderId, paypalOrderId, investigationId}` |
| POST | /api/orders/:orderId/approved | tell backend the buyer approved in PayPal |
| GET | /api/investigations, /api/investigations/:id | list / poll (status, evidence[], verdict, captureState) |
| POST | /api/scan | scan a URL → Investigation |
| POST | /api/orders/:id/cancel, /review | void authorization / request analyst review (id = investigation id) |
| POST | /api/reports, /api/merchants, /api/demo/reset | report, onboarding, reset |

Real PayPal button: set `VITE_PAYPAL_CLIENT_ID` (sandbox). Types live in `packages/contracts`, imported as `@checkout-guardian/contracts`.
The frontend never captures or voids payments itself and only shows "captured" when the API says so.

## Tools used

TODO: list each tool and service used (including AI tools) and how it was used.
