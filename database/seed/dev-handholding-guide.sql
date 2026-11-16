-- LOCAL DEVELOPMENT ONLY: data for the screenshot walkthrough of Handholding Support (consultancy), Silver and Gold, on a
--   throwaway set built with database\setup.ps1 -DatabasePrefix ZEDV4CHK_ -WithKawachStandIn, then
--   deploy\Invoke-ZedDatabaseScripts.ps1 with the same prefix, then database\seed\dev-walkthrough-guide.sql (staff ADMINX,
--   masters, the Silver/Gold questionnaire the milestones copy). Never run this against the test server or production.
--   Run with: sqlcmd -S <server> -E -d ZEDV4CHK_ZEDCS_V2_LIVE -i dev-handholding-guide.sql
-- Test logins (throwaway values for the local walkthrough only): every user below has the password Zedx#Check2026,
--   the same as database\seed\dev-zedx-e2e.sql. All names, numbers and addresses are made up.
--   Main portal: ADMINX (Admin, opens the Handholding portal with the portal switch); the units sign in with their ZED ID.
--   Handholding (consultancy) portal: HMADMINX (Master Admin), HCOX (consultancy organisation), HCL1 (lead consultant),
--   HCC1 (co-consultant), HTE1 (technical expert). The consultant app signs in with HCL1 / HCC1.
--   Units (Andhra Pradesh, where the state pays what is left after the central subsidy, so nothing is payable):
--     ZEDMSME998101  Bronze certified -> Silver Handholding, milestones 1-3 (milestone 1 is sent back once)
--     ZEDMSME998102  Bronze certified -> Silver Handholding, allotment refused once, milestone 1 rejected
--     ZEDMSME998201  Silver certified -> Gold Handholding, milestones 1-3
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> 'ZEDV4CHK_ZEDCS_V2_LIVE' BEGIN RAISERROR('Only for ZEDV4CHK_ZEDCS_V2_LIVE.', 16, 1); RETURN; END
IF DB_ID('ZEDV4CHK_ZED_CONSULTANT') IS NULL BEGIN RAISERROR('ZEDV4CHK_ZED_CONSULTANT is missing.', 16, 1); RETURN; END

DECLARE @Pwd varchar(50) = 'Zedx#Check2026';
BEGIN TRANSACTION;

-- Masters (main): Andhra Pradesh and one made-up district entry.
IF NOT EXISTS (SELECT 1 FROM dbo.States WHERE StateCode = '28')
BEGIN
    SET IDENTITY_INSERT dbo.States ON;
    INSERT dbo.States (Id, StateCode, StateName, IsActive) VALUES (28, '28', 'ANDHRA PRADESH', 1);
    SET IDENTITY_INSERT dbo.States OFF;
END
IF NOT EXISTS (SELECT 1 FROM dbo.Districts WHERE DistrictCode = '745')
    INSERT dbo.Districts (StateCode, StateName, DistrictCode, DistrictName, IsActive, IsAspirationalDt) VALUES ('28', 'ANDHRA PRADESH', '745', 'GUNTUR', 1, 0);

-- Masters (consultancy).
IF NOT EXISTS (SELECT 1 FROM ZEDV4CHK_ZED_CONSULTANT.dbo.Roles)
    INSERT ZEDV4CHK_ZED_CONSULTANT.dbo.Roles (RoleId, Role, IsActive) VALUES (1, 'Admin', 1), (2, 'Consultancy Organisation', 1), (3, 'Consultant', 1),
        (4, 'QC', 1), (5, 'MSME', 1), (6, 'Ministry', 1), (7, 'MasterAdmin', 1), (33, 'Technical Expert', 1);
IF NOT EXISTS (SELECT 1 FROM ZEDV4CHK_ZED_CONSULTANT.dbo.States WHERE StateCode = '28')
    INSERT ZEDV4CHK_ZED_CONSULTANT.dbo.States (StateCode, StateName, IsActive) VALUES ('28', 'ANDHRA PRADESH', 1);
IF NOT EXISTS (SELECT 1 FROM ZEDV4CHK_ZED_CONSULTANT.dbo.Districts WHERE DistrictCode = '745')
    INSERT ZEDV4CHK_ZED_CONSULTANT.dbo.Districts (StateCode, StateName, DistrictCode, DistrictName, IsActive, IsAspirationalDt)
    VALUES ('28', 'ANDHRA PRADESH', '745', 'GUNTUR', 1, 0);
