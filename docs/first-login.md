# First Login (HVA-96 bootstrap)

After running `pnpm db:seed` on a fresh production DB:

1. The seed script prints a 16-char hex temp password to stdout twice — once
   before the user is created, once after. The "after" banner is the last line
   of seed output. Look for the block bracketed by `=` lines.
2. Write it down. It is **not logged anywhere else**, **not committed**, **not
   recoverable**.
3. Log in to `/login` with:
   - Phone: `+919885698665`
   - Password: *the temp password from step 1*
4. The app forces a password change on first login (the seed sets
   `must_change_password = true`).
5. Set a real password. Do not share. Do not commit.

## If you lose the temp password before changing it

You have two recovery paths, both require shell access on the VPS:

### Option A — re-mint via direct DB

```sh
# 1. Connect to the DB
pnpm db:psql

# 2. Hash a new plaintext (use a one-off Node REPL or the test-admin seed pattern)
#    The recommended path is to delete the row and re-run pnpm db:seed:
DELETE FROM accounts WHERE user_id = (SELECT id FROM users WHERE phone='+919885698665');
DELETE FROM users WHERE phone='+919885698665';
```

Then back on the host:

```sh
DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app pnpm db:seed
```

A fresh temp password will be printed. Capture it this time.

### Option B — manual hash (advanced)

Use `better-auth/crypto`'s `hashPassword(plaintext)` (scrypt) and update the
`accounts.password` column directly. Same pattern as
`scripts/seed-test-admin.ts`. This is more error-prone than Option A; prefer
delete-and-reseed unless you have a specific reason.

## What the seed does NOT touch

`pnpm db:seed` is idempotent. If the row at `phone='+919885698665'` already
exists, the script skips it and never modifies the existing user, the existing
password, or the existing `must_change_password` flag. It logs
`[seed] super_admin Sandeep already exists, skipping.` and moves on.

Running the seed twice in a row is therefore safe — the second run is a no-op.
