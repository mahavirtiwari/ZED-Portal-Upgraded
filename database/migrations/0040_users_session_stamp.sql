-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (each portal signs in the users of its own Users table).
-- Additive and safe to re-run: one new column of the existing dbo.Users; no legacy object changes.
-- Server-side end of web sessions (audit M12). Users.SessionStamp is copied into the sign-in cookie; the portals compare
-- it with this column (at most a minute old, Zed.Core.Security.SessionStamps) and end every session whose stamp differs.
-- V4 sets a new value (NEWID()) wherever a user's access changes: password changed or reset, account blocked or
-- unblocked (also locked by failed logins), staff user edited (agency verification types: its assessors too), MSME
-- deactivated. NULL until the first change: the sessions of today stay valid when this is deployed. The legacy
-- procedures and the old sites never read or write it (their inserts name their columns).
-- The V4 portal logins already have SELECT and UPDATE on dbo.Users (zed_v4_app: db_datareader + db_datawriter); the
-- Consultancy and Surveillance hosts read main's column through their read-only connection (zed_v4_readonly) for the
-- Admin's sessions handed over from the main portal. Main's portal login also updates the ZED_SURVEILLANCE copy of an
-- account that main's procedures maintain there (agencies, assessors).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL AND COL_LENGTH('dbo.Users', 'SessionStamp') IS NULL
    ALTER TABLE dbo.Users ADD SessionStamp uniqueidentifier NULL;
GO
