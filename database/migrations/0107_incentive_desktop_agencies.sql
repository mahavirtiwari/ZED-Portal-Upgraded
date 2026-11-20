-- Run on ZEDCS_V2_LIVE, after 0106. Additive and safe to re-run (re-run on each deploy).
--
-- 2026-11-20 (the product owner): "Desktop and onsite will be done by different assessment agencies and assessors. Agency will be
-- added by master admin in separate manner. Here during the addition, Master admin select the multiple states and their respective
-- districts also. The allocation logic will be based on state and district." This applies to BOTH stages of the incentive scheme
-- verification: the normal assessment agencies are no longer used for it.
--
-- dbo.Users.AgencyKind (0106)       NULL = assessment agency (as today); 'SchemeOnsite' = onsite verification agency;
--                                   'SchemeDesktop' = desktop verification agency of the incentive schemes (new value, no new column).
-- A desktop verification agency has its states and districts in dbo.AgencyUserStates (Districts, 0106) and its schemes in
-- dbo.Users.SchemeVerification ("CODE:D"), as an onsite agency ("CODE:O"). The Master Admin adds both on "Incentive Verification
-- Agencies"; an agency is one kind only.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50107, '0107 runs on ZEDCS_V2_LIVE.', 1;
GO
IF COL_LENGTH('dbo.Users', 'AgencyKind') IS NULL OR COL_LENGTH('dbo.AgencyUserStates', 'Districts') IS NULL
    THROW 50107, '0107 needs 0106 (dbo.Users.AgencyKind, dbo.AgencyUserStates.Districts).', 1;
GO

-- As 0106 does for the onsite agencies: every normal allotment (Bronze / Silver / Gold / ZED-X round robin, OrgPartner match,
-- manual allot list, legacy FA allotment) picks agencies by these flags or OrgPartnerId, so a desktop verification agency always
-- has them cleared and never takes a normal assessment.
UPDATE dbo.Users SET DesktopVerification = 0, SiteVerification = 0, FinancialVerification = 0, AllowBronzeAssessments = 0, OrgPartnerId = NULL
WHERE AgencyKind = 'SchemeDesktop'
  AND (ISNULL(DesktopVerification, 0) <> 0 OR ISNULL(SiteVerification, 0) <> 0 OR ISNULL(FinancialVerification, 0) <> 0
       OR ISNULL(AllowBronzeAssessments, 0) <> 0 OR OrgPartnerId IS NOT NULL);
GO
-- The surveillance copy SP_INSERT_USER makes of a desktop verification agency stays inactive (incentive verification only).
IF OBJECT_ID('ZED_SURVEILLANCE.dbo.Users') IS NOT NULL
    UPDATE S SET IsActive = 0 FROM ZED_SURVEILLANCE.dbo.Users AS S
    WHERE S.RoleId = 2 AND ISNULL(S.IsActive, 0) <> 0 AND S.UserId IN (SELECT UserId FROM dbo.Users WHERE AgencyKind = 'SchemeDesktop');
GO
-- A desktop verification agency's assessors verify on the web only: they never sign in to the assessor app (SP_APP_SA_CHECK_LOGIN
-- needs SiteVerification), so the flag stays cleared for them.
UPDATE A SET SiteVerification = 0 FROM dbo.Users AS A
WHERE A.RoleId = 3 AND ISNULL(A.SiteVerification, 0) <> 0
  AND A.CreatedBy IN (SELECT UserId FROM dbo.Users WHERE RoleId = 2 AND AgencyKind = 'SchemeDesktop');
GO
-- Marker for the deploy scripts (Invoke-ZedDatabaseScripts / Deploy-Zed verify).
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
               AND major_id = OBJECT_ID(N'dbo.Users') AND name = N'V4_0107_SchemeDesktop')
    EXEC sys.sp_addextendedproperty @name = N'V4_0107_SchemeDesktop',
        @value = N'2026-11-20: AgencyKind ''SchemeDesktop'' = desktop verification agency of the incentive schemes',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'Users';
GO
