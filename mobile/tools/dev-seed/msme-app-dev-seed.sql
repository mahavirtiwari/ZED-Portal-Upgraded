/*
  Fake data for running the ZED MSME applicant app (apps/zedmsme) end to end against the V4 portal and MobileApi on a
  developer PC, on a throwaway ZEDV4CHK_ set (database\setup.ps1 -DatabasePrefix ZEDV4CHK_ -WithKawachStandIn, then
  deploy\Invoke-ZedDatabaseScripts.ps1 with the same prefix). LOCAL USE ONLY; refused on any other database.

  Two units, both signed in to with the ZED ID and $(Password):
    $(ZedId)1  Bronze paid, at "Basic Information & Document Upload" (CertificationStatus 1), with a small questionnaire
               (2 parameters, 3 requirements, 4 evidences, one with "Certificate Available").
    $(ZedId)2  Bronze certified (CertificationStatus 6) and Financial Assistance open (FinancialAssistanceStatus 1).
  Plus what the registration needs: sector 24 may register. All names are fake; re-running resets both units.

  sqlcmd -S localhost\SQLEXPRESS -E -C -d ZEDV4CHK_ZEDCS_V2_LIVE -i msme-app-dev-seed.sql
         -v ZedId=ZEDRNAPP000 Password=<a dev password, kept out of the repository>
  (mobile/tools/dev-seed/seed-local-msme-app.ps1 does this with a generated password stored in an untracked file.)
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() NOT LIKE 'ZEDV4CHK[_]%'
BEGIN
    RAISERROR('Run only on a throwaway ZEDV4CHK_ database.', 16, 1);
    RETURN;
END

DECLARE @Prefix varchar(40) = '$(ZedId)';
DECLARE @Password varchar(50) = '$(Password)';
IF @Prefix NOT LIKE 'ZEDRN%'
BEGIN
    RAISERROR('Fake ids must start with ZEDRN.', 16, 1);
    RETURN;
END

BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM Sectors WHERE SectorCode = '24')
    INSERT INTO Sectors (SectorCode, SectorName, OrderNo, SchemeId, SchemeName) VALUES ('24', 'Manufacture of basic metals', 1, 1, 'ZED');
UPDATE Sectors SET SectorType = 'Manufacturing' WHERE SectorCode = '24';

DECLARE @n int = 1;
WHILE @n <= 2
BEGIN
    DECLARE @ZedId varchar(50) = @Prefix + CAST(@n AS varchar(2));
    DECLARE @MsmeId int = 991000 + @n;

    -- Clean the fake unit (including anything the app submitted).
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
    DELETE FROM Users WHERE UserId = @ZedId;

    INSERT INTO Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate)
    VALUES (@ZedId, @Password, 'RN Applicant ' + CAST(@n AS varchar(2)), 5, 1, 'dev.zed@qcin.org', '900000100' + CAST(@n AS varchar(2)), 'dev-seed', GETDATE());

    INSERT INTO Msme (MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType,
        OrganisationTypeName, EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad,
        PArea, PCity, PAddress, PPin, PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity,
        FourDigitActivity, FiveDigitActivity, ActivityDetailId, PledgeEmailId, IsBronzePaymentDone, PledgeCertificateNo, RegistrationType,
        IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName, PUnitIdNo, CreatedDate, RegistrationFrom, FinancialAssistanceStatus)
    VALUES (@MsmeId, @ZedId, 7, 'DELHI', 77, 'NEW DELHI', 'Test Owner', 'RN Applicant Enterprise ' + CAST(@n AS varchar(2)), 2, 'Private Limited Company',
        'Micro', 'Micro', '900000100' + CAST(@n AS varchar(2)), 'dev.zed@qcin.org', 'APP' + RIGHT(@ZedId, 4), 'UDYAM-DL-00-000100' + CAST(@n AS varchar(2)),
        'Plot ' + CAST(@n AS varchar(2)), 'Test Building', 'Test Road', 'Test Area', 'New Delhi', 'Plot ' + CAST(@n AS varchar(2)) + ', Test Building, Test Road, Test Area',
        '110001', 7, 'DELHI', 77, 'NEW DELHI', '1', 'Manufacture of test products', '24', '2431', '24311', 1, 'dev.zed@qcin.org', 1, @ZedId, 'UDYAM',
        '01/01/2020', 'Yes', '1', 'RN Applicant Unit ' + CAST(@n AS varchar(2)), '1', GETDATE(), 'Android', CASE WHEN @n = 2 THEN 1 ELSE 0 END);

    INSERT INTO MsmeBasicInformation (MsmeId, ApplicationId, UdyogAadharNo, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
        SocialCategory, SocialCategoryName, Gender, PH, PanNo, Address, StateId, StateName, DistrictId, DistrictName, LgDistrictCode, Pincode,
        MobileNo, EmailId, MajorActivity, MajorActivityName, EnterpriseType, EnterpriseTypee, CommmenceDate, TotalEmp, InvestmentCost, DicName,
        AppliedDate, ZedId)
    VALUES (@MsmeId, 'APP' + RIGHT(@ZedId, 4), 'UDYAM-DL-00-000100' + CAST(@n AS varchar(2)), 'Test Owner', 'RN Applicant Enterprise ' + CAST(@n AS varchar(2)),
        2, 'Private Limited Company', 1, 'General', 'Male', 'No', 'AAAAA0000A', 'Plot ' + CAST(@n AS varchar(2)) + ', Test Building, Test Road, Test Area',
        7, 'DELHI', 77, 'NEW DELHI', 77, '110001', '900000100' + CAST(@n AS varchar(2)), 'dev.zed@qcin.org', 1, 'Manufacturing', 'Micro', 'Micro',
        '01/01/2020', 25, 1000000, 'NEW DELHI', '01/01/2021', @ZedId);

    INSERT INTO MsmeCertifications (ZedId, Certification, NcCount, CertificationStatus, CertificationStatusDate,
        NcStatus, Nc1Status, Nc2Status, Nc3Status, Nc4Status, Nc5Status, CreatedDate)
    VALUES (@ZedId, 'Bronze', 0, CASE WHEN @n = 2 THEN 6 ELSE 1 END, GETDATE(), 0, 0, 0, 0, 0, 0, GETDATE());

    IF @n = 1
    BEGIN
        -- Questionnaire (fake texts) of the unit at the document upload.
        INSERT INTO MsmeSections (SectionId, ZedId, SectionCode, SectionName, OrderNo, iButton, SectionType, NcCount) VALUES
            (9111, @ZedId, '1', 'Test Parameter One', 1, 'Help for parameter one', 'Bronze', 0),
            (9112, @ZedId, '2', 'Test Parameter Two', 2, 'Help for parameter two', 'Bronze', 0);
        INSERT INTO MsmeRequirements (RequirementId, ZedId, SectionCode, SectionName, RequirementCode, RequirementName, OrderNo, SectionType, NcCount) VALUES
            (9211, @ZedId, '1', 'Test Parameter One', '1', 'Requirement 1.1', 1, 'Bronze', 0),
            (9212, @ZedId, '1', 'Test Parameter One', '2', 'Requirement 1.2', 2, 'Bronze', 0),
            (9213, @ZedId, '2', 'Test Parameter Two', '1', 'Requirement 2.1', 1, 'Bronze', 0);
        INSERT INTO MsmeOptions (OptionId, ZedId, SectionCode, OptionCode, OptionName, RequirementCode, SectionType, NcCount) VALUES
            (9311, @ZedId, '1', '1', 'The unit has a documented test process', '1', 'Bronze', 0),
            (9312, @ZedId, '1', '1', 'The unit keeps test records', '2', 'Bronze', 0),
            (9313, @ZedId, '2', '1', 'The unit trains its test staff', '1', 'Bronze', 0);
        INSERT INTO MsmeSubOptions (SubOptionId, ZedId, SectionCode, OptionCode, SubOptionCode, SubOptionName, RequirementCode, SectionType, NcCount) VALUES
            (9411, @ZedId, '1', '1', '1', 'Process document is approved', '1', 'Bronze', 0);
        INSERT INTO MsmeEvidences (EvidenceId, ZedId, SectionCode, RequirementCode, EvidenceCode, EvidenceName, SectionType, ValidationRequired,
            NcCount, RequirementId, EvidenceHelpText) VALUES
            (9511, @ZedId, '1', '1', '1', 'Photo of the test process document', 'Bronze', 0, 0, 9211, 'Capture the first page of the process document'),
            (9512, @ZedId, '1', '2', '1', 'Photo of the test records', 'Bronze', 0, 0, 9212, 'Capture a page of the records'),
            (9513, @ZedId, '2', '1', '1', 'Training certificate', 'Bronze', 1, 0, 9213, 'Certificate from an accredited body, if available'),
            (9514, @ZedId, '2', '1', '2', 'Photo of the training register', 'Bronze', 0, 0, 9213, 'Capture the training register');
    END

    SET @n += 1;
END

COMMIT;
PRINT 'Seeded ' + @Prefix + '1 (Bronze, document upload) and ' + @Prefix + '2 (Bronze certified, Financial Assistance open)';
