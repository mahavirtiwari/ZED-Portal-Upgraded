-- Run on all three (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE), after 0087. Data only, safe to re-run (re-run on each deploy).
--
-- 2026-11-26 (zedv3: a consultancy Operation Admin added the consultant organisation ZEDCO0208 and did not see it; its dashboard
-- and Monitoring showed no unit): an Operation Admin saved with every agency ticked kept that day's agencies as a fixed list
-- (dbo.V4SubUsers.ScopeAgencies), so an agency added later, and a unit with no agency yet, fell outside its scope. Since today the
-- form saves "every agency ticked" as no limit (SubUsersController), and an Operation Admin's new agency joins its own list
-- (StaffAgenciesController). This turns the lists saved before into no limit when they held every active agency that existed
-- when the list was saved (V4SubUsers.UpdatedAt / CreatedAt, UTC; Users.CreatedDate is India time):
--
--   dbo.V4SubUsers.ScopeAgencies  -> NULL  (every agency), the states unchanged.
--
-- Main's incentive verification agencies (Users.AgencyKind 'SchemeDesktop' / 'SchemeOnsite', 0106) are not assessment agencies
-- and are not looked at. A list that left out an agency on purpose stays as it is.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF OBJECT_ID(N'dbo.V4SubUsers', N'U') IS NULL OR COL_LENGTH('dbo.V4SubUsers', 'ScopeAgencies') IS NULL
    THROW 50115, '0115 needs 0012 (dbo.V4SubUsers) and 0087 (dbo.V4SubUsers.ScopeAgencies).', 1;
GO

DECLARE @kind nvarchar(200) = CASE WHEN COL_LENGTH('dbo.Users', 'AgencyKind') IS NOT NULL
    THEN N' AND ISNULL(A.AgencyKind, '''') NOT IN (''SchemeDesktop'', ''SchemeOnsite'')' ELSE N'' END;
DECLARE @created nvarchar(200) = CASE WHEN COL_LENGTH('dbo.Users', 'CreatedDate') IS NOT NULL
    THEN N' AND (A.CreatedDate IS NULL OR A.CreatedDate <= DATEADD(MINUTE, 330, ISNULL(S.UpdatedAt, S.CreatedAt)))' ELSE N'' END;

DECLARE @sql nvarchar(max) = N'
UPDATE S SET S.ScopeAgencies = NULL, S.UpdatedBy = ''migration-0115'', S.UpdatedAt = SYSUTCDATETIME()
FROM dbo.V4SubUsers S
WHERE S.OwnerRoleId = 7
  AND NULLIF(LTRIM(RTRIM(S.ScopeAgencies)), '''') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM dbo.Users A
      WHERE A.RoleId = 2 AND A.IsActive = 1 AND A.UserId IS NOT NULL' + @kind + @created + N'
        AND NOT EXISTS (SELECT 1 FROM STRING_SPLIT(S.ScopeAgencies, '','') P WHERE LTRIM(RTRIM(P.value)) = LTRIM(RTRIM(A.UserId))));
PRINT CONCAT(''0115: '', @@ROWCOUNT, '' Operation Admin(s) now see every agency.'');';
EXEC sys.sp_executesql @sql;

IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
               AND major_id = OBJECT_ID(N'dbo.V4SubUsers') AND name = N'V4_0115_EveryAgency')
    EXEC sys.sp_addextendedproperty @name = N'V4_0115_EveryAgency',
        @value = N'2026-11-26: Operation Admins saved with every agency ticked see every agency (ScopeAgencies NULL).',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'V4SubUsers';
GO
