/*
  Fake data for running the site assessment app (apps/assessor) against the V4 MobileApi on a developer PC
  (launch profile "http", database ZEDCS_V2_LIVE on localhost\SQLEXPRESS). LOCAL USE ONLY.

  A lead and a co-assessor (site verification), one Silver unit at status 8 (the lead still has to allocate the
  parameters), assessment date today 09:00, three parameters (one exempted) with requirements and options, one
  product and one raw material. All names are fake. Re-running resets the unit (its submissions are deleted first).

  sqlcmd -S localhost\SQLEXPRESS -E -C -d ZEDCS_V2_LIVE -i sa-dev-seed.sql
         -v LeadId=ZEDRNLA01 CoId=ZEDRNCA01 ZedId=ZEDRNSA0001 Password=<a dev password, kept out of the repository>
  (mobile/tools/dev-seed/seed-local-sa.ps1 does this with a generated password stored in an untracked file.)
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF @@SERVERNAME NOT LIKE '%SQLEXPRESS%' AND DB_NAME() <> 'ZEDCS_V2_LIVE'
BEGIN
    RAISERROR('Run only on a local development database.', 16, 1);
    RETURN;
END

DECLARE @LeadId varchar(50) = '$(LeadId)';
DECLARE @CoId varchar(50) = '$(CoId)';
DECLARE @ZedId varchar(50) = '$(ZedId)';
DECLARE @Password varchar(50) = '$(Password)';
DECLARE @MsmeId int = 980000 + CAST(RIGHT(@ZedId, 4) AS int);
DECLARE @Cert varchar(20) = 'Silver';

IF @LeadId NOT LIKE 'ZEDRN%' OR @CoId NOT LIKE 'ZEDRN%' OR @ZedId NOT LIKE 'ZEDRN%'
BEGIN
    RAISERROR('Fake ids must start with ZEDRN.', 16, 1);
    RETURN;
END

BEGIN TRANSACTION;

-- Clean the fake unit and assessors (including anything the app submitted).
DECLARE @t sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT DISTINCT t.name FROM sys.columns col JOIN sys.tables t ON t.object_id = col.object_id
    WHERE col.name = 'ZedId' AND t.is_ms_shipped = 0;
OPEN c;
FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@t) + N' WHERE ZedId = @z';
    EXEC sp_executesql @sql, N'@z varchar(50)', @z = @ZedId;
    FETCH NEXT FROM c INTO @t;
END
CLOSE c;
DEALLOCATE c;
DELETE FROM Users WHERE UserId IN (@LeadId, @CoId);
IF OBJECT_ID('dbo.V4UserPasswords', 'U') IS NOT NULL
    EXEC sp_executesql N'DELETE FROM dbo.V4UserPasswords WHERE UserId IN (@a, @b)', N'@a varchar(50), @b varchar(50)', @a = @LeadId, @b = @CoId;

INSERT INTO Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate, SiteVerification) VALUES
    (@LeadId, @Password, 'RN Lead Assessor', 3, 1, 'dev.zed@qcin.org', '9000000011', 'dev-seed', GETDATE(), 1),
    (@CoId, @Password, 'RN Co Assessor', 3, 1, 'dev.zed@qcin.org', '9000000012', 'dev-seed', GETDATE(), 1);

INSERT INTO Msme (MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType,
    OrganisationTypeName, EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad,
    PArea, PCity, PAddress, PPin, PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity,
    FourDigitActivity, FiveDigitActivity, ActivityDetailId, PledgeEmailId, PledgeCertificateNo, RegistrationType,
    IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName, PUnitIdNo, CreatedDate, RegistrationFrom)
VALUES (@MsmeId, @ZedId, 7, 'DELHI', 77, 'NEW DELHI', 'Test Owner', 'RN Test Enterprise Pvt Ltd', 2, 'Private Limited Company',
    'Small', 'Small', '9000000002', 'dev.zed@qcin.org', 'APP' + RIGHT(@ZedId, 4), 'UDYAM-DL-00-0000002', 'Plot 1', 'Test Building',
    'Test Road', 'Test Area', 'New Delhi', 'Plot 1, Test Building, Test Road, Test Area, ', '110001', 7, 'DELHI', 77, 'NEW DELHI', '1',
    'Manufacture of test products', '25', '2599', '25999', 1, 'dev.zed@qcin.org', @ZedId, 'UDYAM', '01/01/2020', 'Yes', '1',
    'RN Test Unit', '1', GETDATE(), 'Web');

INSERT INTO MsmeBasicInformation (MsmeId, ApplicationId, UdyogAadharNo, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
    SocialCategory, SocialCategoryName, Gender, PH, PanNo, Address, StateId, StateName, DistrictId, DistrictName, LgDistrictCode, Pincode,
    MobileNo, EmailId, MajorActivity, MajorActivityName, EnterpriseType, EnterpriseTypee, CommmenceDate, TotalEmp, InvestmentCost, DicName,
    AppliedDate, ZedId)
VALUES (@MsmeId, 'APP' + RIGHT(@ZedId, 4), 'UDYAM-DL-00-0000002', 'Test Owner', 'RN Test Enterprise Pvt Ltd', 2, 'Private Limited Company',
    1, 'General', 'Male', 'No', 'AAAAA0000B', 'Plot 1, Test Building, Test Road, Test Area', 7, 'DELHI', 77, 'NEW DELHI', 77, '110001',
    '9000000002', 'dev.zed@qcin.org', 1, 'Manufacturing', 'Small', 'Small', '01/01/2020', 25, 1000000, 'NEW DELHI', '01/01/2021', @ZedId);

INSERT INTO MsmeCertifications (ZedId, Certification, SiteAssessorId, CoAssessorId, ModeOfAssessment, AssessmentDate, NcCount,
    CertificationStatus, CertificationStatusDate, NcStatus, Nc1Status, Nc2Status, Nc3Status, Nc4Status, Nc5Status, CreatedDate,
    AuditsConducted, DomesticCustomers, InternationalCustomers, RawMaterialImported, OutsourcedProcesses, EnergySources,
    ManufacturingCapacityUnits, ManufacturingCapacityValue, MonthlyUtilizationUnits, MonthlyUtilizationValue, AllowFinalSubmitManual)
VALUES (@ZedId, @Cert, @LeadId, @CoId, 'Onsite', DATEADD(hour, 9, CAST(CAST(GETDATE() AS date) AS datetime)), 0,
    8, GETDATE(), 0, 0, 0, 0, 0, 0, GETDATE(),
    'Yes', 'Customer A', NULL, 'Yes', 'Painting', 'Electricity,Solar', 'Number', '100', 'Number', '80', 0);

-- Questionnaire (fake texts): sections, requirements, options and sub-options of this unit.
INSERT INTO MsmeSections (SectionId, ZedId, SectionCode, SectionName, OrderNo, iButton, SectionType, IsAssessmentExcempted, NcCount) VALUES
    (9101, @ZedId, '1', 'Test Parameter One', 1, 'Help for parameter one', @Cert, 'No', 0),
    (9102, @ZedId, '2', 'Test Parameter Two', 2, 'Help for parameter two', @Cert, 'No', 0),
    (9103, @ZedId, '3', 'Exempted Parameter', 3, 'Help for parameter three', @Cert, 'Yes', 0);

INSERT INTO MsmeRequirements (RequirementId, ZedId, SectionCode, SectionName, QuestionCode, QuestionName, RequirementCode, RequirementName,
    OrderNo, SectionType, NcCount, AssessorRemarks) VALUES
    (9201, @ZedId, '1', 'Test Parameter One', '1', 'Question 1.1', '1', 'Requirement 1.1', 1, @Cert, 0, 'Seen the process document'),
    (9202, @ZedId, '1', 'Test Parameter One', '2', 'Question 1.2', '2', 'Requirement 1.2', 2, @Cert, 0, NULL),
    (9203, @ZedId, '2', 'Test Parameter Two', '1', 'Question 2.1', '1', 'Requirement 2.1', 1, @Cert, 0, NULL);

INSERT INTO MsmeOptions (OptionId, ZedId, SectionCode, QuestionCode, OptionCode, OptionName, RequirementCode, SectionType, NcCount) VALUES
    (9301, @ZedId, '1', '1', '1', 'The unit has a documented test process', '1', @Cert, 0),
    (9302, @ZedId, '1', '2', '1', 'The unit keeps test records', '2', @Cert, 0),
    (9303, @ZedId, '2', '1', '1', 'The unit trains its test staff', '1', @Cert, 0);

INSERT INTO MsmeSubOptions (SubOptionId, ZedId, SectionCode, QuestionCode, OptionCode, SubOptionCode, SubOptionName, RequirementCode, SectionType, NcCount) VALUES
    (9401, @ZedId, '1', '1', '1', '1', 'Process document is approved', '1', @Cert, 0);

INSERT INTO msmeProducts (ZedId, Certification, ProductName, Exported, NcCount) VALUES (@ZedId, @Cert, 'Widget', 'No', 0);
INSERT INTO MsmeRawMaterials (ZedId, Certification, RawMaterialName, Percentage, CountryName, NcCount) VALUES (@ZedId, @Cert, 'Steel', '20', 'China', 0);

COMMIT;
PRINT 'Seeded ' + @ZedId + ' (Silver, status 8) for lead ' + @LeadId + ' and co-assessor ' + @CoId;
