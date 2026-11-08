-- Run on ZEDCS_V2_LIVE (after 0028, 0029, 0031, 0060 and 0063). Additive and safe to re-run (every deploy runs it).
--
-- Generic certification levels (2026-11-08): a level the Admin adds in Administration -> Certification Levels works as ZED-X
-- (code ZEDX, the first "V4 level") does. Bronze, Silver and Gold keep their legacy procedures. New columns of legacy tables:
--   dbo.SectionTypes.QrDigit varchar(1)   the digit between the plant ID and the random part of a level's QR number
--       (SP_MONITORING_RA/DA_FINAL_SUBMIT through FN_V4_LEVEL_QR_DIGIT; fix main/14). ZED-X keeps 5 (Bronze writes 2, Gold 4);
--       other V4 levels get the first free one of 6, 7, 8, 9, A ... Z, in order (the portal gives a new level one when it is
--       added; this migration gives one to every V4 level that has none).
--   Per V4 level {Code} (every SectionTypes row with IsCertificationLevel = 1 that is not Bronze, Silver or Gold, code of 2 to
--   20 letters and digits), as ZED-X's of 0029 and 0060, when missing:
--       dbo.Msme.Is{Code}PaymentDone bit, dbo.Msme.IsSur{Code}PaymentDone bit,
--       dbo.Users.Allow{Code}Assessments bit (NULL = allowed), dbo.Users.ReasonForBlock{Code} nvarchar(2000)
--     (the portal adds them when the Admin adds the level; when its SQL login may not ALTER the tables, this migration does on
--     the next update). ZED_SURVEILLANCE's Msme.Is{Code}PaymentDone: migration 0066.
-- Functions (also used by the patched legacy procedures, fix main/14):
--   dbo.FN_V4_LEVEL_MODE(@Code)      'Site' / 'Desktop' for a V4 level (ZED-X always 'Site', as the procedures treat it as
--                                    Gold), NULL for Bronze, Silver, Gold and unknown codes.
--   dbo.FN_V4_LEVEL_QR_DIGIT(@Code)  the level's QR digit (ZED-X '5'; '5' when none is set).
-- Procedures, generic over the level (were ZED-X only):
--   dbo.SP_V4_CERTIFICATION_PAID     sets Is{Code}PaymentDone of any V4 level (dynamic SQL on the level's column, when it exists).
--   dbo.SP_V4_AUTO_ALLOT_AGENCY      uses the level's own agency column (Allow{Code}Assessments; ZED-X's AllowZedxAssessments);
--                                    V4 calls it after the final submit of every V4 level.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50065, '0065 runs on ZEDCS_V2_LIVE.', 1;
GO
IF COL_LENGTH('dbo.SectionTypes', 'QrDigit') IS NULL ALTER TABLE dbo.SectionTypes ADD QrDigit varchar(1) NULL;
GO
UPDATE dbo.SectionTypes SET QrDigit = '5' WHERE SectionType = 'ZEDX' AND IsCertificationLevel = 1 AND QrDigit IS NULL;
GO
-- The columns and the QR digit of every V4 level.
DECLARE @Code varchar(50), @Sql nvarchar(max), @Digit varchar(1);
DECLARE levels CURSOR LOCAL FAST_FORWARD FOR
    SELECT LTRIM(RTRIM(SectionType)) FROM dbo.SectionTypes
    WHERE IsCertificationLevel = 1 AND LTRIM(RTRIM(SectionType)) NOT IN ('Bronze', 'Silver', 'Gold')
      AND LEN(LTRIM(RTRIM(SectionType))) BETWEEN 2 AND 20 AND LTRIM(RTRIM(SectionType)) LIKE '[A-Za-z]%'
      AND LTRIM(RTRIM(SectionType)) NOT LIKE '%[^A-Za-z0-9]%'
    ORDER BY ISNULL(OrderNo, 0), SectionType;
