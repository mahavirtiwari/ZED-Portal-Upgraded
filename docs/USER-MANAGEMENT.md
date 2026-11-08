# User management (new in V4)

The same in all three portals (main, consultancy, surveillance); each portal keeps its own logins in its own database.

## Who creates whom

| Login | Created by | Screen | Stored as |
|---|---|---|---|
| Master Admin, Ministry, MSME DFO, Dashboard Admin | Admin (main portal; it switches to Consultancy / Surveillance) | **User Management** | `Users` row (legacy roles 7, 8, 6, 10) |
| NEFT Admin (one, every state) | Master Admin (main) | **Agencies → NEFT Admins** | `Users` row, role 6, state `ALL` |
| Agencies / consultant organisations, assessors / consultants | Master Admin, agency (as before) | Agencies, Assessors | `Users` row |
| Operation admins | Master Admin | **Operation Admins** | `dbo.V4SubUsers` (migration 0012) |
| Sub-users | Agency (assessment, Bronze, surveillance agency; consultant organisation) | **Sub-Users** | `dbo.V4SubUsers` |

Since 2026-11-07/08:

* **Master Admin / Ministry**: a scope (Manufacturing / Services / Both, levels; Master Admin also states) limits their
  data and the users they create (`Users.SectorActivity`, `ScopeLevels`, `ScopeStates`, migration 0057). On Consultancy the
  levels are Silver and Gold.
* **MSME DFO**: one login, created on main, for Financial Assistance (main) and Handholding TU (Consultancy): category,
  states, districts per state (`ScopeDistricts`, migration 0059) and its NEFT lists (`ScreenAccess` `main:neft`,
  `consultancy:neft`). The Consultancy portal lists DFOs; old Consultancy-only DFOs keep working there.
* **Dashboard Admin** (role 10) replaced Super Admin, Citizen Feedback (11) and QC (17); migration 0058 converts any 11/17 login
  on every run. The Admin ticks its screens and tabs per portal (`ScreenAccess`), "Hide agency and assessor names" and "Can make
  changes" (resend, deactivate, edit profile, update payment). It signs in on main only and opens the other portals from there.
* **NEFT Admin**: one active login; only a Master Admin without a scope can add or unblock it.
* **Agency level allocation** (Agencies menu): Bronze / Silver / Gold / ZED-X per agency (`Allow*Assessments`, migration 0060);
  manual and automatic allotment (0063) and financial assistance allotment skip a disabled level.
* **Block history**: every block / unblock (reason, by whom, when) in `dbo.UserBlockHistory` (migration 0061, all three portals);
  a blocked assessor or consultant is signed out of the app on its next call.

The Admin chooses the User ID; the user is mailed a one-time link to set the password, valid 24 hours (Master Admin logins
get a generated password instead; Reset Password mails a new one).
Agencies, assessors, consultants and sub-users get the same link in their welcome mail; the office copy has neither
the password nor the link (docs/PASSWORDS.md, "Staff password reset"). Block / UnBlock sets `Users.IsActive`; it, an
edit or a new password ends the user's open sessions (docs/PASSWORDS.md, "Sessions").

## Sub-users (operation admins and agency sub-users)

* A sub-user signs in on the normal staff login with its own ID (generated: `<owner ID>S01`, `S02`, …) and password, and
  then **works as its owner**: the owner's role, sub-roles and data. Everything it does is recorded under the owner's ID
  in the legacy tables; the portal log also records the sub-user's ID for every change.
* Its **roles and permissions follow its owner**: the owner ticks which of its own screens the sub-user may use (only
  screens of the owner's own menu are offered). The menu shows only those screens, and the API refuses every other
  staff call (`SubUserAccessFilter`), so typing a URL does not help.
* Changes by the owner (screens, block, Reset Password) apply within 30 seconds: the sub-user is signed out and signs in
  again with the new screens or password. If the owner is blocked, its sub-users cannot sign in and are signed out.
* Sub-users cannot create sub-users, change their owner's password or use "Forgot password?": the owner resets their
  password. Five wrong passwords lock a sub-user for 15 minutes (Reset Password unlocks it).
* Sub-users do not use the mobile apps (the apps keep their own logins).

Screens an owner can give (`SubUserPermissions.cs`):

| Owner | Screens |
|---|---|
| Master Admin | Agencies / organisations and their assessors, Payment Received, Allotment, Monitoring, Completed and rejected, Password Reset Link; main: ZED ID History, Financial Assistance, Upload API Incentives; consultancy: Technology Upgradation |
| Agency | Monitoring, Assessors / consultants, Desktop allotment (main, surveillance), Site / consultancy allotment, Completed and rejected, Reports; main: Financial Assistance verification; consultancy: Technology Upgradation (each only with the agency's own verification types) |

## Deployment

Migration `0012_sub_users.sql` on all three databases (the Migrations step of `Invoke-ZedStaging.ps1` and
`Invoke-ZedDatabaseScripts.ps1` run it). Without it no sub-user can be created or sign in; the rest works.
