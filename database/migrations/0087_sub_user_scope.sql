-- 2026-11-16 (approved): the states (and, for a Master Admin's operation admin, the assessment agencies) a sub-user may see
-- (Staff → Operation Admins / Sub-Users). Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE),
-- after 0012. Additive and safe to re-run: two columns on dbo.V4SubUsers.
--   ScopeStates   comma-separated state codes (dbo.States.StateCode; the unit's plant state decides); NULL = every state
--   ScopeAgencies comma-separated agency user IDs (dbo.Users, RoleId 2; MsmeCertifications.CertificationBodyUserId);
--                 NULL = every agency. Only an operation admin has it.
-- A sub-user's states narrow its owner's (a scoped Master Admin's operation admin stays within the owner's states).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4SubUsers', 'U') IS NOT NULL AND COL_LENGTH('dbo.V4SubUsers', 'ScopeStates') IS NULL
    ALTER TABLE dbo.V4SubUsers ADD ScopeStates varchar(1000) NULL;
GO
IF OBJECT_ID('dbo.V4SubUsers', 'U') IS NOT NULL AND COL_LENGTH('dbo.V4SubUsers', 'ScopeAgencies') IS NULL
    ALTER TABLE dbo.V4SubUsers ADD ScopeAgencies varchar(4000) NULL;
GO