OPEN levels;
FETCH NEXT FROM levels INTO @Code;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF COL_LENGTH('dbo.Msme', 'Is' + @Code + 'PaymentDone') IS NULL
    BEGIN
        SET @Sql = N'ALTER TABLE dbo.Msme ADD ' + QUOTENAME('Is' + @Code + 'PaymentDone') + N' bit NULL;';
        EXEC sys.sp_executesql @Sql;
    END
    IF COL_LENGTH('dbo.Msme', 'IsSur' + @Code + 'PaymentDone') IS NULL
    BEGIN
        SET @Sql = N'ALTER TABLE dbo.Msme ADD ' + QUOTENAME('IsSur' + @Code + 'PaymentDone') + N' bit NULL;';
        EXEC sys.sp_executesql @Sql;
    END
    -- ZED-X's were named by hand in 0060 (AllowZedxAssessments, ReasonForBlockZedx); SQL Server finds them under any case.
    IF COL_LENGTH('dbo.Users', 'Allow' + @Code + 'Assessments') IS NULL
    BEGIN
        SET @Sql = N'ALTER TABLE dbo.Users ADD ' + QUOTENAME('Allow' + UPPER(LEFT(@Code, 1)) + SUBSTRING(@Code, 2, 50) + 'Assessments') + N' bit NULL;';
        EXEC sys.sp_executesql @Sql;
    END
    IF COL_LENGTH('dbo.Users', 'ReasonForBlock' + @Code) IS NULL
    BEGIN
        SET @Sql = N'ALTER TABLE dbo.Users ADD ' + QUOTENAME('ReasonForBlock' + UPPER(LEFT(@Code, 1)) + SUBSTRING(@Code, 2, 50)) + N' nvarchar(2000) NULL;';
        EXEC sys.sp_executesql @Sql;
    END
    IF @Code <> 'ZEDX'
    BEGIN
        SET @Digit = NULL;
        SELECT TOP (1) @Digit = d.Digit
        FROM (VALUES (1, '6'), (2, '7'), (3, '8'), (4, '9'), (5, 'A'), (6, 'B'), (7, 'C'), (8, 'D'), (9, 'E'), (10, 'F'), (11, 'G'),
                     (12, 'H'), (13, 'I'), (14, 'J'), (15, 'K'), (16, 'L'), (17, 'M'), (18, 'N'), (19, 'O'), (20, 'P'), (21, 'Q'),
                     (22, 'R'), (23, 'S'), (24, 'T'), (25, 'U'), (26, 'V'), (27, 'W'), (28, 'X'), (29, 'Y'), (30, 'Z')) d(n, Digit)
        WHERE NOT EXISTS (SELECT 1 FROM dbo.SectionTypes s WHERE s.QrDigit = d.Digit)
        ORDER BY d.n;
        UPDATE dbo.SectionTypes SET QrDigit = @Digit WHERE SectionType = @Code AND IsCertificationLevel = 1 AND QrDigit IS NULL;
    END
    FETCH NEXT FROM levels INTO @Code;
END
CLOSE levels;
DEALLOCATE levels;
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_LEVEL_MODE (@Code varchar(50))
RETURNS varchar(10)
AS
BEGIN
    -- V4_0065: 'Site' / 'Desktop' for a V4 level, NULL for Bronze, Silver, Gold and unknown codes.
    RETURN CASE
        WHEN @Code IS NULL OR LTRIM(RTRIM(@Code)) IN ('Bronze', 'Silver', 'Gold') THEN NULL
        WHEN LTRIM(RTRIM(@Code)) = 'ZEDX' THEN 'Site'
        ELSE (SELECT TOP (1) CASE WHEN AssessmentMode = 'Desktop' THEN 'Desktop' ELSE 'Site' END
              FROM dbo.SectionTypes WHERE SectionType = LTRIM(RTRIM(@Code)) AND IsCertificationLevel = 1)
    END;
END
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_LEVEL_QR_DIGIT (@Code varchar(50))
RETURNS varchar(1)
AS
BEGIN
    -- V4_0065: ZED-X '5' (as fix main/14 wrote it); another V4 level its SectionTypes.QrDigit, '5' when none is set.
    RETURN CASE
        WHEN LTRIM(RTRIM(@Code)) = 'ZEDX' THEN '5'
        ELSE ISNULL((SELECT TOP (1) NULLIF(LTRIM(RTRIM(QrDigit)), '') FROM dbo.SectionTypes
                     WHERE SectionType = LTRIM(RTRIM(@Code)) AND IsCertificationLevel = 1), '5')
    END;
