-- LOCAL DEVELOPMENT ONLY: the ZED-X end-to-end check (backend/tools/zedx_e2e.py) on a throwaway set built with
--   database\setup.ps1 -DatabasePrefix ZEDV4CHK_ -WithKawachStandIn, then deploy\Invoke-ZedDatabaseScripts.ps1 with the
--   same prefix, -Apply -ApplyFixes 'main/14_zedx_levels'.
-- Never run this against the test server or production. Run with sqlcmd -d ZEDV4CHK_ZEDCS_V2_LIVE.
-- Test logins (throwaway values for the local check only): every user below has the password Zedx#Check2026.
SET NOCOUNT ON;
IF DB_NAME() NOT LIKE 'ZEDV4CHK[_]%' BEGIN RAISERROR('Only for a ZEDV4CHK_ database.', 16, 1); RETURN; END

DECLARE @Pwd varchar(50) = 'Zedx#Check2026';
DECLARE @Zed varchar(50) = 'ZEDMSME990001';

-- Users: the unit, the Admin, the MasterAdmin, an agency of Manufacturing units, its desktop assessor and two site assessors.
DELETE FROM dbo.Users WHERE UserId IN (@Zed, 'ADMINX', 'MADMINX', 'AGENCYX', 'DAX1', 'SAX1', 'SAX2');
INSERT dbo.Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate, DesktopVerification, SiteVerification,
                  FinancialVerification, AssessorType, SectorActivity) VALUES
 (@Zed,      @Pwd, 'ZEDX CHECK UNIT',      5, 1, 'unit@example.test',     '9999990001', 'seed',    GETDATE(), NULL, NULL, NULL, NULL, NULL),
 ('ADMINX',  @Pwd, 'Admin (check)',        1, 1, 'admin@example.test',    '9999990007', 'seed',    GETDATE(), 1, 1, 1, NULL, NULL),
 ('MADMINX', @Pwd, 'Master Admin (check)', 7, 1, 'madmin@example.test',   '9999990002', 'seed',    GETDATE(), 1, 1, 1, NULL, NULL),
 ('AGENCYX', @Pwd, 'Check Agency Pvt Ltd', 2, 1, 'agency@example.test',   '9999990003', 'MADMINX', GETDATE(), 1, 1, 0, NULL, 'Manufacturing'),
 ('DAX1',    @Pwd, 'Desktop Assessor X',   3, 1, 'da@example.test',       '9999990004', 'AGENCYX', GETDATE(), 1, 0, 0, 'Assessor', 'Both'),
 ('SAX1',    @Pwd, 'Lead Assessor X',      3, 1, 'sa1@example.test',      '9999990005', 'AGENCYX', GETDATE(), 0, 1, 0, 'Assessor', 'Manufacturing'),
 ('SAX2',    @Pwd, 'Co Assessor X',        3, 1, 'sa2@example.test',      '9999990006', 'AGENCYX', GETDATE(), 0, 1, 0, 'Assessor', NULL);

-- The unit: Micro, NIC 24 (Manufacturing).
DELETE FROM dbo.Msme WHERE ZedId = @Zed;
INSERT dbo.Msme (MsmeId, ZedId, StateId, StateName, EnterpriseName, EnterpriseTypee, MobileNo, EmailId, PAddress, PCity, PPin, PStateName,
                 Activity, TwoDigitActivity, PledgeEmailId, PlantIdNo, PUnitName, CreatedDate, RegistrationFrom, RegistrationType)
VALUES ('990001', @Zed, 9, 'UTTAR PRADESH', 'ZEDX CHECK ENTERPRISE', 'Micro', '9999990001', 'unit@example.test', 'Plot 4, Industrial Area',
        'KANPUR', '208001', 'UTTAR PRADESH', 'Manufacturing', '24 - Manufacture of basic metals', 'unit@example.test', 'P99',
        'ZEDX CHECK UNIT 1', GETDATE(), 'Portal', 'UDYAM');
DELETE FROM dbo.MsmeBasicInformation WHERE ZedId = @Zed;
INSERT dbo.MsmeBasicInformation (MsmeId, ZedId, UdyogAadharNo, OwnerName, EnterpriseName, Address, StateId, StateName, MobileNo, EmailId,
                                 EnterpriseType, EnterpriseTypee, IsEligibleForBenefits, Gender, SocialCategoryName)
