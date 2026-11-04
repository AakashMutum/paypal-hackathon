# Rotating the audit encryption key

`AUDIT_ENCRYPTION_KEY` seals two kinds of stored data with AES-256-GCM before they reach
PostgreSQL: the `data` column of `investigations` and the `detail` column of `payment_events`
(`apps/api/src/services/persistence/auditPrivacy.ts`). This page covers replacing that key.

Not run against a real PostgreSQL. The rotation is tested with an in-memory store and a mock pool
(`apps/api/test/audit.rotation.test.ts`); run the dry run against your own database first.

## Variables

| Variable | Meaning |
| --- | --- |
| `AUDIT_ENCRYPTION_KEY` | The current key. All new data is encrypted with it. 64 hex characters (or 32 bytes in base64) |
| `AUDIT_ENCRYPTION_KEY_PREVIOUS` | The key you are rotating away from. Used to **decrypt only**, and only when the current key cannot open a record. Never used to encrypt |
| `AUDIT_HMAC_KEY` | Key for the payee-email fingerprint. If unset, the fingerprint falls back to the encryption key (see "Before you rotate") |

`GET /health` reports `modes.auditEncryption` as `enabled`, `disabled` or `invalid`. It never shows
a key. `invalid` means a key is set but unusable, including a previous key without a valid current
key, or a malformed previous key.

## Generate a key without pasting it anywhere

Make the key on the machine you are sitting at and send it straight to the clipboard, then paste
it only into the secret field of your host. Do not paste it into chat, an issue, a commit or a
terminal history.

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | clip
```

`clip` is Windows. On macOS use `pbcopy` instead; on Linux use `xclip -selection clipboard`.
(Only the Node command was run while writing this; the clipboard tools are standard but were not
checked on every system.) Clear the clipboard afterwards. Keep a copy of the old key until the
last step below.

## Before you rotate

The payee-email fingerprint is derived from `AUDIT_HMAC_KEY`, or from the encryption key when that
is unset. If it comes from the encryption key, changing the key changes the fingerprint, and an
order still waiting for approval would no longer match its stored fingerprint at approval time.
To avoid this, set `AUDIT_HMAC_KEY` to the **current** (old) key value before you change
`AUDIT_ENCRYPTION_KEY`, and leave it set. This works when the old key is the 64-character hex form
(the documented form). The rotation script prints a warning when a previous key is set and
`AUDIT_HMAC_KEY` is not.

## Rotate

1. Set `AUDIT_HMAC_KEY` as above, and redeploy.
2. Set the new key as `AUDIT_ENCRYPTION_KEY` and the old key as `AUDIT_ENCRYPTION_KEY_PREVIOUS`.
   Redeploy. Check `GET /health` shows `auditEncryption: "enabled"`. The API now reads rows sealed
   with either key and writes with the new one.
3. Dry run, with the same variables and `DATABASE_URL` in the environment of the process:

   ```bash
   npm run audit:rotate
   ```

   It prints counts per table (scanned, would rotate, already current, plaintext, unreadable).
   It never prints row data, ids or keys, and it writes nothing.
4. Apply:

   ```bash
   npm run audit:rotate -- --apply
   ```

   Rows are read in batches of 50 (`--batch-size`, 1 to 500). Each batch is one short transaction
   that locks its rows, re-encrypts those sealed with the previous key under the current key, and
   commits. A failure rolls back the current batch; earlier batches stay done.
5. Verify. Run the dry run again: "would rotate" must be 0 for both tables. Open an old
   investigation in the app. Check `GET /health`.
6. Only then remove `AUDIT_ENCRYPTION_KEY_PREVIOUS` and redeploy. Keep the old key somewhere safe
   for as long as you might restore a database backup made before the rotation.

The script is safe to re-run: a record already sealed with the current key is skipped. It refuses
to run unless `/health` would report `enabled`, and it refuses to write anything that is not
encrypted.

Rows stored as plaintext (written before encryption was turned on) stay readable and are left
alone. Add `--include-plaintext` to seal them too.

## If a key is lost

AES-GCM cannot be broken or recovered. Rows sealed with a key you no longer have cannot be read.
The rotation script counts them as `unreadable`, leaves them untouched and exits with an error.
Be aware of what the API does with such a row: reading it throws, and the list queries map over
every row, so one unreadable row can make the list endpoint fail (read from the code in
`recordStore.ts`; not run against a database). The ways out are to restore the key, restore a
backup, or delete the unreadable rows. Do not remove the previous key while the dry run still
shows rows that need it.

Plaintext rows from before encryption was enabled remain readable whatever happens to the keys.
