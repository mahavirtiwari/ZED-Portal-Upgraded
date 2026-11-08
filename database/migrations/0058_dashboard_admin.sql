-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (each portal has its own logins). Safe to re-run.
--
-- One Dashboard Admin (2026-11-07, at the Admin's request; Admin -> User Management): the three dashboard logins
-- (Super Admin RoleId 10, Citizen Feedback 11, QC 17) become one login type, "Dashboard Admin" (RoleId 10), whose screens the
-- Admin ticks per portal. A new column of the legacy table:
--   dbo.Users.ScreenAccess   the ticked screens, comma-separated "{portal}:{key}" (Zed.Core DashboardScreens), e.g.
--                            "main:dash-registered,main:reports,consultancy:history"; NULL = every screen (a Super Admin)
-- Once (marker: the extended property V4_0058_DashboardAdmins on dbo.Users), the Citizen Feedback and QC logins become
-- Dashboard Admins with the screens their type had on this portal (QC also keeps agency and assessor names hidden).
-- Super Admin logins keep NULL: every screen, as before.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50058, '0058 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
IF COL_LENGTH('dbo.Users', 'ScreenAccess') IS NULL ALTER TABLE dbo.Users ADD ScreenAccess varchar(2000) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
               AND major_id = OBJECT_ID(N'dbo.Users') AND name = N'V4_0058_DashboardAdmins')
BEGIN
    DECLARE @portal varchar(20) = CASE DB_NAME() WHEN N'ZED_CONSULTANT' THEN 'consultancy' WHEN N'ZED_SURVEILLANCE' THEN 'surveillance' ELSE 'main' END;
    -- The screens each old type had on this portal (its menu).
    DECLARE @feedback varchar(400) = CASE @portal
        WHEN 'main'         THEN 'dash-registered,dash-certified,registered-msme,financial-support,reports,history,documents'
        WHEN 'consultancy'  THEN 'dash-registered,dash-certified,history,documents'
        ELSE                     'dash-registered,dash-certified,registered-msme,financial-support,reports,documents' END;
    DECLARE @qc varchar(400) = CASE @portal
        WHEN 'main' THEN 'dash-registered,dash-certified,registered-msme,history,documents,hide-names'
        ELSE             'dash-registered,dash-certified,history,documents,hide-names' END;

    -- "{portal}:" before each key.
    UPDATE dbo.Users SET RoleId = 10, ScreenAccess = @portal + ':' + REPLACE(@feedback, ',', ',' + @portal + ':') WHERE RoleId = 11;
    PRINT CONCAT(DB_NAME(), N': ', @@ROWCOUNT, N' Citizen Feedback login(s) became Dashboard Admins.');
    UPDATE dbo.Users SET RoleId = 10, ScreenAccess = @portal + ':' + REPLACE(@qc, ',', ',' + @portal + ':') WHERE RoleId = 17;
    PRINT CONCAT(DB_NAME(), N': ', @@ROWCOUNT, N' QC login(s) became Dashboard Admins.');

    EXEC sys.sp_addextendedproperty @name = N'V4_0058_DashboardAdmins', @value = N'2026-11-07',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'Users';
END
GO