VALUES ('990001', @Zed, 'UDYAM-UP-29-9900001', 'Check Owner', 'ZEDX CHECK ENTERPRISE', 'Plot 4, Industrial Area, Kanpur, Uttar Pradesh-208001',
        9, 'UTTAR PRADESH', '9999990001', 'unit@example.test', 'Micro', 'Micro', 0, 'Male', 'General');
IF NOT EXISTS (SELECT 1 FROM dbo.Sectors WHERE SectorCode = '24') INSERT dbo.Sectors (SectorCode, SectorName) VALUES ('24', 'Manufacture of basic metals');
UPDATE dbo.Sectors SET SectorType = 'Manufacturing' WHERE SectorCode = '24';
IF NOT EXISTS (SELECT 1 FROM dbo.UrlsMasterData) INSERT dbo.UrlsMasterData (UrlName, IsActive) VALUES ('http://localhost:5199', 1);
IF NOT EXISTS (SELECT 1 FROM dbo.DummyUsersForError WHERE UserId = 'ZEDMSME000112') INSERT dbo.DummyUsersForError (UserId, IsActive) VALUES ('ZEDMSME000112', 1);

-- ZED-X questionnaire (whole-number codes, as Admin → Questionnaire numbers them): section 1 for NIC 24 (the unit's), section 2 for NIC 62 only (removed from the unit's copy at payment).
DELETE FROM dbo.Evidences WHERE SectionType = 'ZEDX';
DELETE FROM dbo.Options WHERE SectionType = 'ZEDX';
DELETE FROM dbo.Requirements WHERE SectionType = 'ZEDX';
DELETE FROM dbo.Sections WHERE SectionType = 'ZEDX';
INSERT dbo.Sections (SectionCode, SectionName, OrderNo, SectionType, NicSectors, SurveMandatories) VALUES ('1', 'Export Readiness', 1, 'ZEDX', '24', 'Yes'), ('2', 'IT Services', 2, 'ZEDX', '62', 'Yes');
INSERT dbo.Requirements (SectionCode, SectionName, RequirementCode, RequirementName, OrderNo, SectionType) VALUES
 ('1', 'Export Readiness', '1', 'Export quality policy', 1, 'ZEDX'),
 ('1', 'Export Readiness', '2', 'Export documentation', 2, 'ZEDX'),
 ('2', 'IT Services', '1', 'Software process', 1, 'ZEDX');
INSERT dbo.Options (SectionCode, RequirementCode, OptionCode, OptionName, SectionType) VALUES
 ('1', '1', '1', 'Level 1', 'ZEDX'), ('1', '1', '2', 'Level 2', 'ZEDX'), ('1', '2', '1', 'Level 1', 'ZEDX'), ('2', '1', '1', 'Level 1', 'ZEDX');
INSERT dbo.Evidences (SectionCode, RequirementCode, EvidenceCode, EvidenceName, SectionType, EvidenceType, ValidationRequired, HelpText) VALUES
 ('1', '1', '1', 'Signed export quality policy', 'ZEDX', 1, 0, 'PDF of the signed policy'),
 ('1', '2', '1', 'Export register', 'ZEDX', 1, 0, NULL),
 ('2', '1', '1', 'Process manual', 'ZEDX', 1, 0, NULL);

-- A ZED-X fee row with nothing to pay (the zero-amount path), for the unit's size.
DELETE FROM dbo.AssessmentFee WHERE Certification = 'ZEDX' AND EnterpriseTypee = 'Micro';
INSERT dbo.AssessmentFee (EnterpriseTypee, Certification, AssessmentFee, Gst, Total, Coupon, AssessmentFeeAfterCoupon, GstAfterCoupon, TotalAfterCoupon,
                          SubsidyPer, SubsidyAmount, GstAfterSubsidy, ApplicantContributionAfterSubsidy, IsActive, SpecialCategory, SubsidyPercentage)
VALUES ('Micro', 'ZEDX', 75000, 13500, 88500, NULL, 75000, 13500, 88500, 75000, 0, 0, 0, 1, 0, 100);
PRINT 'ZED-X check data seeded for ' + @Zed;
