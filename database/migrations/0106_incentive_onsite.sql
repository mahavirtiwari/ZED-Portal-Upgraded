-- Run on ZEDCS_V2_LIVE, after 0105. Additive and safe to re-run.
--
-- 2026-11-20 (the user, phase 2 of the incentive schemes): onsite verification in the assessor app. Desktop and onsite are
-- done by DIFFERENT agencies and assessors: onsite agencies are added by the Master Admin separately (their own page), each
-- with several states and the districts of each; the onsite allotment is by the unit's state and district. The onsite agency
-- allots an assessor without a date; the day the assessor verifies the unit in the app is saved as the date of verification
-- (several verifications a day). After the visit: recommend (the onsite agency's QC approves) or reject (apply again).
-- Columns of the existing tables (the user's rule):
--
-- dbo.Users.AgencyKind              varchar(20)    NULL = assessment agency (as today); 'SchemeOnsite' = onsite verification
--                                                  agency of the incentive schemes (RoleId 2; its assessors RoleId 3 as usual)
-- dbo.AgencyUserStates.Districts    varchar(4000)  the districts (LGD codes, comma-separated) of the row's state the agency
--                                                  serves; NULL = the whole state
-- dbo.FinancialAssistance (an incentive scheme's application, 0105):
--   OnsiteAgencyId, OnsiteAssessorId  varchar(50)  the onsite agency and its assessor
--   OnsiteAllotmentType               varchar(20)  'RoundRobin' / 'Manual'
--   OnsiteAllotmentDate               datetime
--   OnsiteRejectedAgencies            varchar(2000) onsite agencies that rejected it (comma-separated)
--   VisitStartedOn                    datetime      the date (and time) of verification: when the visit started in the app
--   VisitLatitude, VisitLongitude     varchar(50)   where it started
--   VisitSubmittedOn                  datetime      the onsite result was submitted
--   RepresentativeName                varchar(200)  the unit's representative at the visit
--   RepresentativeMobile              varchar(20)
--   OnsiteRemarks                     varchar(4000) the onsite assessor's remarks
--   OnsiteVerifiedClaim               decimal(14,2) the claim the onsite assessor verified
-- dbo.FinancialAssistancePhotos: onsite photos have Name "onsite/selfie", "onsite/site" or "onsite/{section}/{item}" with
--   their TimeStamp, Latitude and Longitude (the existing columns).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50106, '0106 runs on ZEDCS_V2_LIVE.', 1;
GO
IF COL_LENGTH('dbo.Users', 'AgencyKind') IS NULL ALTER TABLE dbo.Users ADD AgencyKind varchar(20) NULL;
IF COL_LENGTH('dbo.AgencyUserStates', 'Districts') IS NULL ALTER TABLE dbo.AgencyUserStates ADD Districts varchar(4000) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'OnsiteAgencyId') IS NULL ALTER TABLE dbo.FinancialAssistance ADD OnsiteAgencyId varchar(50) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'OnsiteAssessorId') IS NULL ALTER TABLE dbo.FinancialAssistance ADD OnsiteAssessorId varchar(50) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'OnsiteAllotmentType') IS NULL ALTER TABLE dbo.FinancialAssistance ADD OnsiteAllotmentType varchar(20) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'OnsiteAllotmentDate') IS NULL ALTER TABLE dbo.FinancialAssistance ADD OnsiteAllotmentDate datetime NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'OnsiteRejectedAgencies') IS NULL ALTER TABLE dbo.FinancialAssistance ADD OnsiteRejectedAgencies varchar(2000) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'VisitStartedOn') IS NULL ALTER TABLE dbo.FinancialAssistance ADD VisitStartedOn datetime NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'VisitLatitude') IS NULL ALTER TABLE dbo.FinancialAssistance ADD VisitLatitude varchar(50) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'VisitLongitude') IS NULL ALTER TABLE dbo.FinancialAssistance ADD VisitLongitude varchar(50) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'VisitSubmittedOn') IS NULL ALTER TABLE dbo.FinancialAssistance ADD VisitSubmittedOn datetime NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'RepresentativeName') IS NULL ALTER TABLE dbo.FinancialAssistance ADD RepresentativeName varchar(200) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'RepresentativeMobile') IS NULL ALTER TABLE dbo.FinancialAssistance ADD RepresentativeMobile varchar(20) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'OnsiteRemarks') IS NULL ALTER TABLE dbo.FinancialAssistance ADD OnsiteRemarks varchar(4000) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'OnsiteVerifiedClaim') IS NULL ALTER TABLE dbo.FinancialAssistance ADD OnsiteVerifiedClaim decimal(14,2) NULL;
-- When the portal mailed the assessor app's onsite decision (the mobile API has no scheme mail templates; the scheme sweep mails).
IF COL_LENGTH('dbo.FinancialAssistance', 'OnsiteNotifiedOn') IS NULL ALTER TABLE dbo.FinancialAssistance ADD OnsiteNotifiedOn datetime NULL;
GO

-- 2026-11-20 (the user): onsite agencies and the district allotment apply only to the incentive (FA-type) verification, never
-- to the normal assessments. Every normal allotment (Bronze / Silver / Gold / ZED-X round robin, OrgPartner match, manual
-- allot list, legacy FA allotment) picks agencies by these flags or OrgPartnerId, so an onsite agency always has them cleared.
-- Re-run on each deploy (idempotent).
UPDATE dbo.Users SET DesktopVerification = 0, SiteVerification = 0, FinancialVerification = 0, AllowBronzeAssessments = 0, OrgPartnerId = NULL
WHERE AgencyKind = 'SchemeOnsite'
  AND (ISNULL(DesktopVerification, 0) <> 0 OR ISNULL(SiteVerification, 0) <> 0 OR ISNULL(FinancialVerification, 0) <> 0
       OR ISNULL(AllowBronzeAssessments, 0) <> 0 OR OrgPartnerId IS NOT NULL);
GO
-- The surveillance copy SP_INSERT_USER makes of an onsite agency stays inactive (onsite agencies never work in surveillance).
IF OBJECT_ID('ZED_SURVEILLANCE.dbo.Users') IS NOT NULL
    UPDATE S SET IsActive = 0 FROM ZED_SURVEILLANCE.dbo.Users AS S
    WHERE S.RoleId = 2 AND ISNULL(S.IsActive, 0) <> 0 AND S.UserId IN (SELECT UserId FROM dbo.Users WHERE AgencyKind = 'SchemeOnsite');
GO
-- An onsite agency's assessors ticked for onsite visits sign in to the assessor app (SP_APP_SA_CHECK_LOGIN needs SiteVerification);
-- they inherit the agency's cleared flags at creation. Normal assessments never reach an onsite agency, so they never get those.
UPDATE A SET SiteVerification = 1 FROM dbo.Users AS A
WHERE A.RoleId = 3 AND ISNULL(A.SiteVerification, 0) = 0 AND A.SchemeVerification LIKE '%:O%'
  AND A.CreatedBy IN (SELECT UserId FROM dbo.Users WHERE RoleId = 2 AND AgencyKind = 'SchemeOnsite');
GO
