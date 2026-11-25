-- Run on ZEDCS_V2_LIVE, after 0012 and 0058. Data only, safe to re-run (re-run on each deploy).
--
-- 2026-11-25 (the product owner: "shift the old from certification/handholding master admin to incentive master admin"): the
-- incentive screens (Financial Assistance, Upload API Incentives, Scheme Applications, Incentive Verification Agencies) are the
-- Incentives Master Admin's only (dbo.Users.RoleId 7 with ScreenAccess 'incentives', 0058). The main Master Admin no longer has
-- them, and neither do its Operation Admins: the API refuses them (Users/IncentivesAdmins) and drops their keys from what an
-- Operation Admin is given (SubUsers/SubUserPermissions). This removes the keys from the stored ticks too, so the table says what
-- the screens do:
--
--   dbo.V4SubUsers.Permissions  of an Operation Admin whose owner is a Master Admin (RoleId 7) that is not an Incentives Master
--                               Admin: 'financial-assistance', 'incentive-upload', 'scheme-applications' and
--                               'scheme-onsite-agencies' are taken out of the comma list; the other ticks stay as they are.
--
-- An Incentives Master Admin's Operation Admins keep theirs. The agencies' sub-users ('financial-assistance' of a Financial
-- Assistance verification agency, OwnerRoleId 2) are not touched.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50114, '0114 runs on ZEDCS_V2_LIVE.', 1;
GO
IF OBJECT_ID(N'dbo.V4SubUsers', N'U') IS NULL OR COL_LENGTH('dbo.Users', 'ScreenAccess') IS NULL
    THROW 50114, '0114 needs 0012 (dbo.V4SubUsers) and 0058 (dbo.Users.ScreenAccess).', 1;
GO

BEGIN TRANSACTION;

;WITH Main AS
(
    -- The Operation Admins of the main Master Admins (not of an Incentives Master Admin).
    SELECT S.UserId, S.Permissions
    FROM dbo.V4SubUsers S
    WHERE S.OwnerRoleId = 7
      AND NOT EXISTS (SELECT 1 FROM dbo.Users U WHERE U.UserId = S.OwnerUserId AND U.RoleId = 7
                      AND LTRIM(RTRIM(ISNULL(U.ScreenAccess, ''))) = 'incentives')
      AND EXISTS (SELECT 1 FROM STRING_SPLIT(S.Permissions, ',') P
                  WHERE LTRIM(RTRIM(P.value)) IN ('financial-assistance', 'incentive-upload', 'scheme-applications', 'scheme-onsite-agencies'))
),
Kept AS
(
    SELECT M.UserId,
           ISNULL((SELECT STRING_AGG(LTRIM(RTRIM(P.value)), ',')
                   FROM STRING_SPLIT(M.Permissions, ',') P
                   WHERE LTRIM(RTRIM(P.value)) <> ''
                     AND LTRIM(RTRIM(P.value)) NOT IN ('financial-assistance', 'incentive-upload', 'scheme-applications', 'scheme-onsite-agencies')), '') AS Permissions
    FROM Main M
)
UPDATE S SET S.Permissions = K.Permissions, S.UpdatedBy = 'migration-0114', S.UpdatedAt = SYSUTCDATETIME()
FROM dbo.V4SubUsers S
JOIN Kept K ON K.UserId = S.UserId;

PRINT CONCAT('0114: incentive screens taken from ', @@ROWCOUNT, ' Operation Admin(s) of the main Master Admin.');

IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
               AND major_id = OBJECT_ID(N'dbo.V4SubUsers') AND name = N'V4_0114_IncentiveScreens')
    EXEC sys.sp_addextendedproperty @name = N'V4_0114_IncentiveScreens',
        @value = N'2026-11-25: the incentive screens are the Incentives Master Admin''s only (main Master Admin Operation Admins lose them).',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'V4SubUsers';

COMMIT TRANSACTION;
GO
