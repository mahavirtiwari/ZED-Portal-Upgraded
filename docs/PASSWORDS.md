# Passwords: from plain text to hashes

The three legacy databases keep passwords in plain text (`Users.Password varchar(50)`), the login procedures compare
them in SQL, and failed attempts are stored with the typed password in `FailedLogins` (SECURITY-FINDINGS #2). The old
sites depend on that column, so it cannot change while they are live. V4 therefore moves in three steps, set by
**`Security:Passwords`** on every V4 host (Main, Consultancy and Surveillance APIs, and every mobile API deployment).

| Mode | When | Login | Passwords V4 sets (change, reset, new accounts) |
|---|---|---|---|
| `Dual` (default) | While any old site or old mobile service is live | As before: the typed password against the plain column (procedure master values refused, #27). V4 also writes a salted hash of every password it confirms. | Plain column = the password (the old sites read it), plus the hash |
| `Migrate` | From the moment the old sites are off | An account with a hash: the hash only. An account without one: once against the plain column, which then moves to a hash. Either way the plain column is replaced by a random value. | Plain column = a random value, plus the hash |
| `HashOnly` | When (nearly) every account has a hash | The hash only. An account without a hash cannot sign in until its password is reset. | As Migrate |

How it works (`Zed.Core.Security.PasswordStore`, migration `database/migrations/0005_password_hashes.sql`):

- **Storage.** `dbo.V4UserPasswords (UserId, PasswordHash, HashedAt)` in each database, a side table: the legacy tables and
  procedures are not touched (several `SELECT *` / copy `Users`). The hash is ASP.NET Core's `PasswordHasher` v3
  (PBKDF2-HMAC-SHA512, 128-bit salt, 100,000 iterations), prefixed `u1$`.
- **Same comparison as before.** The procedures compare in a case-insensitive collation and ignore trailing spaces, so
  passwords have always been case-insensitive. Scheme `u1` hashes the normalised password (trimmed at the end,
  upper-case) so nobody is locked out. A later scheme can hash the exact password at the next password change.
- **The procedures still run.** The login procedures also check that the account is active and locked out, its role, and the
  allotment. After the hash matches, V4 calls them with the value stored in `Users.Password`. That is the old password
  the first time, then a random `V4!…` value (49 characters) that only the database holds. A refused password goes to the
  procedure as `V4!REFUSED`, so the failed-login count and lock-out still apply and the typed password is no longer
  written to `FailedLogins`.
- **Random values never work as passwords.** `LegacyPasswords.Matches` refuses them, even typed exactly. This matters
  because the QR code of the pledge certificate holds the initial password (see below).
- **Dual is best-effort.** If 0005 is missing or a hash write fails, the login goes ahead exactly as before and a warning
  is logged ("Password hash not recorded"). In Migrate and HashOnly, errors are not ignored.
- **Plain value authoritative in Dual.** While the old sites live, they still change passwords (their change and forgot
  password pages, admin resets). When the hash and the plain value disagree, the plain value wins and the hash is
  rewritten.
- **Going back.** Setting Migrate or HashOnly back to Dual is safe: accounts whose plain value was already replaced keep
  signing in with their hash.

## Surveillance accounts copied from main (#111)

Main's `SP_INSERT_USER` copies a new agency's or assessor's password into `ZED_SURVEILLANCE.dbo.Users`, and nothing
keeps the copy in step afterwards. On the Surveillance hosts (web and mobile):

- **Dual.** The copy stays that account's surveillance password, as today, and gets its own hash in ZED_SURVEILLANCE.
- **Migrate and HashOnly.** When main holds a hash for the same UserId and role, **main's hash is the password** (the
  accounts are mastered in main). The host reads it with `SP_V4_GET_PASSWORD` over `ConnectionStrings:Main`, opened
  read-only. The surveillance copy is replaced by a random value at the first login. The Surveillance portal's Change
  password refuses such accounts ("managed on the main ZED portal"), so the password is changed on main and then works
  on both systems. New accounts created on main after the switch get a random value in both databases and their hash in
  main.
- **Accounts only surveillance has**, or accounts main has no hash for yet, use the surveillance hash, as on the other
  systems.

Blocking still has to be done on both sides (see LIVE-HARDENING).

## Setting up

1. Run `0005_password_hashes.sql` on **all three** databases. It is additive: one new table and three new procedures, and
   it can be run again.
2. Grant the V4 database logins `EXECUTE` on `SP_V4_GET_PASSWORD` and `SP_V4_SET_PASSWORD_HASH`. The Surveillance
   hosts' main login needs only `EXECUTE` on main's `SP_V4_GET_PASSWORD`.
3. Leave `Security:Passwords` unset (Dual). Hashes fill up as people sign in to V4.

## Cut-over

1. **While the old sites are live:** Dual. Watch the progress:

   ```sql
   EXEC dbo.SP_V4_PURGE_PLAIN_PASSWORDS;
   ```

   This is PREVIEW: it only counts accounts with and without a hash, and FailedLogins rows that hold a password.
2. **The old sites and old mobile services are switched off:** set `Security:Passwords=Migrate` on every V4 host at the
   same time. Then, in each database:

   ```sql
   EXEC dbo.SP_V4_PURGE_PLAIN_PASSWORDS @Mode = 'APPLY', @Scope = 'HASHED';
   ```

   This replaces the plain value of every hashed account and blanks the passwords in FailedLogins.
3. **Later** (weeks), when PREVIEW shows that the accounts still without a hash are ones you accept will need a reset:
   1. Set `Security:Passwords=HashOnly`.
   2. Run `EXEC dbo.SP_V4_PURGE_PLAIN_PASSWORDS @Mode = 'APPLY', @Scope = 'ALL';` in each database. No plain-text password
      remains after this.
4. **Never** run the purge, or switch off Dual, while an old site can still log in. It logs in against the plain value.

**Resetting an account without a hash:**
- **MSMEs:** *Forgot password* on the MSME login (web) or in the app. The link sets a new password and its hash.
- **Staff, agencies and assessors:** there is no self-service reset, and the old site had none either. Sign in during
  Migrate, which moves the account to a hash, or have the account's administrator issue a new password. Run HashOnly only
  once the PREVIEW count of staff accounts without a hash is acceptable.

## Also found

- **The pledge certificate QR code contains the initial password.** `SP_MSME_INSERT_UDYAM_DETAILS` builds `QrCodeNo` as
  plant id + `'1'` + `UPPER(@Password)`, and passwords are case-insensitive. Anyone holding a pledge certificate (or its
  QR code) of a unit that never changed its password can sign in as that unit. From Migrate on, V4 passes a random value
  there instead, so new QR codes carry nothing usable.

  Existing certificates keep the initial password, and it stays valid until the unit changes it. Its hash is the same
  password, so the purge does not help. While the plain values still exist (Dual), this query counts the affected
  units in ZEDCS_V2_LIVE:

  ```sql
  SELECT COUNT(*) FROM dbo.Msme M JOIN dbo.Users U ON U.UserId = M.ZedId AND U.RoleId = 5
  WHERE U.Password IS NOT NULL AND RIGHT(M.QrCodeNo, LEN(U.Password) + 1) = '1' + UPPER(U.Password);
  ```

  Those units should be asked to reset their password (the Forgot password mail).
