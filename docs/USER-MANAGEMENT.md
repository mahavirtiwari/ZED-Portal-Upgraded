# User management (new in V4)

The same in all three portals (main, consultancy, surveillance); each portal keeps its own logins in its own database.

## Who creates whom

| Login | Created by | Screen | Stored as |
|---|---|---|---|
| Master Admin, Ministry, MSME DFO (StateCoordinator, per state), Dashboard (SuperAdmin, CitizenFeedback, QC) | Admin | **User Management** | `Users` row (legacy roles 7, 8, 6, 10, 11, 17) |
| Agencies / consultant organisations, assessors / consultants | Master Admin, agency (as before) | Agencies, Assessors | `Users` row |
| Operation admins | Master Admin | **Operation Admins** | `dbo.V4SubUsers` (migration 0012) |
| Sub-users | Agency (assessment, Bronze, surveillance agency; consultant organisation) | **Sub-Users** | `dbo.V4SubUsers` |

MSME DFOs are offered on main and consultancy only (the NEFT screens); the DFO's state decides which NEFT
transactions it sees. The Admin chooses the User ID; a password is generated and mailed to the user (Reset Password
mails a new one). Block / UnBlock sets `Users.IsActive`.

## Sub-users (operation admins and agency sub-users)

* A sub-user signs in on the normal staff login with its own ID (generated: `<owner ID>S01`, `S02`, …) and password, and
  then **works as its owner**: the owner's role, sub-roles and data. Everything it does is recorded under the owner's ID
  in the legacy tables; the portal log also records the sub-user's ID for every change.
* Its **roles and permissions follow its owner**: the owner ticks which of its own screens the sub-user may use (only
  screens of the owner's own menu are offered). The menu shows only those screens, and the API refuses every other
  staff call (`SubUserAccessFilter`), so typing a URL does not help.
* Changes by the owner (screens, block) apply within 30 seconds; a blocked sub-user is signed out. If the owner is
  blocked, its sub-users cannot sign in.
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
