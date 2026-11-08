-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (each portal has its own logins), after 0057 and 0058.
-- Safe to re-run.
--
-- One MSME DFO for Financial Assistance and Handholding (2026-11-07, at the Admin's request; Admin -> User Management): an
-- MSME DFO (Users.RoleId 6) has a category (0057's SectorActivity), several states (0057's ScopeStates; Users.StateCode keeps
-- the first one, which the legacy procedures read), the districts among them and its NEFT lists. A new column of the legacy
-- table:
--   dbo.Users.ScopeDistricts   the district codes (Districts.DistrictCode), comma-separated; NULL = every district
-- and its NEFT lists in 0058's ScreenAccess: "main:neft" (Financial Assistance) and / or "consultancy:neft" (Handholding).
-- Once (marker: the extended property V4_0059_MsmeDfoArea on dbo.Users), today's MSME DFOs keep their state as their one
-- state and get their own portal's NEFT list. The NEFT Admin (state "ALL") is not changed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50059, '0059 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
IF COL_LENGTH('dbo.Users', 'ScopeDistricts') IS NULL ALTER TABLE dbo.Users ADD ScopeDistricts varchar(4000) NULL;
GO
IF COL_LENGTH('dbo.Users', 'ScopeStates') IS NOT NULL AND COL_LENGTH('dbo.Users', 'ScreenAccess') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
                   AND major_id = OBJECT_ID(N'dbo.Users') AND name = N'V4_0059_MsmeDfoArea')
BEGIN
    DECLARE @portal varchar(20) = CASE DB_NAME() WHEN N'ZED_CONSULTANT' THEN 'consultancy' WHEN N'ZED_SURVEILLANCE' THEN 'surveillance' ELSE 'main' END;
    EXEC sp_executesql N'
        UPDATE dbo.Users
        SET ScopeStates = ISNULL(ScopeStates, NULLIF(LTRIM(RTRIM(StateCode)), '''')),
            ScreenAccess = ISNULL(ScreenAccess, @portal + '':neft'')
        WHERE RoleId = 6 AND ISNULL(StateCode, '''') <> ''ALL'';
        PRINT CONCAT(DB_NAME(), N'': '', @@ROWCOUNT, N'' MSME DFO login(s) given their state and NEFT list.'');', N'@portal varchar(20)', @portal = @portal;
    EXEC sys.sp_addextendedproperty @name = N'V4_0059_MsmeDfoArea', @value = N'2026-11-07',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'Users';
END
GO
