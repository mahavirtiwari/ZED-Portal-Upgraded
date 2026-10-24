/*
  Fake data for running the consultant app (apps/consultant) against the V4 consultancy mobile host on a developer PC
  (launch profile "consultancy", database ZED_CONSULTANT on localhost\SQLEXPRESS). LOCAL USE ONLY.

  A lead and a co-consultant (site verification), one Silver unit at the first milestone (NcCount 1) and status 8
  (the lead still has to allocate the parameters), assessment date today 09:00, BDS and HAP dates, two parameters
  with requirements, options and a sub-option (Milestone 2 or 3: also the first milestone's bullets for the progress
  review). All names are fake. Re-running resets the unit (its submissions are
  deleted first).

  sqlcmd -S localhost\SQLEXPRESS -E -C -d ZED_CONSULTANT -i consultant-dev-seed.sql
         -v LeadId=ZEDRNCL01 CoId=ZEDRNCC01 ZedId=ZEDRNCS0001 Milestone=1 Password=<a dev password, kept out of the repository>
  (mobile/tools/dev-seed/seed-local-consultant.ps1 does this with a generated password stored in an untracked file.)
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> 'ZED_CONSULTANT'
BEGIN
    RAISERROR('Run only on a local development ZED_CONSULTANT database.', 16, 1);
    RETURN;
END

DECLARE @LeadId varchar(50) = '$(LeadId)';
DECLARE @CoId varchar(50) = '$(CoId)';
DECLARE @ZedId varchar(50) = '$(ZedId)';
DECLARE @Password varchar(50) = '$(Password)';
DECLARE @Milestone int = CAST('$(Milestone)' AS int);
DECLARE @MsmeId int = 970000 + CAST(RIGHT(@ZedId, 4) AS int);
DECLARE @Cert varchar(20) = 'Silver';
DECLARE @Today datetime = CAST(CAST(GETDATE() AS date) AS datetime);

IF @LeadId NOT LIKE 'ZEDRN%' OR @CoId NOT LIKE 'ZEDRN%' OR @ZedId NOT LIKE 'ZEDRN%'
BEGIN
    RAISERROR('Fake ids must start with ZEDRN.', 16, 1);
    RETURN;
END

BEGIN TRANSACTION;

-- Clean the fake unit and consultants (including anything the app submitted).
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
    (@LeadId, @Password, 'RN Lead Consultant', 3, 1, 'dev.zed@qcin.org', '9000000021', 'dev-seed', GETDATE(), 1),
    (@CoId, @Password, 'RN Co Consultant', 3, 1, 'dev.zed@qcin.org', '9000000022', 'dev-seed', GETDATE(), 1);

INSERT INTO Msme (MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType,
    OrganisationTypeName, EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad,
    PArea, PCity, PAddress, PPin, PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity,
    FourDigitActivity, FiveDigitActivity, ActivityDetailId, PledgeEmailId, PledgeCertificateNo, RegistrationType,
    IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName, PUnitIdNo, CreatedDate, RegistrationFrom)
VALUES (@MsmeId, @ZedId, 7, 'DELHI', 77, 'NEW DELHI', 'Test Owner', 'RN Consultancy Unit Pvt Ltd', 2, 'Private Limited Company',
    'Small', 'Small', '9000000003', 'dev.zed@qcin.org', 'APC' + RIGHT(@ZedId, 4), 'UDYAM-DL-00-0000003', 'Plot 2', 'Test Building',
    'Test Road', 'Test Area', 'New Delhi', 'Plot 2, Test Building, Test Road, Test Area, ', '110001', 7, 'DELHI', 77, 'NEW DELHI', '1',
    'Manufacture of test products', '25', '2599', '25999', 1, 'dev.zed@qcin.org', @ZedId, 'UDYAM', '01/01/2020', 'Yes', '1',
    'RN Consultancy Unit', '1', GETDATE(), 'Web');

INSERT INTO MsmeBasicInformation (MsmeId, ApplicationId, UdyogAadharNo, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
    SocialCategory, SocialCategoryName, Gender, PH, PanNo, Address, StateId, StateName, DistrictId, DistrictName, LgDistrictCode, Pincode,
    MobileNo, EmailId, MajorActivity, MajorActivityName, EnterpriseType, EnterpriseTypee, CommmenceDate, TotalEmp, InvestmentCost, DicName,
    AppliedDate, ZedId)
VALUES (@MsmeId, 'APC' + RIGHT(@ZedId, 4), 'UDYAM-DL-00-0000003', 'Test Owner', 'RN Consultancy Unit Pvt Ltd', 2, 'Private Limited Company',
    1, 'General', 'Male', 'No', 'AAAAA0000C', 'Plot 2, Test Building, Test Road, Test Area', 7, 'DELHI', 77, 'NEW DELHI', 77, '110001',
    '9000000003', 'dev.zed@qcin.org', 1, 'Manufacturing', 'Small', 'Small', '01/01/2020', 25, 1000000, 'NEW DELHI', '01/01/2021', @ZedId);

INSERT INTO MsmeCertifications (ZedId, Certification, SiteAssessorId, CoAssessorId, ModeOfAssessment, AssessmentDate, NcCount,
    CertificationStatus, CertificationStatusDate, NcStatus, Nc1Status, Nc2Status, Nc3Status, Nc4Status, Nc5Status, CreatedDate,
    AuditsConducted, DomesticCustomers, RawMaterialImported, OutsourcedProcesses, EnergySources,
    BdsFromDate, BdsToDate, HapFromDate, HapToDate)
VALUES (@ZedId, @Cert, @LeadId, @CoId, 'Onsite', DATEADD(hour, 9, @Today), @Milestone,
    8, GETDATE(), 0, 0, 0, 0, 0, 0, GETDATE(),
    'Yes', 'Customer A', 'No', 'Painting', 'Electricity',
    @Today, DATEADD(day, 7, @Today), DATEADD(day, 8, @Today), DATEADD(day, 22, @Today));

INSERT INTO AllotedCoAssessors (ZedId, Certification, CoAssessorId, NcCount, IsActive, AllotedDate) VALUES (@ZedId, @Cert, @CoId, @Milestone, 1, GETDATE());

-- Questionnaire (fake texts). The login procedure reads the requirements of the current milestone and joins the
-- first milestone's rows (NcCount 1, same RequirementId) for the bullets saved then, so later milestones get both.
INSERT INTO MsmeSections (SectionId, ZedId, SectionCode, SectionName, OrderNo, iButton, SectionType, IsAssessmentExcempted, NcCount) VALUES
    (9101, @ZedId, '1', 'Test Parameter One', 1, 'Help for parameter one', @Cert, 'No', @Milestone),
    (9102, @ZedId, '2', 'Test Parameter Two', 2, 'Help for parameter two', @Cert, 'No', @Milestone);

INSERT INTO MsmeRequirements (RequirementId, ZedId, SectionCode, SectionName, QuestionCode, QuestionName, RequirementCode, RequirementName,
    OrderNo, SectionType, NcCount)
SELECT r.RequirementId, @ZedId, r.SectionCode, r.SectionName, r.QuestionCode, r.QuestionName, r.RequirementCode, r.RequirementName,
    r.OrderNo, @Cert, m.NcCount
FROM (VALUES
    (9201, '1', 'Test Parameter One', '1', 'Question 1.1', '1', 'Requirement 1.1', 1),
    (9202, '1', 'Test Parameter One', '2', 'Question 1.2', '2', 'Requirement 1.2', 2),
    (9203, '2', 'Test Parameter Two', '1', 'Question 2.1', '1', 'Requirement 2.1', 1)
) r (RequirementId, SectionCode, SectionName, QuestionCode, QuestionName, RequirementCode, RequirementName, OrderNo)
CROSS JOIN (SELECT DISTINCT NcCount FROM (VALUES (1), (@Milestone)) v (NcCount)) m;

-- Later milestones: what the first milestone's baseline study, action plan and technology suggestion left behind.
IF @Milestone > 1
    INSERT INTO MsmeRequirementBullets (ZedId, CertificationType, RequirementId, BulletPoints, ReqType, NcCount)
    SELECT @ZedId, @Cert, r.Id, b.BulletPoints, b.ReqType, 1
    FROM MsmeRequirements r
    JOIN (VALUES
        (9201, 'No written test method', 'BaselineDiagnostic'),
        (9201, 'Write the test procedure', 'HandholdingActionPlan'),
        (9201, 'Digital test bench', 'TechnologyIntervention'),
        (9202, 'Keep a test register', 'HandholdingActionPlan'),
        (9203, 'Plan staff skills', 'HandholdingActionPlan')
    ) b (RequirementId, BulletPoints, ReqType) ON b.RequirementId = r.RequirementId
    WHERE r.ZedId = @ZedId AND r.NcCount = 1;

INSERT INTO MsmeOptions (OptionId, ZedId, SectionCode, QuestionCode, OptionCode, OptionName, RequirementCode, SectionType, NcCount) VALUES
    (9301, @ZedId, '1', '1', '1', 'The unit has a documented test process', '1', @Cert, @Milestone),
    (9302, @ZedId, '1', '2', '1', 'The unit keeps test records', '2', @Cert, @Milestone),
    (9303, @ZedId, '2', '1', '1', 'The unit trains its test staff', '1', @Cert, @Milestone);

INSERT INTO MsmeSubOptions (SubOptionId, ZedId, SectionCode, QuestionCode, OptionCode, SubOptionCode, SubOptionName, RequirementCode, SectionType, NcCount) VALUES
    (9401, @ZedId, '1', '1', '1', '1', 'Process document is approved', '1', @Cert, @Milestone);

COMMIT;
PRINT 'Seeded ' + @ZedId + ' (Silver, milestone ' + CAST(@Milestone AS varchar(2)) + ', status 8) for lead ' + @LeadId + ' and co-consultant ' + @CoId;
