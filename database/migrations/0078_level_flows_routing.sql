-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE (after 0048, 0050, 0051, 0065, 0072, 0074). Safe to re-run (CREATE OR ALTER).
--
-- 2026-11-15 (the user): every certification level can have every assessment flow, chosen by the Admin (Administration ->
-- Certification Levels -> Certificate -> Assessment): Desktop only, Remote only, Onsite only, Desktop + Remote, Desktop +
-- Onsite; Bronze, Silver and Gold included (before: Bronze desktop only, Silver / Gold always with a visit).
--
-- One rule for the status of a certification record, whatever its level (the legacy procedures read it by the level's
-- name, Bronze 6 / others 16; migration 0079 makes the operational ones read it this way):
--   certified            CertificationStatus = 6 AND DaCertificateNo IS NOT NULL   (certified at the desktop)
--                     OR CertificationStatus = 16 AND SaCertificateNo IS NOT NULL  (certified after the visit)
--   waiting for a visit  CertificationStatus = 6 AND DaCertificateNo IS NULL        (as a Silver record always was)
-- The route is decided by the level's flow when the desktop step ends (or at the final submit for a flow without one).
--
-- Main (ZEDCS_V2_LIVE):
--   dbo.FN_V4_LEVEL_DESKTOP(@Code)  1 when the level is certified at the desktop (its flow is Desktop only), else 0.
--                                   No flow stored: Bronze 1, Silver / Gold 0, another level by its AssessmentMode.
--   dbo.SP_V4_DA_FINAL_SUBMIT       the agency's desktop final submit (the portal calls it in place of the legacy one):
--                                   a desktop-only Silver / Gold is certified here (desktop certificate number, status 6,
--                                   ACTIVE, surveillance dates, QR number, the lower levels' certificates UPGRADED,
--                                   benefits, consultancy hand-over), and so is a desktop-only ZED-X (fix main/14 sends
--                                   ZED-X to a visit whatever its mode; its own QR digit, nothing else); a Bronze with a
--                                   visit moves on to its visit (status
--                                   6 without a certificate, as Silver / Gold); every other case runs the legacy
--                                   SP_MONITORING_DA_FINAL_SUBMIT unchanged.
--   dbo.SP_V4_RA_FINAL_SUBMIT       the agency's final submit after the visit: a Bronze is certified here (site certificate
--                                   number, status 16, ACTIVE, surveillance dates, QR digit 2, consultancy hand-over: the
--                                   legacy procedure would take Gold's branch); every other level runs the legacy
--                                   SP_MONITORING_RA_FINAL_SUBMIT, after which the lower levels certified the other way
--                                   (Bronze at 16, Silver at 6) are marked UPGRADED as the legacy code does for the usual ones.
--   dbo.SP_V4_SKIP_DESKTOP          (0074) no longer refuses Bronze: a Remote only / Onsite only Bronze goes straight to its visit.
--   dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE (0042) reads the certified records by their status and number (6 with its desktop
--                                   number, 16 with its site number), not by the level's AssessmentMode, and a higher level
--                                   certified at the desktop ends a lower level's surveillance too.
--   dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT, SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT (the desktop assessor's final submit): the desktop
--                                   NCs for a level certified at the desktop (FN_V4_LEVEL_DESKTOP), not for the name Bronze.
--   dbo.SectionTypes.AssessmentMode is put in step with AssessmentFlow (Desktop only = 'Desktop', else 'Site') for the three
--                                   legacy levels too, so every reader of AssessmentMode agrees with the flow.
-- Surveillance (ZED_SURVEILLANCE): dbo.FN_V4_LEVEL_DESKTOP over its own SectionTypes copy (migration 0072 there).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE')
    THROW 50078, '0078 runs on ZEDCS_V2_LIVE and ZED_SURVEILLANCE.', 1;
IF COL_LENGTH('dbo.SectionTypes', 'AssessmentFlow') IS NULL OR COL_LENGTH('dbo.SectionTypes', 'AssessmentMode') IS NULL
    THROW 50078, 'Run 0028 and 0072 first (SectionTypes.AssessmentMode, AssessmentFlow).', 1;
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_LEVEL_DESKTOP (@Code varchar(50))
RETURNS bit
AS
BEGIN
    -- V4 0078: certified at the desktop (flow Desktop only); see the header of migration 0078.
    DECLARE @flow varchar(20), @mode varchar(10), @found bit = 0;
    SELECT TOP (1) @flow = NULLIF(LTRIM(RTRIM(AssessmentFlow)), ''), @mode = AssessmentMode, @found = 1
    FROM dbo.SectionTypes WHERE SectionType = @Code AND IsCertificationLevel = 1;
    IF @flow IS NOT NULL RETURN CASE WHEN @flow = 'Desktop' THEN 1 ELSE 0 END;
    IF @Code = 'Bronze' RETURN 1;
    IF @Code IN ('Silver', 'Gold') RETURN 0;
    RETURN CASE WHEN @found = 1 AND @mode = 'Desktop' THEN 1 ELSE 0 END;
END
GO

-- ---------------------------------------------------------------------------------------------------------
-- Main only from here.
-- ---------------------------------------------------------------------------------------------------------
-- (Each main-only step checks the database: a CREATE of the procedures below would not even compile on ZED_SURVEILLANCE,
-- whose MsmeCertifications has no DesktopVerificationDate; so they run through sp_executesql there.)
-- The three legacy levels: AssessmentMode in step with the flow (no flow: Bronze 'Desktop', Silver / Gold 'Site').
IF DB_NAME() = N'ZEDCS_V2_LIVE'
UPDATE dbo.SectionTypes
SET AssessmentMode = CASE
        WHEN NULLIF(LTRIM(RTRIM(AssessmentFlow)), '') IS NOT NULL THEN CASE WHEN AssessmentFlow = 'Desktop' THEN 'Desktop' ELSE 'Site' END
        WHEN SectionType = 'Bronze' THEN 'Desktop' ELSE 'Site' END
WHERE IsCertificationLevel = 1 AND SectionType IN ('Bronze', 'Silver', 'Gold')
  AND ISNULL(AssessmentMode, '') <> CASE
        WHEN NULLIF(LTRIM(RTRIM(AssessmentFlow)), '') IS NOT NULL THEN CASE WHEN AssessmentFlow = 'Desktop' THEN 'Desktop' ELSE 'Site' END
        WHEN SectionType = 'Bronze' THEN 'Desktop' ELSE 'Site' END;
GO
IF DB_NAME() = N'ZEDCS_V2_LIVE'
EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.SP_V4_SKIP_DESKTOP
    @ZedId varchar(50),
    @Certification varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @flow varchar(20) = (SELECT TOP 1 AssessmentFlow FROM dbo.SectionTypes WHERE SectionType = @Certification AND IsCertificationLevel = 1);
    -- V4 0078: Bronze too (every level can have every flow).
    IF ISNULL(@flow, '''') NOT IN (''Remote'', ''Onsite'')
    BEGIN
        SELECT CAST(0 AS bit) AS Skipped, ''The level has a desktop step.'' AS Reason;
        RETURN;
    END;

    DECLARE @agency varchar(50) = (
        SELECT TOP 1 CertificationBodyUserId FROM dbo.MsmeCertifications
        WHERE ZedId = @ZedId AND Certification = @Certification AND CertificationStatus = 2 AND ISNULL(NcCount, 0) = 0
          AND NULLIF(CertificationBodyUserId, '''') IS NOT NULL AND NULLIF(DesktopAssessorId, '''') IS NULL);
    IF @agency IS NULL
    BEGIN
        SELECT CAST(0 AS bit) AS Skipped, ''Not a just-submitted unit with an agency.'' AS Reason;
        RETURN;
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE UserId = @agency AND RoleId = 2 AND ISNULL(SiteVerification, 0) = 1)
    BEGIN
        UPDATE dbo.MsmeCertifications SET CertificationBodyUserId = NULL
        WHERE ZedId = @ZedId AND Certification = @Certification AND CertificationStatus = 2 AND CertificationBodyUserId = @agency;
        INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
        VALUES (@ZedId, CONCAT(''Agency '', @agency, '' has no site verification: to be allotted by the Master Admin''), GETDATE(), @Certification, ''AgencyNeeded'');
        SELECT CAST(0 AS bit) AS Skipped, ''The agency has no site verification.'' AS Reason;
        RETURN;
    END;

    UPDATE dbo.MsmeCertifications SET CertificationStatus = 6, CertificationStatusDate = GETDATE()
    WHERE ZedId = @ZedId AND Certification = @Certification AND CertificationStatus = 2 AND CertificationBodyUserId = @agency;
    INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
    VALUES (@ZedId, CONCAT(CASE @flow WHEN ''Remote'' THEN ''Remote'' ELSE ''Onsite'' END, '' assessment without a desktop step, from '', FORMAT(GETDATE(), ''MMMM d, yyyy'')),
            GETDATE(), @Certification, ''DesktopSkipped'');
    SELECT CAST(1 AS bit) AS Skipped, NULL AS Reason;
END;';
GO
IF DB_NAME() = N'ZEDCS_V2_LIVE'
EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.SP_V4_DA_FINAL_SUBMIT
    @UserId varchar(50) = NULL,
    @ZedId varchar(50) = NULL,
    @CertificationType varchar(50) = NULL,
    @QrCodeSeqNo varchar(50) = NULL
AS
BEGIN
    -- V4 0078: the agency''s desktop final submit by the level''s flow (header of migration 0078).
    SET NOCOUNT ON;
    DECLARE @desktop bit = dbo.FN_V4_LEVEL_DESKTOP(@CertificationType);

    IF @CertificationType = ''Bronze'' AND @desktop = 0
    BEGIN
        -- A Bronze with a visit: on to the visit, as the legacy procedure does for Silver / Gold.
        UPDATE dbo.MsmeCertifications SET CertificationStatusDate = GETDATE(), CertificationStatus = 6, DesktopVerificationDate = GETDATE()
        WHERE ZedId = @ZedId AND Certification = @CertificationType;
        INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
        VALUES (@ZedId, CONCAT(''Completed On '', FORMAT(GETDATE(), ''MMMM d, yyyy'')), GETDATE(), @CertificationType, ''DesktopVerification'');
        RETURN;
    END;

    -- A desktop-only Silver / Gold, and a desktop-only V4 level the legacy procedure would send to a visit (ZED-X: fix
    -- main/14 treats it as a site level whatever its mode): certified here.
    IF @desktop = 1 AND (@CertificationType IN (''Silver'', ''Gold'')
        OR (@CertificationType NOT IN (''Bronze'', ''Silver'', ''Gold'') AND ISNULL(dbo.FN_V4_LEVEL_MODE(@CertificationType), ''Site'') <> ''Desktop''))
    BEGIN
        -- As the legacy procedure certifies Bronze, and for Silver / Gold as the site final submit does (QR digit, the
        -- lower levels'' certificates, benefits, consultancy hand-over); a V4 level gets its own QR digit only (fix main/14).
        DECLARE @CertificateNo varchar(50) = CONCAT(REPLACE(CONVERT(varchar, GETDATE(), 103), ''/'', ''''), ''_'', dbo.FN_V4_CERTIFICATE_SERIAL(@ZedId));
        DECLARE @PlantIdNo varchar(50) = (SELECT TOP (1) PlantIdNo FROM dbo.Msme WHERE ZedId = @ZedId);

        IF EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @CertificationType AND DaCertificateNo IS NOT NULL)
            UPDATE dbo.MsmeCertifications SET CertificationStatus = 6 WHERE ZedId = @ZedId AND Certification = @CertificationType;
        ELSE
            UPDATE dbo.MsmeCertifications
            SET DaCertificateNo = @CertificateNo, CertificationStatusDate = GETDATE(), CertificationStatus = 6, CertificationPhase = ''ACTIVE'',
                DesktopVerificationDate = GETDATE(),
                FirstSurveDueDate = DATEADD(MONTH, dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS(@CertificationType), GETDATE()),
                SecondSurveDueDate = DATEADD(MONTH, dbo.FN_V4_SECOND_SURVEILLANCE_MONTHS(@CertificationType), GETDATE())
            WHERE ZedId = @ZedId AND Certification = @CertificationType;

        UPDATE dbo.MsmeCertifications
        SET QrCodeSeqNo = CONCAT(@PlantIdNo, CASE @CertificationType WHEN ''Silver'' THEN ''3'' WHEN ''Gold'' THEN ''4'' ELSE dbo.FN_V4_LEVEL_QR_DIGIT(@CertificationType) END, @QrCodeSeqNo)
        WHERE ZedId = @ZedId AND Certification = @CertificationType;

        INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
        VALUES (@ZedId, CONCAT(''Completed On '', FORMAT(GETDATE(), ''MMMM d, yyyy'')), GETDATE(), @CertificationType, ''Completed'');
        INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
        VALUES (@ZedId, CONCAT(''Certificate & Report generated on '', FORMAT(GETDATE(), ''MMMM d, yyyy'')), GETDATE(), @CertificationType, ''GetCertified'');
        IF @CertificationType NOT IN (''Silver'', ''Gold'') RETURN;

        -- The lower levels'' certificates end, whichever way they were certified.
        UPDATE dbo.MsmeCertifications
        SET CertificationPhase = ''UPGRADED'', RestrictMail = CONCAT(@CertificationType, '' Certified''), FirstSurveDueDate = NULL, SecondSurveDueDate = NULL
        WHERE ZedId = @ZedId
          AND ((Certification = ''Bronze'') OR (Certification = ''Silver'' AND @CertificationType = ''Gold''))
          AND ((CertificationStatus = 6 AND DaCertificateNo IS NOT NULL) OR (CertificationStatus = 16 AND SaCertificateNo IS NOT NULL));

        IF CHARINDEX(''_R_'', @ZedId) = 0
            UPDATE BI SET BI.IsEligibleForBenefits = 1
            FROM dbo.MsmeBasicInformation BI
            JOIN dbo.MsmeCertifications C ON BI.ZedId = C.ZedId
            WHERE BI.ZedId = @ZedId AND C.Certification = @CertificationType AND C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL
              AND C.CertificationPhase = ''ACTIVE'' AND BI.IsEligibleForBenefits = 0;

        EXEC dbo.SP_MOVING_CERTIFIED_MSME_TO_CONSULTANCY @ZedId, @CertificationType;
        RETURN;
    END;

    EXEC dbo.SP_MONITORING_DA_FINAL_SUBMIT @UserId = @UserId, @ZedId = @ZedId, @CertificationType = @CertificationType, @QrCodeSeqNo = @QrCodeSeqNo;
END;';
GO
IF DB_NAME() = N'ZEDCS_V2_LIVE'
EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE dbo.SP_V4_RA_FINAL_SUBMIT
    @UserId varchar(50) = NULL,
    @ZedId varchar(50) = NULL,
    @CertificationType varchar(50) = NULL,
    @QrCodeSeqNo varchar(50) = NULL
AS
BEGIN
    -- V4 0078: the agency''s final submit after the visit (header of migration 0078).
    SET NOCOUNT ON;
    IF @CertificationType = ''Bronze''
    BEGIN
        -- A Bronze with a visit: certified here (the legacy procedure has no Bronze branch: it would take Gold''s).
        DECLARE @CertificateNo varchar(50) = CONCAT(REPLACE(CONVERT(varchar, GETDATE(), 103), ''/'', ''''), ''_'', dbo.FN_V4_CERTIFICATE_SERIAL(@ZedId));
        DECLARE @PlantIdNo varchar(50) = (SELECT TOP (1) PlantIdNo FROM dbo.Msme WHERE ZedId = @ZedId);

        IF EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @CertificationType AND SaCertificateNo IS NOT NULL)
            UPDATE dbo.MsmeCertifications SET CertificationStatus = 16 WHERE ZedId = @ZedId AND Certification = @CertificationType;
        ELSE
            UPDATE dbo.MsmeCertifications
            SET SaCertificateNo = @CertificateNo, CertificationStatusDate = GETDATE(), CertificationStatus = 16, CertificationPhase = ''ACTIVE'',
                FirstSurveDueDate = DATEADD(MONTH, dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS(@CertificationType), GETDATE()),
                SecondSurveDueDate = DATEADD(MONTH, dbo.FN_V4_SECOND_SURVEILLANCE_MONTHS(@CertificationType), GETDATE())
            WHERE ZedId = @ZedId AND Certification = @CertificationType;

        UPDATE dbo.MsmeCertifications SET QrCodeSeqNo = CONCAT(@PlantIdNo, ''2'', @QrCodeSeqNo)
        WHERE ZedId = @ZedId AND Certification = @CertificationType;

        IF CHARINDEX(''_R_'', @ZedId) = 0
            UPDATE BI SET BI.IsEligibleForBenefits = 1
            FROM dbo.MsmeBasicInformation BI
            JOIN dbo.MsmeCertifications C ON BI.ZedId = C.ZedId
            WHERE BI.ZedId = @ZedId AND C.Certification = @CertificationType AND C.CertificationStatus = 16
              AND C.CertificationPhase = ''ACTIVE'' AND BI.IsEligibleForBenefits = 0;

        INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
        VALUES (@ZedId, CONCAT(''Completed On '', FORMAT(GETDATE(), ''MMMM d, yyyy'')), GETDATE(), @CertificationType, ''Completed'');
        INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
        VALUES (@ZedId, CONCAT(''Certificate & Report generated on '', FORMAT(GETDATE(), ''MMMM d, yyyy'')), GETDATE(), @CertificationType, ''GetCertified'');
        EXEC dbo.SP_MOVING_CERTIFIED_MSME_TO_CONSULTANCY @ZedId, @CertificationType;
        RETURN;
    END;

    EXEC dbo.SP_MONITORING_RA_FINAL_SUBMIT @UserId = @UserId, @ZedId = @ZedId, @CertificationType = @CertificationType, @QrCodeSeqNo = @QrCodeSeqNo;

    -- The legacy procedure ends the lower levels'' certificates where it expects them (Bronze at 6, Silver at 16); a lower
    -- level certified the other way (Bronze after a visit at 16, Silver at the desktop at 6) ends here.
    IF @CertificationType IN (''Silver'', ''Gold'')
       AND EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationStatus = 16)
        UPDATE dbo.MsmeCertifications
        SET CertificationPhase = ''UPGRADED'', RestrictMail = CONCAT(@CertificationType, '' Certified''), FirstSurveDueDate = NULL, SecondSurveDueDate = NULL
        WHERE ZedId = @ZedId
          AND ((Certification = ''Bronze'' AND CertificationStatus = 16 AND SaCertificateNo IS NOT NULL)
            OR (Certification = ''Silver'' AND @CertificationType = ''Gold'' AND CertificationStatus = 6 AND DaCertificateNo IS NOT NULL))
          AND ISNULL(CertificationPhase, '''') <> ''UPGRADED'';
END;';
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; the same in 0044 to 0077). #V4_EDIT_PROCEDURE edits one procedure of this
-- database in place: it reads the live definition, applies the replacements listed for it in #V4_EDITS (each Find
-- must occur exactly Expect times, or at least once when Expect is NULL), turns CREATE into ALTER (permissions are
-- kept) and runs it with the procedure's own ANSI_NULLS / QUOTED_IDENTIFIER. A definition that already contains
-- @Marker (code text of the edit, never a comment) is left alone. Any difference raises an error.
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
CREATE TABLE #V4_EDITS (Obj nvarchar(300) NOT NULL, Seq int NOT NULL, Find nvarchar(max) NOT NULL, Replacement nvarchar(max) NOT NULL, Expect int NULL);
GO
IF OBJECT_ID('tempdb..#V4_EDIT_PROCEDURE') IS NOT NULL DROP PROCEDURE #V4_EDIT_PROCEDURE;
GO
CREATE PROCEDURE #V4_EDIT_PROCEDURE
    @Object nvarchar(300),
    @Marker nvarchar(400),
    @Optional bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id int = OBJECT_ID(@Object, 'P'), @msg nvarchar(2048);
    IF @id IS NULL
    BEGIN
        IF @Optional = 1 BEGIN PRINT CONCAT(DB_NAME(), N'.', @Object, N': not in this database, skipped.'); RETURN; END;
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': not found.');
        THROW 50040, @msg, 1;
    END
    DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@id);
    IF CHARINDEX(@Marker, @def) > 0
    BEGIN
        PRINT CONCAT(DB_NAME(), N'.', @Object, N': already edited.');
        RETURN;
    END

    DECLARE @seq int, @find nvarchar(max), @rep nvarchar(max), @expect int, @count int;
    DECLARE e CURSOR LOCAL FAST_FORWARD FOR SELECT Seq, Find, Replacement, Expect FROM #V4_EDITS WHERE Obj = @Object ORDER BY Seq;
    OPEN e;
    FETCH NEXT FROM e INTO @seq, @find, @rep, @expect;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @count = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @find, N''))) / DATALENGTH(@find);
        IF (@expect IS NULL AND @count = 0) OR (@expect IS NOT NULL AND @count <> @expect)
        BEGIN
            SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': replacement ', @seq, N' found ', @count, N' time(s), expected ',
                ISNULL(CAST(@expect AS nvarchar(10)), N'at least 1'), N'. The live definition differs from the reviewed one: nothing was changed.');
            THROW 50041, @msg, 1;
        END
        SET @def = REPLACE(@def, @find, @rep);
        FETCH NEXT FROM e INTO @seq, @find, @rep, @expect;
    END
    CLOSE e;
    DEALLOCATE e;

    -- CREATE -> ALTER: the first word outside comments.
    DECLARE @i int = 1, @j int, @len int = LEN(@def + N'x') - 1;
    WHILE @i <= @len
    BEGIN
        IF SUBSTRING(@def, @i, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @i += 1;
        ELSE IF SUBSTRING(@def, @i, 2) = N'--'
        BEGIN
            SET @j = CHARINDEX(NCHAR(10), @def, @i);
            SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 1 END;
        END
        ELSE IF SUBSTRING(@def, @i, 2) = N'/*'
        BEGIN
            SET @j = CHARINDEX(N'*/', @def, @i + 2);
            SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 2 END;
        END
        ELSE BREAK;
    END
    IF UPPER(SUBSTRING(@def, @i, 6)) <> N'CREATE'
    BEGIN
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': the definition does not start with CREATE.');
        THROW 50042, @msg, 1;
    END
    SET @def = STUFF(@def, @i, 6, N'ALTER');
    -- typed as CREATE OR ALTER: ALTER OR ALTER -> ALTER
    SET @j = @i + 5;
    WHILE SUBSTRING(@def, @j, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @j += 1;
    IF UPPER(SUBSTRING(@def, @j, 3)) IN (N'OR ', N'OR' + NCHAR(9), N'OR' + NCHAR(10), N'OR' + NCHAR(13))
    BEGIN
        DECLARE @k int = CHARINDEX(N'ALTER', @def, @j);
        SET @def = STUFF(@def, @j, @k + 5 - @j, N'');
    END

    DECLARE @sql nvarchar(400) = CONCAT(N'SET ANSI_NULLS ', CASE WHEN OBJECTPROPERTY(@id, 'ExecIsAnsiNullsOn') = 1 THEN N'ON' ELSE N'OFF' END,
        N'; SET QUOTED_IDENTIFIER ', CASE WHEN OBJECTPROPERTY(@id, 'ExecIsQuotedIdentOn') = 1 THEN N'ON' ELSE N'OFF' END, N'; EXEC sys.sp_executesql @d;');
    EXEC sys.sp_executesql @sql, N'@d nvarchar(max)', @d = @def;
    IF CHARINDEX(@Marker, OBJECT_DEFINITION(@id)) = 0
    BEGIN
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': the procedure was not altered as expected.');
        THROW 50043, @msg, 1;
    END
    PRINT CONCAT(DB_NAME(), N'.', @Object, N': edited.');
