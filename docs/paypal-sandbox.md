# Using the PayPal sandbox

By default the API runs in explicit simulation: orders, authorizations and captures are made up
locally, every response says `simulated: true`, and ids start with `SIM-`. To use the real PayPal
sandbox instead, set the variables below. Names only here; never put values in the repository.

The API refuses to start if `PAYPAL_MODE` is anything other than `sandbox`. Live mode is not
supported.

## 1. Create a developer app

1. Sign in at the PayPal developer dashboard and open **Apps & Credentials**.
2. Switch to **Sandbox**.
3. Create an app (type: Merchant). Open it and copy the **Client ID** and **Secret**.
4. Set them on the API as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Leave `PAYPAL_MODE` as
   `sandbox`.

With both set, the API's `/health` reports `modes.paypal` as `sandbox`.

## 2. Create sandbox accounts

Open **Testing tools**, then **Sandbox accounts**, and create:

- three **Business** accounts, one for each demo store: genuine, discount and impersonator;
- one **Personal** (buyer) account, used to approve payments.

The API has no use for the buyer's credentials. You use that account yourself when the PayPal
approval page opens.

## 3. Point each store at its business account

Each canonical store reads its payee from the environment. Without these variables the fixture
values are used and the PayPal order is created without a payee.

| Store | Payee email | Payee merchant id |
| --- | --- | --- |
| Genuine | `STORE_GENUINE_PAYEE_EMAIL` | `STORE_GENUINE_PAYEE_MERCHANT_ID` |
| Discount | `STORE_DISCOUNT_PAYEE_EMAIL` | `STORE_DISCOUNT_PAYEE_MERCHANT_ID` |
| Impersonator | `STORE_IMPERSONATOR_PAYEE_EMAIL` | `STORE_IMPERSONATOR_PAYEE_MERCHANT_ID` |

Use the email address of the matching sandbox business account for the email variable.

### Reading an account's merchant id

1. In **Sandbox accounts**, open the account's menu and choose **View/Edit account**.
2. On the **Profile** tab, find the **Account ID** (for a business account this is its merchant
   id).
3. Copy it into the matching `..._PAYEE_MERCHANT_ID` variable.

The impersonator store is meant to claim the genuine brand while being paid by a different
account, so give it a different business account from the genuine store. The registry keeps the
genuine store's merchant id as the brand's registered id; the impersonator's payee differs from
it, which is what triggers the payee-mismatch rule.

## 4. What the flow does in the sandbox

1. The API creates the order with intent `AUTHORIZE`, with a `PayPal-Request-Id` header.
2. You approve it as the buyer on the PayPal page opened from the order's `approvalUrl`.
3. After approval the web app calls the API; the API authorizes the order and stores the
   authorization id.
4. Only an ALLOW (or a WARN a person acknowledged) is captured, through
   `POST /v2/payments/authorizations/{id}/capture`. A PAUSE is never captured. A held order is
   voided through `POST /v2/payments/authorizations/{id}/void`.

## What a FAILED order from a bad payee looks like

If a payee email is not a valid sandbox business account, PayPal rejects the order when it is
created. The API does not invent an order. The response is HTTP 502 in the standard error
envelope:

```json
{ "success": false, "error": { "code": "PAYPAL_ERROR", "message": "PayPal could not create the order. ..." } }
```

The message carries PayPal's own wording for the problem (for example that the payee account is
invalid). No investigation is stored for that attempt.

If PayPal accepts the order but a later step fails, the investigation is kept and its capture
state becomes `FAILED`, with the reason in `captureReason`, for example
`Capture failed. PayPal CAPTURE_FAILED (422): ...`. Every state change is also written to the
`payment_events` audit trail. No reason or log line contains a credential, a token or an
authorization header.

To fix a bad payee, correct the `STORE_*_PAYEE_EMAIL` value, restart the API and create a new
order.