END
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_CERTIFICATION_PAID
    @ZedId varchar(50),
    @Certification varchar(50)
AS
BEGIN
    -- V4_0065: the payment flag of every V4 level (was ZED-X only, 0029).
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.MsmePaymentInfo WHERE ZedId = @ZedId AND Certification = @Certification) RETURN;

    BEGIN TRANSACTION;
    IF @Certification = 'ZEDX'
        UPDATE dbo.Msme SET IsZEDXPaymentDone = 1 WHERE ZedId = @ZedId AND ISNULL(IsZEDXPaymentDone, 0) = 0;
    ELSE IF dbo.FN_V4_LEVEL_MODE(@Certification) IS NOT NULL AND @Certification NOT LIKE '%[^A-Za-z0-9]%'
        AND COL_LENGTH('dbo.Msme', 'Is' + @Certification + 'PaymentDone') IS NOT NULL
    BEGIN
        DECLARE @Flag sysname = QUOTENAME('Is' + LTRIM(RTRIM(@Certification)) + 'PaymentDone');
        DECLARE @Set nvarchar(max) = N'UPDATE dbo.Msme SET ' + @Flag + N' = 1 WHERE ZedId = @z AND ISNULL(' + @Flag + N', 0) = 0;';
        EXEC sys.sp_executesql @Set, N'@z varchar(50)', @z = @ZedId;
    END

    DECLARE @Nic varchar(10) = (SELECT TOP 1 LEFT(LTRIM(TwoDigitActivity), 2) FROM dbo.Msme WHERE ZedId = @ZedId);
    IF @Nic IS NOT NULL AND LEN(@Nic) = 2
       AND NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification)
    BEGIN
        DECLARE @NotApplicable TABLE (SectionCode varchar(50) PRIMARY KEY);
        INSERT INTO @NotApplicable (SectionCode)
        SELECT DISTINCT SectionCode FROM dbo.Sections
        WHERE SectionType = @Certification AND SectionCode IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(NicSectors)), '') IS NOT NULL
          AND CHARINDEX(',' + @Nic + ',', ',' + REPLACE(NicSectors, ' ', '') + ',') = 0;

        IF EXISTS (SELECT 1 FROM @NotApplicable)
        BEGIN
            DELETE e FROM dbo.MsmeEvidences e JOIN @NotApplicable n ON n.SectionCode = e.SectionCode WHERE e.ZedId = @ZedId AND e.SectionType = @Certification;
            DELETE s FROM dbo.MsmeSubOptions s JOIN @NotApplicable n ON n.SectionCode = s.SectionCode WHERE s.ZedId = @ZedId AND s.SectionType = @Certification;
            DELETE o FROM dbo.MsmeOptions o JOIN @NotApplicable n ON n.SectionCode = o.SectionCode WHERE o.ZedId = @ZedId AND o.SectionType = @Certification;
            DELETE r FROM dbo.MsmeRequirements r JOIN @NotApplicable n ON n.SectionCode = r.SectionCode WHERE r.ZedId = @ZedId AND r.SectionType = @Certification;
            DELETE m FROM dbo.MsmeSections m JOIN @NotApplicable n ON n.SectionCode = m.SectionCode WHERE m.ZedId = @ZedId AND m.SectionType = @Certification;
        END
    END
    COMMIT;
END
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_AUTO_ALLOT_AGENCY
    @ZedId varchar(50),
    @CertificationType varchar(50)