END
GO
-- SP_V4_LEVEL_SURVEILLANCE_SCHEDULE (0037 / 0042): the certified records by their own status and number, not by the
-- level's AssessmentMode (a level's flow may change while its certificates run), and a higher level certified at the desktop
-- (6 with its number) ends a lower level's surveillance as one certified at 16 does.
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE', 1,
N'OR (C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL AND T.AssessmentMode = ''Desktop''))',
N'OR (C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL))', 1),
(N'dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE', 2,
N'(@desktop = 0 AND C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL)',
N'(C.CertificationStatus IN (16) AND C.SaCertificateNo IS NOT NULL)', 1),
(N'dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE', 3,
N'(@desktop = 1 AND C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL)',
N'(C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL)', 1),
(N'dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE', 4,
N'AND ISNULL(TX.OrderNo, 0) > @o AND X.CertificationStatus = 16);',
N'AND ISNULL(TX.OrderNo, 0) > @o AND (X.CertificationStatus = 16 OR (X.CertificationStatus = 6 AND X.DaCertificateNo IS NOT NULL)));', 1),
-- The desktop assessor's final submit raises the desktop NCs of a level certified at the desktop (its flow Desktop only:
-- Bronze by default, now also a desktop-only Silver / Gold / added level); a level with a visit (now also a Bronze with
-- one) goes to the agency as Silver always did, its NCs raised at the visit. The branch itself is generic over the level.
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 1,
N'IF @CertificationType=''Bronze''',
N'IF dbo.FN_V4_LEVEL_DESKTOP(@CertificationType) = 1', 1),
(N'dbo.SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT', 1,
N'@CertificationType=''Bronze'' and (select count(*)',
N'dbo.FN_V4_LEVEL_DESKTOP(@CertificationType) = 1 and (select count(*)', 3);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DB_NAME() = N'ZEDCS_V2_LIVE' AND OBJECT_ID(N'dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE', N'P') IS NOT NULL
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE', @Marker = N'CertificationStatus IN (16)';
IF DB_NAME() = N'ZEDCS_V2_LIVE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', @Marker = N'IF dbo.FN_V4_LEVEL_DESKTOP(@CertificationType) = 1';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT', @Marker = N'dbo.FN_V4_LEVEL_DESKTOP(@CertificationType) = 1 and';
END
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
PRINT '0078: level flows ready on ' + DB_NAME() + '.';
GO
