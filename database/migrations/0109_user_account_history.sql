-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (as 0061), after 0061. Additive and safe to re-run (re-run on each deploy).
--
-- 2026-11-21 (the product owner, on the History panel of the assessor page: "profile Edit histories etc. are missing"): the
-- History of a staff login becomes the history of its account. dbo.UserBlockHistory (0061, the blocks and unblocks) also keeps:
--   Created        the account was created (agency, assessor / consultant, incentive verification agency, NEFT Admin, User
--                  Management login), with what it was created with
--   Edited         a profile save that changed something, with the list of changed fields (old -> new, lists as added / removed)
--   PasswordLink   a password reset / set-password link was e-mailed (by an administrator or asked by the user), or a new password
--   MobileReset    the mobile number was changed from the list's Mobile No button
--   SessionsEnded  an explicit "sign out everywhere" (allowed for later; no page has one yet)
-- Never a password or a token. The allotments are not written here: the portal reads them from the existing allotment histories.
--
-- dbo.UserBlockHistory.Details   nvarchar(max) NULL   the change list, JSON: [{"field":"mobile","old":"…","new":"…"},
--                                                     {"field":"states","added":["…"],"removed":["…"],"addedCount":12}]
-- CK_UserBlockHistory_Action     dropped and created again with the new actions.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50109, '0109 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
IF OBJECT_ID(N'dbo.UserBlockHistory', N'U') IS NULL
    THROW 50109, '0109 needs 0061 (dbo.UserBlockHistory).', 1;
GO
IF COL_LENGTH('dbo.UserBlockHistory', 'Details') IS NULL
    ALTER TABLE dbo.UserBlockHistory ADD Details nvarchar(max) NULL;
GO
-- The check is re-created on every run, so its list is always this one.
IF OBJECT_ID(N'dbo.CK_UserBlockHistory_Action', N'C') IS NOT NULL
    ALTER TABLE dbo.UserBlockHistory DROP CONSTRAINT CK_UserBlockHistory_Action;
GO
ALTER TABLE dbo.UserBlockHistory WITH CHECK ADD CONSTRAINT CK_UserBlockHistory_Action
    CHECK (Action IN ('Blocked', 'Unblocked', 'Created', 'Edited', 'PasswordLink', 'MobileReset', 'SessionsEnded'));
GO
PRINT '0109: account history ready on ' + DB_NAME() + '.';
GO
