/*
  Fake data for running the Bronze surveillance app (apps/msme) against the V4 MobileApi on a developer PC
  (launch profile "surveillance", database ZED_SURVEILLANCE on localhost\SQLEXPRESS). LOCAL USE ONLY.

  One desktop assessor, one Bronze unit at status 1 allotted to that assessor, and a small Bronze questionnaire
  (2 parameters, 3 requirements, 4 evidences, one of them with "Certificate Available"). All names are fake.
  Re-running resets the unit (its earlier submissions are deleted first).

  sqlcmd -S localhost\SQLEXPRESS -E -C -d ZED_SURVEILLANCE -i surveillance-dev-seed.sql
         -v AssessorId=ZEDRNSA01 ZedId=ZEDRNTEST0001 Password=<a dev password, kept out of the repository>
  (mobile/tools/dev-seed/seed-local.ps1 does this with a generated password stored in an untracked file.)
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF @@SERVERNAME NOT LIKE '%SQLEXPRESS%' AND DB_NAME() <> 'ZED_SURVEILLANCE'
BEGIN
    RAISERROR('Run only on a local development ZED_SURVEILLANCE database.', 16, 1);
    RETURN;
END

DECLARE @AssessorId varchar(50) = '$(AssessorId)';
DECLARE @ZedId varchar(50) = '$(ZedId)';
DECLARE @Password varchar(50) = '$(Password)';
DECLARE @MsmeId int = 990000 + CAST(RIGHT(@ZedId, 4) AS int);

IF @AssessorId NOT LIKE 'ZEDRN%' OR @ZedId NOT LIKE 'ZEDRN%'
BEGIN
    RAISERROR('Fake ids must start with ZEDRN.', 16, 1);
    RETURN;
END

BEGIN TRANSACTION;

-- Clean the fake unit and assessor (including anything the app submitted).
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
DELETE FROM Users WHERE UserId = @AssessorId;

IF NOT EXISTS (SELECT 1 FROM UrlsMasterData) INSERT INTO UrlsMasterData (UrlName, IsActive) VALUES ('http://localhost:4200', 1);

INSERT INTO Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate, DesktopVerification, AllowBronzeSurveillance)
VALUES (@AssessorId, @Password, 'RN Test Desktop Assessor', 3, 1, 'dev.zed@qcin.org', '9000000001', 'dev-seed', GETDATE(), 1, 1);

INSERT INTO Msme (MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType,
    OrganisationTypeName, EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad,
    PArea, PCity, PAddress, PPin, PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity,
    FourDigitActivity, FiveDigitActivity, ActivityDetailId, PledgeEmailId, IsBronzePaymentDone, PledgeCertificateNo, RegistrationType,
    IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName, PUnitIdNo, CreatedDate, RegistrationFrom, FinancialAssistanceStatus)
VALUES (@MsmeId, @ZedId, 7, 'DELHI', 77, 'NEW DELHI', 'Test Owner', 'RN Test Enterprise Pvt Ltd', 2, 'Private Limited Company',
    'Small', 'Small', '9000000002', 'dev.zed@qcin.org', 'APP' + RIGHT(@ZedId, 4), 'UDYAM-DL-00-0000001', 'Plot 1', 'Test Building',
    'Test Road', 'Test Area', 'New Delhi', 'Plot 1, Test Building, Test Road, Test Area', '110001', 7, 'DELHI', 77, 'NEW DELHI', '1',
    'Manufacture of test products', '25', '2599', '25999', 1, 'dev.zed@qcin.org', 1, @ZedId, 'UDYAM', '01/01/2020', 'Yes', '1',
    'RN Test Unit', '1', GETDATE(), 'Web', 0);

INSERT INTO MsmeBasicInformation (MsmeId, ApplicationId, UdyogAadharNo, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
    SocialCategory, SocialCategoryName, Gender, PH, PanNo, Address, StateId, StateName, DistrictId, DistrictName, LgDistrictCode, Pincode,
    MobileNo, EmailId, MajorActivity, MajorActivityName, EnterpriseType, EnterpriseTypee, CommmenceDate, TotalEmp, InvestmentCost, DicName,
    AppliedDate, ZedId)
VALUES (@MsmeId, 'APP' + RIGHT(@ZedId, 4), 'UDYAM-DL-00-0000001', 'Test Owner', 'RN Test Enterprise Pvt Ltd', 2, 'Private Limited Company',
    1, 'General', 'Male', 'No', 'AAAAA0000A', 'Plot 1, Test Building, Test Road, Test Area', 7, 'DELHI', 77, 'NEW DELHI', 77, '110001',
    '9000000002', 'dev.zed@qcin.org', 1, 'Manufacturing', 'Small', 'Small', '01/01/2020', 25, 1000000, 'NEW DELHI', '01/01/2021', @ZedId);

INSERT INTO MsmeCertifications (ZedId, Certification, DesktopAssessorId, NcCount, CertificationStatus, CertificationStatusDate,
    NcStatus, Nc1Status, Nc2Status, Nc3Status, Nc4Status, Nc5Status, CreatedDate, CertificationLevel, MinimumParameters)
VALUES (@ZedId, 'Bronze', @AssessorId, 0, 1, GETDATE(), 0, 0, 0, 0, 0, 0, GETDATE(), 'Bronze', 2);

-- Questionnaire (fake texts): sections, requirements, options, sub-options, evidences of this unit.
INSERT INTO MsmeSections (SectionId, ZedId, SectionCode, SectionName, OrderNo, iButton, SectionType, NcCount) VALUES
    (9101, @ZedId, '1', 'Test Parameter One', 1, 'Help for parameter one', 'Bronze', 0),
    (9102, @ZedId, '2', 'Test Parameter Two', 2, 'Help for parameter two', 'Bronze', 0);

INSERT INTO MsmeRequirements (RequirementId, ZedId, SectionCode, SectionName, RequirementCode, RequirementName, OrderNo, SectionType, NcCount) VALUES
    (9201, @ZedId, '1', 'Test Parameter One', '1', 'Requirement 1.1', 1, 'Bronze', 0),
    (9202, @ZedId, '1', 'Test Parameter One', '2', 'Requirement 1.2', 2, 'Bronze', 0),
    (9203, @ZedId, '2', 'Test Parameter Two', '1', 'Requirement 2.1', 1, 'Bronze', 0);

INSERT INTO MsmeOptions (OptionId, ZedId, SectionCode, OptionCode, OptionName, RequirementCode, SectionType, NcCount) VALUES
    (9301, @ZedId, '1', '1', 'The unit has a documented test process', '1', 'Bronze', 0),
    (9302, @ZedId, '1', '1', 'The unit keeps test records', '2', 'Bronze', 0),
    (9303, @ZedId, '2', '1', 'The unit trains its test staff', '1', 'Bronze', 0);

INSERT INTO MsmeSubOptions (SubOptionId, ZedId, SectionCode, OptionCode, SubOptionCode, SubOptionName, RequirementCode, SectionType, NcCount) VALUES
    (9401, @ZedId, '1', '1', '1', 'Process document is approved', '1', 'Bronze', 0);

INSERT INTO MsmeEvidences (EvidenceId, ZedId, SectionCode, RequirementCode, EvidenceCode, EvidenceName, SectionType, ValidationRequired,
    NcCount, RequirementId, EvidenceHelpText) VALUES
    (9501, @ZedId, '1', '1', '1', 'Photo of the test process document', 'Bronze', 0, 0, 9201, 'Capture the first page of the process document'),
    (9502, @ZedId, '1', '2', '1', 'Photo of the test records', 'Bronze', 0, 0, 9202, 'Capture a page of the records'),
    (9503, @ZedId, '2', '1', '1', 'Training certificate', 'Bronze', 1, 0, 9203, 'Certificate from an accredited body, if available'),
    (9504, @ZedId, '2', '1', '2', 'Photo of the training register', 'Bronze', 0, 0, 9203, 'Capture the training register');

COMMIT;
PRINT 'Seeded ' + @ZedId + ' for desktop assessor ' + @AssessorId;