AS
BEGIN
    -- V4_0065: any V4 level, with its own agency column (0063 had ZED-X's AllowZedxAssessments).
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications
                   WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL
                     AND ISNULL(NcCount, 0) = 0 AND CertificationStatus = 2)
        RETURN;

    DECLARE @Category varchar(20) = (
        SELECT TOP 1 COALESCE(
            CASE WHEN s.SectorType IN ('Manufacturing', 'Services') THEN s.SectorType END,
            CASE WHEN NULLIF(LTRIM(m.Activity), '') IS NULL THEN NULL
                 WHEN LTRIM(m.Activity) LIKE 'Manuf%' THEN 'Manufacturing' ELSE 'Services' END)
        FROM dbo.Msme m
        LEFT JOIN dbo.Sectors s ON LTRIM(RTRIM(s.SectorCode)) = LEFT(LTRIM(m.TwoDigitActivity), 2)
        WHERE m.ZedId = @ZedId);

    -- Not an agency the Master Admin disabled for the level (Users.Allow{Code}Assessments; NULL = allowed). A level whose
    -- column is not there yet (added by the portal or by this migration) has no agency disabled.
    DECLARE @Column sysname = CASE WHEN @CertificationType = 'ZEDX' THEN 'AllowZedxAssessments' ELSE 'Allow' + LTRIM(RTRIM(@CertificationType)) + 'Assessments' END;
    DECLARE @Allowed nvarchar(400) =
        CASE WHEN @CertificationType NOT LIKE '%[^A-Za-z0-9]%' AND COL_LENGTH('dbo.Users', @Column) IS NOT NULL
             THEN N'ISNULL(' + QUOTENAME(@Column) + N', 1) = 1' ELSE N'1 = 1' END;
    DECLARE @Sql nvarchar(max);

    DECLARE @AgencyId varchar(50) = NULL, @AllotType varchar(20) = NULL;
    DECLARE @OrgPartnerEmailId varchar(100) = (
        SELECT TOP 1 NULLIF(OrgPartnerEmailId, '') FROM dbo.MsmeFacilitatorEntries
        WHERE LoginVerified = 'Yes' AND ZedId = @ZedId AND Certification = @CertificationType);

    IF @OrgPartnerEmailId IS NOT NULL
    BEGIN
        SET @Sql = N'SELECT TOP 1 @a = UserId FROM dbo.Users
            WHERE RoleId = 2 AND IsActive = 1 AND LTRIM(RTRIM(OrgPartnerId)) = LTRIM(RTRIM(@o))
              AND ' + @Allowed + N'
              AND (@c IS NULL OR SectorActivity IS NULL OR SectorActivity IN (''Both'', @c));';
        EXEC sys.sp_executesql @Sql, N'@a varchar(50) OUTPUT, @o varchar(100), @c varchar(20)', @a = @AgencyId OUTPUT, @o = @OrgPartnerEmailId, @c = @Category;
    END
    IF @AgencyId IS NOT NULL SET @AllotType = 'Direct';

    IF @AgencyId IS NULL
    BEGIN
        DECLARE @LastId int = (
            SELECT TOP 1 u.Id FROM dbo.AgencyAllotmentHistory h JOIN dbo.Users u ON u.UserId = h.AgencyId
            WHERE h.AllotType = 'Auto' AND h.CertificationType = @CertificationType ORDER BY h.Id DESC);
        SET @Sql = N'SELECT TOP 1 @a = UserId FROM dbo.Users
            WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN (''ZEDAA003'', ''ZEDAA0044'')
              AND ' + @Allowed + N'
              AND (@c IS NULL OR SectorActivity IS NULL OR SectorActivity IN (''Both'', @c))
              AND Id > ISNULL(@l, 0)
            ORDER BY Id;';
        EXEC sys.sp_executesql @Sql, N'@a varchar(50) OUTPUT, @c varchar(20), @l int', @a = @AgencyId OUTPUT, @c = @Category, @l = @LastId;
        IF @AgencyId IS NULL
            EXEC sys.sp_executesql @Sql, N'@a varchar(50) OUTPUT, @c varchar(20), @l int', @a = @AgencyId OUTPUT, @c = @Category, @l = 0;
        IF @AgencyId IS NOT NULL SET @AllotType = 'Auto';
    END

    IF @AgencyId IS NULL RETURN;

    UPDATE dbo.MsmeCertifications SET CertificationBodyUserId = @AgencyId, AllotmentType = CASE WHEN @AllotType = 'Direct' THEN 'Direct' ELSE 'RoundRobin' END
    WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL AND ISNULL(NcCount, 0) = 0;
    INSERT INTO dbo.AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate)
    VALUES (@AgencyId, @ZedId, @CertificationType, @AllotType, GETDATE());
    EXEC dbo.SP_SEND_MAIL_AUTO_ALLOT_AGENCY_ROUND_ROBIN @ZedId, @AgencyId;
END
GO
