-- LOCAL DEVELOPMENT ONLY: data for the screenshot walkthrough of every certification flow (4 levels x 5 flows) on a
--   throwaway set built with database\setup.ps1 -DatabasePrefix ZEDV4CHK_ -WithKawachStandIn, then
--   deploy\Invoke-ZedDatabaseScripts.ps1 with the same prefix, -Apply -ApplyFixes 'main/14_zedx_levels'.
-- Never run this against the test server or production. Run with sqlcmd -d ZEDV4CHK_ZEDCS_V2_LIVE.
-- Test logins (throwaway values for the local walkthrough only): every user below has the password Zedx#Check2026,
--   the same as database\seed\dev-zedx-e2e.sql. All names, numbers and addresses are made up.
--   Staff: ADMINX (Admin), MADMINX (Master Admin), AGENCYX (agency), DAX1 (desktop assessor), SAX1 (lead assessor), SAX2 (co-assessor).
--   Units: ZEDMSME99LF01, L = 1 Bronze, 2 Silver, 3 Gold, 4 ZED-X; F = 1 Desktop only, 2 Remote only, 3 Onsite only,
--          4 Desktop + Remote, 5 Desktop + Onsite (e.g. ZEDMSME991101 = Bronze, Desktop only).
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() NOT LIKE 'ZEDV4CHK[_]%' BEGIN RAISERROR('Only for a ZEDV4CHK_ database.', 16, 1); RETURN; END

DECLARE @Pwd varchar(50) = 'Zedx#Check2026';
BEGIN TRANSACTION;

-- Masters the screens read.
IF NOT EXISTS (SELECT 1 FROM dbo.States WHERE Id = 9)
BEGIN
    SET IDENTITY_INSERT dbo.States ON;
    INSERT dbo.States (Id, StateCode, StateName, IsActive) VALUES (9, '9', 'UTTAR PRADESH', 1);
    SET IDENTITY_INSERT dbo.States OFF;
END
IF NOT EXISTS (SELECT 1 FROM dbo.Districts WHERE DistrictCode = '164')
    INSERT dbo.Districts (StateCode, StateName, DistrictCode, DistrictName, IsActive, IsAspirationalDt) VALUES ('9', 'UTTAR PRADESH', '164', 'KANPUR NAGAR', 1, 0);
IF NOT EXISTS (SELECT 1 FROM dbo.Roles)
    INSERT dbo.Roles (RoleId, Role, IsActive) VALUES (1, 'Admin', 1), (2, 'Agency', 1), (3, 'Assessor', 1), (4, 'QC', 1), (5, 'MSME', 1),
        (6, 'Ministry', 1), (7, 'MasterAdmin', 1);
IF NOT EXISTS (SELECT 1 FROM dbo.CertificationStatuses)
    INSERT dbo.CertificationStatuses (SNo, Status, Descrip) VALUES
     (1, '0', 'Payment done'), (2, '1', 'Basic information and documents'), (3, '2', 'Submitted, desktop allotment'),
     (4, '3', 'Desktop assessment'), (5, '4', 'Desktop NC'), (6, '5', 'Desktop review'), (7, '6', 'Desktop done / waiting for the visit'),
     (8, '7', 'Visit allotted'), (9, '8', 'Visit accepted'), (10, '9', 'Visit in progress'), (11, '13', 'Visit done'), (12, '14', 'Site NC'),
     (13, '15', 'Agency review'), (14, '16', 'Certified after the visit'), (15, '17', 'Rejected');
IF NOT EXISTS (SELECT 1 FROM dbo.Sectors WHERE SectorCode = '24') INSERT dbo.Sectors (SectorCode, SectorName) VALUES ('24', 'Manufacture of basic metals');
UPDATE dbo.Sectors SET SectorType = 'Manufacturing' WHERE SectorCode = '24';
IF NOT EXISTS (SELECT 1 FROM dbo.UrlsMasterData) INSERT dbo.UrlsMasterData (UrlName, IsActive) VALUES ('http://localhost:5106', 1);
IF NOT EXISTS (SELECT 1 FROM dbo.DummyUsersForError WHERE UserId = 'ZEDMSME000112') INSERT dbo.DummyUsersForError (UserId, IsActive) VALUES ('ZEDMSME000112', 1);