IF NOT EXISTS (SELECT 1 FROM ZEDV4CHK_ZED_CONSULTANT.dbo.UrlsMasterData)
    INSERT ZEDV4CHK_ZED_CONSULTANT.dbo.UrlsMasterData (UrlName, IsActive) VALUES ('http://localhost:5106', 1);
IF NOT EXISTS (SELECT 1 FROM ZEDV4CHK_ZED_CONSULTANT.dbo.DummyUsersForError WHERE UserId = 'ZEDMSME000112')
    INSERT ZEDV4CHK_ZED_CONSULTANT.dbo.DummyUsersForError (UserId, IsActive) VALUES ('ZEDMSME000112', 1);

-- Staff of the Handholding portal.
DELETE FROM ZEDV4CHK_ZED_CONSULTANT.dbo.Users WHERE UserId IN ('HMADMINX', 'HCOX', 'HCL1', 'HCC1', 'HTE1');
INSERT ZEDV4CHK_ZED_CONSULTANT.dbo.Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate, StateCode,
                                          DesktopVerification, SiteVerification, FinancialVerification, AssessorType, SectorActivity) VALUES
 ('HMADMINX', @Pwd, 'Master Admin (handholding walkthrough)', 7, 1, 'hmadmin@example.test', '9999991001', 'seed', GETDATE(), NULL, 1, 1, 1, NULL, NULL),
 ('HCOX', @Pwd, 'Sample Consultancy Organisation Pvt Ltd', 2, 1, 'hco@example.test', '9999991002', 'HMADMINX', GETDATE(), '28', 0, 1, 0, NULL, 'Manufacturing'),
 ('HCL1', @Pwd, 'Lead Consultant One', 3, 1, 'hcl1@example.test', '9999991003', 'HCOX', GETDATE(), NULL, 0, 1, 0, 'Consultant', 'Manufacturing'),
 ('HCC1', @Pwd, 'Co Consultant One', 3, 1, 'hcc1@example.test', '9999991004', 'HCOX', GETDATE(), NULL, 0, 1, 0, 'Consultant', 'Manufacturing'),
 ('HTE1', @Pwd, 'Technical Expert One', 33, 1, 'hte1@example.test', '9999991005', 'HCOX', GETDATE(), NULL, 0, 1, 0, 'Technical Expert', 'Manufacturing');

