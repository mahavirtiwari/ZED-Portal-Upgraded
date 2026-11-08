-- Run on ZEDCS_V2_LIVE and ZED_CONSULTANT. Safe to re-run.
--
-- Block history (2026-11-08, at the Master Admin's request; Assessors / Consultants -> Block, Unblock, History): every block
-- and unblock of a staff login, with its reason, who did it and when. There is no legacy table for it, so a history table
-- named like the legacy ones (AgencyAllotmentHistory, NcClosureDateHistory):
--   dbo.UserBlockHistory   UserId, RoleId (of the login), Action ('Blocked' / 'Unblocked'), Reason, ActionBy (user id),
--                          ActionByRole, ActionDate
-- Blocking itself is unchanged (Users.IsActive and ReasonForRejection; SP_BLOCK_UNBLOCK_USER on main).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT')
    THROW 50061, '0061 runs on ZEDCS_V2_LIVE and ZED_CONSULTANT.', 1;
GO
IF OBJECT_ID(N'dbo.UserBlockHistory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserBlockHistory (
        Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserBlockHistory PRIMARY KEY,
        UserId varchar(50) NOT NULL,
        RoleId int NULL,
        Action varchar(20) NOT NULL CONSTRAINT CK_UserBlockHistory_Action CHECK (Action IN ('Blocked', 'Unblocked')),
        Reason nvarchar(2000) NULL,
        ActionBy varchar(50) NULL,
        ActionByRole int NULL,
        ActionDate datetime NOT NULL CONSTRAINT DF_UserBlockHistory_ActionDate DEFAULT (GETDATE())
    );
    CREATE INDEX IX_UserBlockHistory_UserId ON dbo.UserBlockHistory (UserId, Id);
END
GO
