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
- **Staff, agencies, assessors and consultants:** *Forgot password?* on the staff login of their portal, or a reset link
  sent by their administrator (see "Staff password reset" below). Both set a new password and its hash. MasterAdmin
  and SuperAdmin accounts get their link from another MasterAdmin.

## Staff password reset

New in V4 (the old sites had no reset for staff). Migration `0008_staff_password_reset.sql`, on **all three** databases:
each portal resets the accounts of its own Users table (Consultancy keeps its own accounts in ZED_CONSULTANT).

- **Forgot password?** on the staff login (`/login`, `/Consultancy/login`, `/surveillance/login`) asks for the User ID and
  the captcha. The answer is always the same and comes before the account is looked up: the lookup, the link and the mail
  run in the background. Nothing is sent for an unknown, blocked or MSME account, one without a valid e-mail address, or
  one of an excluded role; every outcome is written to the log category `Zed.Audit.PasswordReset` (never the token).
- **The link** (`{PublicBaseUrl}/reset-password#token=…`) carries a 256-bit random token in the URL fragment, so it does
  not reach the server's logs or other sites. Only its SHA-256 is stored (`dbo.V4PasswordResets`). It works once, for
  `StaffPasswordReset:ValidMinutes` (30), and stops working when a newer link is sent or another one is used. Using it
  clears the account's failed logins (the lock-out of the legacy login procedures) and sets the password through the
  Security:Passwords mode (Dual: plain value and hash; Migrate/HashOnly: hash and a random plain value). A "password
  changed" mail follows.
- **Limits:** 5 requests per 15 minutes per address, and `StaffPasswordReset:MaxRequestsPerHour` (3) self-service links
  per account and hour (more requests get the same answer and send nothing).
- **Excluded roles:** `StaffPasswordReset:ExcludedRoles` (default `7,10`, MasterAdmin and SuperAdmin) cannot reset with
  their e-mail account alone. Another MasterAdmin sends them a link (menu *Password Reset Link*). Add `1` to exclude
  Admin accounts too.
- **Links sent by an administrator:** *Reset Link* in the user screens (MasterAdmin: agencies, assessors/consultants;
  an agency: its own assessors; Surveillance: the agency and assessor lists) and the MasterAdmin page *Password Reset
  Link* (any staff account of the portal, `POST api/staff/password-reset/{userId}`). The link goes to the user's
  registered address; the administrator never sees or sets the password. Not for one's own account (use Change
  Password), nor for a blocked one.
- **Surveillance accounts whose password main holds** (from Migrate on, #111): *Forgot password?* on the surveillance
  portal mails them a pointer to the main portal's reset instead (at most every 15 minutes), administrators are told to
  send the link from main, and an older surveillance link no longer works. `StaffPasswordReset:MainPortalUrl` overrides
  the main address (default: the surveillance PublicBaseUrl without `Portal:PathBase`). In Dual their surveillance copy
  is their password on this portal and is reset here, as Change Password does.
- **Sessions:** V4 signs staff in with a cookie only (no server-side session list), so a reset does not end sessions
  already open elsewhere; they expire after at most 120 minutes without activity.
- `StaffPasswordReset:Enabled=false` turns both ways off on a portal.

Setting up: run 0008 on the three databases and grant the V4 logins `EXECUTE` on `SP_V4_STAFF_RESET_ACCOUNT`,
`SP_V4_STAFF_RESET_CREATE`, `SP_V4_STAFF_RESET_FIND` and `SP_V4_STAFF_RESET_USE`. Each portal needs a working SMTP
profile (`Email:Profiles:Default`) and its own `Portal:PublicBaseUrl`.

## MSME password reset

Migration `0009_msme_password_reset.sql` (ZEDCS_V2_LIVE, after 0008) moves the MSME reset onto the same table and rules
as the staff reset (SECURITY-FINDINGS #128). The old procedures `SP_MSME_PWD_UPDATE_TOKEN` / `SP_MSME_PWD_VALIDATE_CODE`
kept every code in clear (`Users.PwdCode`, `ForgotPwdLinks`), never expired them and returned `Users.*`; V4 no longer
calls them.

- **Where links are sent:** "Forgot password" on the MSME login, the staff "Resend Details" (Registered MSMEs,
  SuperAdmin) and the MSME app's `Msme/ResetPassword`. The mail goes to the unit's pledge e-mail (`Users.Email` when
  there is none), with `{PublicBaseUrl}/msme/reset-password#token=…`.
- **The link:** 256-bit token in the URL fragment, only its SHA-256 stored in `dbo.V4PasswordResets`, works once for
  `MsmePasswordReset:ValidMinutes` (60), replaced by a newer link. An MSME link cannot be used on the staff reset and
  the reverse. Using it clears the unit's failed logins and its legacy `PwdCode` (so an older link of the old site
  stops working too) and sets the password through the Security:Passwords mode; a "password changed" mail follows.
- **No probing:** the portal answers before the lookup (the lookup, link and mail run in the background), and the app
  now gives the same "A Reset link has been sent…" answer for every ZED ID (it used to say "no User exists").
  Nothing is sent for an unknown or inactive ZED ID or one without an e-mail address; outcomes go to
  `Zed.Audit.PasswordReset`.
- **Limits:** 5 requests per 15 minutes per address (portal) or per ZED ID (app), and
  `MsmePasswordReset:MaxRequestsPerHour` (3) self-service links per ZED ID and hour. Links sent by staff are not counted.
- **Old links:** codes mailed by the old site (`/Msme/ChangePassword?code=…`, `/msme/reset-password?code=…`) are not
  accepted; the page says so and points to "Forgot Password".

Setting up: run 0009 on ZEDCS_V2_LIVE and grant the portal's and the MSME app's logins `EXECUTE` on
`SP_V4_STAFF_RESET_CREATE`, `SP_V4_MSME_RESET_ACCOUNT`, `SP_V4_MSME_RESET_FIND` and `SP_V4_MSME_RESET_USE`.
After decommission: `EXEC dbo.SP_V4_PURGE_LEGACY_RESET_CODES` (counts), then `@Mode = 'APPLY'` clears `Users.PwdCode`
and empties `ForgotPwdLinks` (the old site needs them while it is live).

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