-- Staff.
DELETE FROM dbo.Users WHERE UserId IN ('ADMINX', 'MADMINX', 'AGENCYX', 'DAX1', 'SAX1', 'SAX2');
INSERT dbo.Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate, DesktopVerification, SiteVerification,
                  FinancialVerification, AssessorType, SectorActivity, StateCode, AllowBronzeAssessments, AllowSilverAssessments, AllowGoldAssessments,
                  AllowZedxAssessments, AssessmentModes) VALUES
 ('ADMINX',  @Pwd, 'Admin (walkthrough)',       1, 1, 'admin@example.test',  '9999990007', 'seed',    GETDATE(), 1, 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
 ('MADMINX', @Pwd, 'Master Admin (walkthrough)', 7, 1, 'madmin@example.test', '9999990002', 'seed',    GETDATE(), 1, 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
 ('AGENCYX', @Pwd, 'Sample Assessment Agency Pvt Ltd', 2, 1, 'agency@example.test', '9999990003', 'MADMINX', GETDATE(), 1, 1, 0, NULL, 'Manufacturing', '9', 1, 1, 1, 1, NULL),
 ('DAX1',    @Pwd, 'Desktop Assessor One',      3, 1, 'da@example.test',     '9999990004', 'AGENCYX', GETDATE(), 1, 0, 0, 'Assessor', 'Manufacturing', NULL, NULL, NULL, NULL, NULL,
              'Bronze=D;Silver=D;Gold=D;ZEDX=D'),
 ('SAX1',    @Pwd, 'Lead Assessor One',         3, 1, 'sa1@example.test',    '9999990005', 'AGENCYX', GETDATE(), 0, 1, 0, 'Assessor', 'Manufacturing', NULL, NULL, NULL, NULL, NULL,
              'Bronze=R,O;Silver=R,O;Gold=R,O;ZEDX=R,O'),
 ('SAX2',    @Pwd, 'Co Assessor One',           3, 1, 'sa2@example.test',    '9999990006', 'AGENCYX', GETDATE(), 0, 1, 0, 'Assessor', 'Manufacturing', NULL, NULL, NULL, NULL, NULL,
              'Bronze=R,O;Silver=R,O;Gold=R,O;ZEDX=R,O');

-- Questionnaire of each level (made-up texts): 2 parameters, 3 requirements, 4 documents; the "training certificate" needs validation.
DELETE FROM dbo.Evidences WHERE SectionType IN ('Bronze', 'Silver', 'Gold', 'ZEDX');
DELETE FROM dbo.SubOptions WHERE SectionType IN ('Bronze', 'Silver', 'Gold', 'ZEDX');
DELETE FROM dbo.Options WHERE SectionType IN ('Bronze', 'Silver', 'Gold', 'ZEDX');
DELETE FROM dbo.Requirements WHERE SectionType IN ('Bronze', 'Silver', 'Gold', 'ZEDX');
DELETE FROM dbo.Sections WHERE SectionType IN ('Bronze', 'Silver', 'Gold', 'ZEDX');
DECLARE @levels TABLE (Code varchar(10), Nic varchar(10));
INSERT @levels VALUES ('Bronze', NULL), ('Silver', NULL), ('Gold', NULL), ('ZEDX', '24');
INSERT dbo.Sections (SectionCode, SectionName, OrderNo, iButton, SectionType, NicSectors, SurveMandatories)
SELECT s.Code, s.Name, s.Ord, s.Help, l.Code, l.Nic, 'Yes' FROM @levels l
CROSS JOIN (VALUES ('1', 'Quality Management', 1, 'How the unit plans and checks quality'),
                   ('2', 'Workplace Safety', 2, 'How the unit keeps people safe')) s (Code, Name, Ord, Help);
INSERT dbo.Requirements (SectionCode, SectionName, RequirementCode, RequirementName, OrderNo, SectionType, Purpose)
SELECT r.S, r.SName, r.Code, r.Name, r.Ord, l.Code, r.Purpose FROM @levels l
CROSS JOIN (VALUES ('1', 'Quality Management', '1', 'Documented quality policy', 1, 'A written policy known to the staff'),
                   ('1', 'Quality Management', '2', 'Inspection records', 2, 'Records of incoming and final inspection'),
                   ('2', 'Workplace Safety', '1', 'Trained safety staff', 1, 'Staff trained in first aid and fire safety')) r (S, SName, Code, Name, Ord, Purpose);
INSERT dbo.Options (SectionCode, RequirementCode, OptionCode, OptionName, SectionType)
SELECT o.S, o.R, o.Code, o.Name, l.Code FROM @levels l
CROSS JOIN (VALUES ('1', '1', '1', 'Policy written and displayed'), ('1', '2', '1', 'Inspection records kept for every batch'),
                   ('2', '1', '1', 'Safety staff trained every year')) o (S, R, Code, Name);
INSERT dbo.Evidences (SectionCode, RequirementCode, EvidenceCode, EvidenceName, SectionType, EvidenceType, ValidationRequired, HelpText)
SELECT e.S, e.R, e.Code, e.Name, l.Code, 1, e.Val, e.Help FROM @levels l
CROSS JOIN (VALUES ('1', '1', '1', 'Photo of the quality policy', 0, 'Photo of the signed policy on display'),
                   ('1', '2', '1', 'Inspection register', 0, 'A page of the inspection register'),
                   ('2', '1', '1', 'Training certificate', 1, 'Certificate from an accredited trainer'),
                   ('2', '1', '2', 'Photo of the safety board', 0, 'Photo of the safety notice board')) e (S, R, Code, Name, Val, Help);

-- Fees: nothing to pay after the subsidy (the zero-amount path), for Micro units.
DELETE FROM dbo.AssessmentFee WHERE EnterpriseTypee = 'Micro' AND Certification IN ('Bronze', 'Silver', 'Gold', 'ZEDX');
INSERT dbo.AssessmentFee (EnterpriseTypee, Certification, AssessmentFee, Gst, Total, Coupon, AssessmentFeeAfterCoupon, GstAfterCoupon, TotalAfterCoupon,
                          SubsidyPer, SubsidyAmount, GstAfterSubsidy, ApplicantContributionAfterSubsidy, IsActive, SpecialCategory, SubsidyPercentage)
SELECT 'Micro', f.C, f.Fee, f.Fee * 0.18, f.Fee * 1.18, NULL, f.Fee, f.Fee * 0.18, f.Fee * 1.18, f.Fee, 0, 0, 0, 1, 0, 100
FROM (VALUES ('Bronze', 10000), ('Silver', 40000), ('Gold', 90000), ('ZEDX', 75000)) f (C, Fee);

-- The 20 units: registered (Udyam), pledge taken, no application yet.
DECLARE @l int = 1, @f int;
WHILE @l <= 4
BEGIN
    SET @f = 1;
    WHILE @f <= 5
    BEGIN
        DECLARE @Zed varchar(50) = 'ZEDMSME99' + CAST(@l AS varchar(1)) + CAST(@f AS varchar(1)) + '01';
        DECLARE @MsmeId varchar(10) = '99' + CAST(@l AS varchar(1)) + CAST(@f AS varchar(1)) + '01';
        DECLARE @Lvl varchar(20) = CHOOSE(@l, 'Bronze', 'Silver', 'Gold', 'ZED-X');
        DECLARE @Flow varchar(30) = CHOOSE(@f, 'Desktop', 'Remote', 'Onsite', 'Desktop Remote', 'Desktop Onsite');
        DECLARE @Name varchar(100) = 'Sample ' + @Lvl + ' ' + @Flow + ' Industries';
        DECLARE @Mob varchar(10) = '98' + RIGHT('00000000' + @MsmeId, 8);
        DECLARE @Mail varchar(100) = 'unit' + @MsmeId + '@example.test';
        DECLARE @t sysname, @sql nvarchar(max);
        DECLARE c CURSOR LOCAL FAST_FORWARD FOR
            SELECT DISTINCT t.name FROM sys.columns col JOIN sys.tables t ON t.object_id = col.object_id WHERE col.name = 'ZedId' AND t.is_ms_shipped = 0;
        OPEN c; FETCH NEXT FROM c INTO @t;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@t) + N' WHERE ZedId = @z';
            EXEC sp_executesql @sql, N'@z varchar(50)', @z = @Zed;
            FETCH NEXT FROM c INTO @t;
        END
        CLOSE c; DEALLOCATE c;
        DELETE FROM dbo.Users WHERE UserId = @Zed;
        INSERT dbo.Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate)
        VALUES (@Zed, @Pwd, @Name, 5, 1, @Mail, @Mob, 'seed', GETDATE());
        INSERT dbo.Msme (MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
                         EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad, PArea, PCity, PAddress, PPin,
                         PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity, FourDigitActivity, FiveDigitActivity,
                         ActivityDetailId, PledgeEmailId, PledgeCertificateNo, RegistrationType, IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName,
                         PUnitIdNo, CreatedDate, RegistrationFrom, FinancialAssistanceStatus)
        VALUES (@MsmeId, @Zed, 9, 'UTTAR PRADESH', 164, 'KANPUR NAGAR', 'Sample Owner', @Name, 2, 'Private Limited Company', 'Micro', 'Micro', @Mob, @Mail,
                'APP' + @MsmeId, 'UDYAM-UP-29-00' + @MsmeId, 'Plot ' + RIGHT(@MsmeId, 3), 'Sample Industrial Estate', 'Ring Road', 'Panki', 'KANPUR',
                'Plot ' + RIGHT(@MsmeId, 3) + ', Sample Industrial Estate, Ring Road, Panki, Kanpur', '208020', 9, 'UTTAR PRADESH', 164, 'KANPUR NAGAR', '1',
                'Manufacturing', '24 - Manufacture of basic metals', '2431', '24311', 1, @Mail, @Zed, 'UDYAM', '01/04/2018', 'Yes',
                'P' + CAST(@l AS varchar(1)) + CAST(@f AS varchar(1)), 'Sample Unit ' + CAST(@l AS varchar(1)) + CAST(@f AS varchar(1)), '1', GETDATE(), 'Android', 0);
        INSERT dbo.MsmeBasicInformation (MsmeId, ApplicationId, UdyogAadharNo, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName, SocialCategory,
                         SocialCategoryName, Gender, PH, PanNo, Address, StateId, StateName, DistrictId, DistrictName, LgDistrictCode, Pincode, MobileNo, EmailId,
                         MajorActivity, MajorActivityName, EnterpriseType, EnterpriseTypee, CommmenceDate, TotalEmp, InvestmentCost, DicName, AppliedDate, ZedId,
                         IsEligibleForBenefits)
        VALUES (@MsmeId, 'APP' + @MsmeId, 'UDYAM-UP-29-00' + @MsmeId, 'Sample Owner', @Name, 2, 'Private Limited Company', 1, 'General', 'Male', 'No',
                'AAAPZ' + RIGHT(@MsmeId, 4) + 'Z', 'Plot ' + RIGHT(@MsmeId, 3) + ', Sample Industrial Estate, Ring Road, Panki, Kanpur, Uttar Pradesh-208020',
                9, 'UTTAR PRADESH', 164, 'KANPUR NAGAR', 164, '208020', @Mob, @Mail, 1, 'Manufacturing', 'Micro', 'Micro', '01/04/2018', 18, 4500000,
                'KANPUR NAGAR', '01/04/2019', @Zed, 0);
        SET @f += 1;
    END
    SET @l += 1;
END

COMMIT;
SELECT ZedId, EnterpriseName FROM dbo.Msme WHERE ZedId LIKE 'ZEDMSME99[1-4][1-5]01' ORDER BY ZedId;