-- Handholding fees (Micro, general category): central fee per milestone with 80% central subsidy (columns as the Admin fee page
-- saves them: SubsidyPer/SubsidyAmount = the MSME's share before GST), and the Andhra Pradesh state rows that pay the rest
-- (applicant contribution 0).
DELETE FROM ZEDV4CHK_ZED_CONSULTANT.dbo.AssessmentFee WHERE EnterpriseTypee = 'Micro' AND Certification IN ('Silver', 'Gold');
INSERT ZEDV4CHK_ZED_CONSULTANT.dbo.AssessmentFee (EnterpriseTypee, Certification, AssessmentFee, Gst, Total, Coupon, AssessmentFeeAfterCoupon,
        GstAfterCoupon, TotalAfterCoupon, SubsidyPer, SubsidyAmount, GstAfterSubsidy, ApplicantContributionAfterSubsidy, Tds15, Tds75,
        NetPaybleTds15, NetPaybleTds75, IsActive, SpecialCategory, SubsidyPercentage, MileStone, PayAllAtMilestone1)
SELECT 'Micro', f.C, f.Fee, f.Fee * 0.18, f.Fee * 1.18, NULL, f.Fee, f.Fee * 0.18, f.Fee * 1.18,
       f.Fee * 0.2, f.Fee * 0.2, f.Fee * 0.2 * 0.18, f.Fee * 0.2 * 1.18, f.Fee * 0.2 * 0.02, f.Fee * 0.2 * 0.10,
       f.Fee * 0.2 * 1.18 - f.Fee * 0.2 * 0.02, f.Fee * 0.2 * 1.18 - f.Fee * 0.2 * 0.10, 1, 0, 80, m.M, 0
FROM (VALUES ('Silver', 50000), ('Gold', 75000)) f (C, Fee) CROSS JOIN (VALUES (1), (2), (3)) m (M);
DELETE FROM ZEDV4CHK_ZED_CONSULTANT.dbo.StateAssessmentFee WHERE StateCode = '28' AND EnterpriseTypee = 'Micro';
INSERT ZEDV4CHK_ZED_CONSULTANT.dbo.StateAssessmentFee (StateName, EnterpriseTypee, Certification, AssessmentFee, Gst, Total, Coupon,
        AssessmentFeeAfterCoupon, GstAfterCoupon, TotalAfterCoupon, SubsidyPer, SubsidyAmount, GstAfterSubsidy, ApplicantContributionAfterSubsidy,
        StateContributionAfterSubsidy, Tds15, Tds75, NetPaybleTds15, NetPaybleTds75, IsActive, SpecialCategory, SubsidyPercentage, MileStone,
        StateSubsidyPercentage, StateCode, BeforeStateSubsidyAmount, BeforeStateGstAfterSubsidy)
SELECT 'ANDHRA PRADESH', 'Micro', f.C, f.Fee, f.Fee * 0.18, f.Fee * 1.18, NULL, f.Fee, f.Fee * 0.18, f.Fee * 1.18,
       0, 0, 0, 0, f.Fee * 0.2 * 1.18, 0, 0, 0, 0, 1, 0, 80, m.M, 100, '28', f.Fee * 0.2, f.Fee * 0.2 * 0.18
FROM (VALUES ('Silver', 50000), ('Gold', 75000)) f (C, Fee) CROSS JOIN (VALUES (1), (2), (3)) m (M);

-- The three units: certified on main, then copied to the Handholding database as a certified unit is.
DECLARE @units TABLE (Zed varchar(50), MsmeId varchar(10), Name varchar(100), Lvl varchar(10), N int);
INSERT @units VALUES ('ZEDMSME998101', '998101', 'Sample Silver Handholding Industries', 'Bronze', 1),
                     ('ZEDMSME998102', '998102', 'Sample Second Silver Handholding Works', 'Bronze', 2),
                     ('ZEDMSME998201', '998201', 'Sample Gold Handholding Industries', 'Silver', 3);
DECLARE @Zed varchar(50), @MsmeId varchar(10), @Name varchar(100), @Lvl varchar(10), @N int;
DECLARE u CURSOR LOCAL FAST_FORWARD FOR SELECT Zed, MsmeId, Name, Lvl, N FROM @units;
OPEN u; FETCH NEXT FROM u INTO @Zed, @MsmeId, @Name, @Lvl, @N;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @Mob varchar(10) = '97000000' + RIGHT('0' + CAST(@N AS varchar(2)), 2);
    DECLARE @Mail varchar(100) = 'unit' + LOWER(@MsmeId) + '@example.test';
    DECLARE @t sysname, @sql nvarchar(max), @db sysname;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT 'ZEDV4CHK_ZEDCS_V2_LIVE', t.name FROM ZEDV4CHK_ZEDCS_V2_LIVE.sys.columns col JOIN ZEDV4CHK_ZEDCS_V2_LIVE.sys.tables t ON t.object_id = col.object_id WHERE col.name = 'ZedId'
        UNION SELECT DISTINCT 'ZEDV4CHK_ZED_CONSULTANT', t.name FROM ZEDV4CHK_ZED_CONSULTANT.sys.columns col JOIN ZEDV4CHK_ZED_CONSULTANT.sys.tables t ON t.object_id = col.object_id WHERE col.name = 'ZedId';
    OPEN c; FETCH NEXT FROM c INTO @db, @t;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @sql = N'DELETE FROM ' + QUOTENAME(@db) + N'.dbo.' + QUOTENAME(@t) + N' WHERE ZedId = @z';
        EXEC sp_executesql @sql, N'@z varchar(50)', @z = @Zed;
        FETCH NEXT FROM c INTO @db, @t;
    END
    CLOSE c; DEALLOCATE c;
    DELETE FROM ZEDV4CHK_ZED_CONSULTANT.dbo.Msme WHERE MsmeId = @MsmeId;
    DELETE FROM ZEDV4CHK_ZED_CONSULTANT.dbo.MsmeBasicInformation WHERE MsmeId = @MsmeId;
    DELETE FROM dbo.Users WHERE UserId = @Zed;
    INSERT dbo.Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate)
    VALUES (@Zed, @Pwd, @Name, 5, 1, @Mail, @Mob, 'seed', GETDATE());
    INSERT dbo.Msme (MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
                     EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad, PArea, PCity, PAddress, PPin,
                     PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity, FourDigitActivity, FiveDigitActivity,
                     ActivityDetailId, PledgeEmailId, PledgeCertificateNo, RegistrationType, IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName,
                     PUnitIdNo, CreatedDate, RegistrationFrom, FinancialAssistanceStatus,
                     IsBronzePaymentDone, IsSilverPaymentDone)
    VALUES (@MsmeId, @Zed, 28, 'ANDHRA PRADESH', 745, 'GUNTUR', 'Sample Owner', @Name, 2, 'Private Limited Company', 'Micro', 'Micro', @Mob, @Mail,
            'APP' + @MsmeId, 'UDYAM-AP-07-00' + RIGHT(@MsmeId, 4), 'Plot ' + RIGHT(@MsmeId, 3), 'Sample Auto Nagar', 'Industrial Road', 'Auto Nagar', 'GUNTUR',
            'Plot ' + RIGHT(@MsmeId, 3) + ', Sample Auto Nagar, Industrial Road, Guntur', '522001', 28, 'ANDHRA PRADESH', 745, 'GUNTUR', '1',
            'Manufacturing', '24 - Manufacture of basic metals', '2431', '24311', 1, @Mail, @Zed, 'UDYAM', '01/04/2018', 'Yes',
            'PH' + CAST(@N AS varchar(2)), 'Sample Unit H' + CAST(@N AS varchar(2)), '1', GETDATE(), 'Android', 0,
            1, CASE WHEN @Lvl = 'Silver' THEN 1 END);
    INSERT dbo.MsmeBasicInformation (MsmeId, ApplicationId, UdyogAadharNo, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName, SocialCategory,
                     SocialCategoryName, Gender, PH, PanNo, Address, StateId, StateName, DistrictId, DistrictName, LgDistrictCode, Pincode, MobileNo, EmailId,
                     MajorActivity, MajorActivityName, EnterpriseType, EnterpriseTypee, CommmenceDate, TotalEmp, InvestmentCost, DicName, AppliedDate, ZedId,
                     IsEligibleForBenefits, LastestCertification)
    VALUES (@MsmeId, 'APP' + @MsmeId, 'UDYAM-AP-07-00' + RIGHT(@MsmeId, 4), 'Sample Owner', @Name, 2, 'Private Limited Company', 1, 'General', 'Male', 'No',
            'AAAPH' + RIGHT('000' + CAST(@N AS varchar(2)), 4) + 'H', 'Plot ' + RIGHT(@MsmeId, 3) + ', Sample Auto Nagar, Industrial Road, Guntur, Andhra Pradesh-522001',
            28, 'ANDHRA PRADESH', 745, 'GUNTUR', 745, '522001', @Mob, @Mail, 1, 'Manufacturing', 'Micro', 'Micro', '01/04/2018', 18, 4500000,
            'GUNTUR', '01/04/2019', @Zed, 1, @Lvl);
    -- The certified record (Bronze: desktop certificate; Silver: certificate after the visit).
    INSERT dbo.MsmeCertifications (ZedId, Certification, NcCount, CertificationStatus, CertificationStatusDate, DaCertificateNo, SaCertificateNo,
                                   DesktopAccepted, CreatedDate, CertificationPhase, NcStatus)
    VALUES (@Zed, @Lvl, 0, CASE WHEN @Lvl = 'Bronze' THEN 6 ELSE 16 END, DATEADD(DAY, -30, GETDATE()),
            CASE WHEN @Lvl = 'Bronze' THEN '15102026_99810' + CAST(@N AS varchar(2)) END,
            CASE WHEN @Lvl = 'Silver' THEN '15102026_99820' + CAST(@N AS varchar(2)) END,
            1, DATEADD(DAY, -60, GETDATE()), 'CERTIFIED', 0);
    EXEC dbo.SP_MOVING_CERTIFIED_MSME_TO_CONSULTANCY @ZedId = @Zed, @CertificationType = @Lvl;
    FETCH NEXT FROM u INTO @Zed, @MsmeId, @Name, @Lvl, @N;
END
CLOSE u; DEALLOCATE u;

COMMIT;
SELECT M.ZedId, M.EnterpriseName, B.LastestCertification, M.StateName FROM ZEDV4CHK_ZED_CONSULTANT.dbo.Msme M
JOIN ZEDV4CHK_ZED_CONSULTANT.dbo.MsmeBasicInformation B ON B.ZedId = M.ZedId WHERE M.ZedId LIKE 'ZEDMSME998%' ORDER BY M.ZedId;
SELECT TOP 5 * FROM dbo.ErrorLogForConsultancy ORDER BY 1 DESC;
