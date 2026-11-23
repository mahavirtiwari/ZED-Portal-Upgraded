-- Run on ZED_CONSULTANT first, then ZEDCS_V2_LIVE and ZED_SURVEILLANCE (deploy\Invoke-ZedDatabaseScripts.ps1 does): main's
-- and ZED_SURVEILLANCE's SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS then read ZED_CONSULTANT's new tables. Safe to re-run:
-- each table is created once, the copy is made once (extended property V4_0113_Seeded on ZED_CONSULTANT.dbo.Sections), an
-- edited procedure (it has /*V4_0113*/) is left alone. Every procedure edit is one transaction (all or nothing).
--
-- 2026-11-23 (the user, via questions): the staff "Questionnaire of" switch also offers Consultancy, as its OWN editable
-- questionnaire: started as a copy of the ZED Certification questionnaire (the parameters used in consultancy), then edited
-- separately. Edits on Consultancy do not change ZED Certification, and the other way round.
--
-- 1. ZED_CONSULTANT gets the legacy questionnaire master tables it never had (database/README.md): dbo.Sections,
--    dbo.Requirements, dbo.Options, dbo.SubOptions, dbo.Evidences, with ZED_SURVEILLANCE's columns (the V4 ones included:
--    NicSectors, IsDisabled, Purpose, Benefits, VideoUrl, ActionsNeeded, OptionCode, SampleFile). ZED_CONSULTANT already
--    has the same SP_MASTER_* procedures as ZED_SURVEILLANCE (they failed only for want of these tables), so the Admin's
--    Questionnaire pages work on the Consultancy portal's own API unchanged.
-- 2. The copy: every level's parameters of ZEDCS_V2_LIVE with InConsultancy <> 'No' (0035; NULL = used), with their
--    requirements, options, sub-options and evidences, keeping their Id (the handholding copies units already have keep
--    pointing at the same rows) and their Disabled / NIC sectors. Made once, only while ZED_CONSULTANT.dbo.Sections is
--    empty. From then on main's Sections.InConsultancy is no longer read (the Admin disables a parameter in the
--    Consultancy questionnaire instead).
-- 3. The procedures that copy a level's questionnaire into a unit's handholding copy (ZED_CONSULTANT.dbo.MsmeSections,
--    MsmeRequirements, MsmeOptions, MsmeSubOptions, MsmeEvidences) at a milestone payment read ZED_CONSULTANT's tables
--    instead of main's:
--      ZEDCS_V2_LIVE     SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS (gateway, zero-amount payments)
--      ZED_SURVEILLANCE  SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS (same procedure; it read ZED_SURVEILLANCE's tables)
--      ZED_CONSULTANT    SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS, SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO
--                        (staff "update payment status"), SP_MSME_ZERO_PAYMENT_DETAILS (fee paid at milestone 1)
--    Only the source table of each copy changes (exact replacement, helper below as 0044 / 0112: a text that differs from
--    the reviewed one stops the script and changes nothing). The parameters the Admin disabled, or of another NIC sector,
--    are then taken out of the copy just made (Zed.Portal ConsultancyParameters), as main's SP_V4_CERTIFICATION_PAID does.
-- The sample copies of the evidences (Evidences.SampleFile, Uploads/EvidenceSamples) need no copy: the Consultancy portal's
-- Portal__StorageRoot is main's folder (deploy\settings.example.json).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50113, '0113 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE only.', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- 1. ZED_CONSULTANT: the tables (ZED_SURVEILLANCE's columns; a primary key on Id, which the legacy tables lack).
-- ---------------------------------------------------------------------------------------------------------
IF DB_NAME() = N'ZED_CONSULTANT' AND OBJECT_ID(N'dbo.Sections', N'U') IS NULL
    CREATE TABLE dbo.Sections (
        Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sections PRIMARY KEY,
        SectionCode varchar(50) NULL, SectionName varchar(500) NULL, OrderNo int NULL, iButton varchar(2000) NULL,
        SectionImage varchar(500) NULL, SectionType varchar(50) NULL, TblSectionSchemeId int NULL,
        NicSectors varchar(2000) NULL, IsDisabled bit NULL);
IF DB_NAME() = N'ZED_CONSULTANT' AND OBJECT_ID(N'dbo.Requirements', N'U') IS NULL
    CREATE TABLE dbo.Requirements (
        Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_Requirements PRIMARY KEY,
        SectionCode varchar(50) NULL, SectionName varchar(50) NULL, QuestionCode varchar(50) NULL, QuestionName varchar(2000) NULL,
        RequirementCode varchar(50) NULL, RequirementName varchar(5000) NULL, OrderNo int NULL, SectionType varchar(50) NULL,
        Purpose nvarchar(1000) NULL, Benefits nvarchar(1000) NULL, VideoUrl nvarchar(1000) NULL);
IF DB_NAME() = N'ZED_CONSULTANT' AND OBJECT_ID(N'dbo.Options', N'U') IS NULL
    CREATE TABLE dbo.Options (
        Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_Options PRIMARY KEY,
        SectionCode varchar(50) NULL, QuestionCode varchar(50) NULL, OptionCode varchar(50) NULL, OptionName varchar(5000) NULL,
        OptionImage varchar(500) NULL, RequirementCode varchar(50) NULL, SectionType varchar(50) NULL, ActionsNeeded nvarchar(max) NULL);
IF DB_NAME() = N'ZED_CONSULTANT' AND OBJECT_ID(N'dbo.SubOptions', N'U') IS NULL
    CREATE TABLE dbo.SubOptions (
        Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_SubOptions PRIMARY KEY,
        SectionCode varchar(50) NULL, QuestionCode varchar(50) NULL, OptionCode varchar(50) NULL, SubOptionCode varchar(50) NULL,
        SubOptionName varchar(2000) NULL, RequirementCode varchar(50) NULL, SubOptionImage varchar(500) NULL, SectionType varchar(50) NULL);
IF DB_NAME() = N'ZED_CONSULTANT' AND OBJECT_ID(N'dbo.Evidences', N'U') IS NULL
    CREATE TABLE dbo.Evidences (
        Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_Evidences PRIMARY KEY,
        SectionCode varchar(50) NULL, RequirementCode varchar(50) NULL, EvidenceCode varchar(50) NULL, EvidenceName varchar(5000) NULL,
        SectionType varchar(50) NULL, EvidenceType bit NULL, ValidationRequired bit NULL, HelpText nvarchar(max) NULL,
        OptionCode varchar(50) NULL, SampleFile varchar(200) NULL);
GO
-- ---------------------------------------------------------------------------------------------------------
-- 2. ZED_CONSULTANT: the copy of main's questionnaire (once).
-- ---------------------------------------------------------------------------------------------------------
IF DB_NAME() = N'ZED_CONSULTANT'
   AND NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0 AND major_id = OBJECT_ID(N'dbo.Sections') AND name = N'V4_0113_Seeded')
BEGIN
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    IF NOT EXISTS (SELECT 1 FROM dbo.Sections)
    BEGIN
        DECLARE @Used TABLE (SectionType varchar(50) NOT NULL, SectionCode varchar(50) NOT NULL, PRIMARY KEY (SectionType, SectionCode));
        INSERT INTO @Used (SectionType, SectionCode)
            SELECT DISTINCT LTRIM(RTRIM(SectionType)), LTRIM(RTRIM(SectionCode)) FROM ZEDCS_V2_LIVE.dbo.Sections
            WHERE SectionType IS NOT NULL AND SectionCode IS NOT NULL AND ISNULL(LTRIM(RTRIM(InConsultancy)), '') <> 'No';

        SET IDENTITY_INSERT dbo.Sections ON;
        INSERT INTO dbo.Sections (Id, SectionCode, SectionName, OrderNo, iButton, SectionImage, SectionType, TblSectionSchemeId, NicSectors, IsDisabled)
            SELECT s.Id, s.SectionCode, s.SectionName, s.OrderNo, s.iButton, s.SectionImage, s.SectionType, s.TblSectionSchemeId, s.NicSectors, s.IsDisabled
            FROM ZEDCS_V2_LIVE.dbo.Sections s JOIN @Used u ON u.SectionType = LTRIM(RTRIM(s.SectionType)) AND u.SectionCode = LTRIM(RTRIM(s.SectionCode))
            ORDER BY s.Id;
        SET IDENTITY_INSERT dbo.Sections OFF;

        SET IDENTITY_INSERT dbo.Requirements ON;
        INSERT INTO dbo.Requirements (Id, SectionCode, SectionName, QuestionCode, QuestionName, RequirementCode, RequirementName, OrderNo, SectionType, Purpose, Benefits, VideoUrl)
            SELECT r.Id, r.SectionCode, r.SectionName, r.QuestionCode, r.QuestionName, r.RequirementCode, r.RequirementName, r.OrderNo, r.SectionType, r.Purpose, r.Benefits, r.VideoUrl
            FROM ZEDCS_V2_LIVE.dbo.Requirements r JOIN @Used u ON u.SectionType = LTRIM(RTRIM(r.SectionType)) AND u.SectionCode = LTRIM(RTRIM(r.SectionCode))
            ORDER BY r.Id;
        SET IDENTITY_INSERT dbo.Requirements OFF;

        SET IDENTITY_INSERT dbo.Options ON;
        INSERT INTO dbo.Options (Id, SectionCode, QuestionCode, OptionCode, OptionName, OptionImage, RequirementCode, SectionType, ActionsNeeded)
            SELECT o.Id, o.SectionCode, o.QuestionCode, o.OptionCode, o.OptionName, o.OptionImage, o.RequirementCode, o.SectionType, o.ActionsNeeded
            FROM ZEDCS_V2_LIVE.dbo.Options o JOIN @Used u ON u.SectionType = LTRIM(RTRIM(o.SectionType)) AND u.SectionCode = LTRIM(RTRIM(o.SectionCode))
            ORDER BY o.Id;
        SET IDENTITY_INSERT dbo.Options OFF;

        SET IDENTITY_INSERT dbo.SubOptions ON;
        INSERT INTO dbo.SubOptions (Id, SectionCode, QuestionCode, OptionCode, SubOptionCode, SubOptionName, RequirementCode, SubOptionImage, SectionType)
            SELECT x.Id, x.SectionCode, x.QuestionCode, x.OptionCode, x.SubOptionCode, x.SubOptionName, x.RequirementCode, x.SubOptionImage, x.SectionType
            FROM ZEDCS_V2_LIVE.dbo.SubOptions x JOIN @Used u ON u.SectionType = LTRIM(RTRIM(x.SectionType)) AND u.SectionCode = LTRIM(RTRIM(x.SectionCode))
            ORDER BY x.Id;
        SET IDENTITY_INSERT dbo.SubOptions OFF;

        SET IDENTITY_INSERT dbo.Evidences ON;
        INSERT INTO dbo.Evidences (Id, SectionCode, RequirementCode, EvidenceCode, EvidenceName, SectionType, EvidenceType, ValidationRequired, HelpText, OptionCode, SampleFile)
            SELECT e.Id, e.SectionCode, e.RequirementCode, e.EvidenceCode, e.EvidenceName, e.SectionType, e.EvidenceType, e.ValidationRequired, e.HelpText, e.OptionCode, e.SampleFile
            FROM ZEDCS_V2_LIVE.dbo.Evidences e JOIN @Used u ON u.SectionType = LTRIM(RTRIM(e.SectionType)) AND u.SectionCode = LTRIM(RTRIM(e.SectionCode))
            ORDER BY e.Id;
        SET IDENTITY_INSERT dbo.Evidences OFF;

        DECLARE @Parameters int = (SELECT COUNT(*) FROM dbo.Sections), @Rows int = (SELECT COUNT(*) FROM dbo.Requirements);
        PRINT CONCAT(DB_NAME(), N': the Consultancy questionnaire copied from ZEDCS_V2_LIVE (', @Parameters, N' parameters, ',
            @Rows, N' requirement rows).');
    END
    EXEC sys.sp_addextendedproperty @name = N'V4_0113_Seeded', @value = N'Copied from ZEDCS_V2_LIVE (InConsultancy <> No) by migration 0113',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'Sections';
    COMMIT;
END
GO
-- Main's and ZED_SURVEILLANCE's procedures read ZED_CONSULTANT's tables: they must exist first.
IF DB_NAME() <> N'ZED_CONSULTANT' AND OBJECT_ID(N'ZED_CONSULTANT.dbo.Evidences', N'U') IS NULL
    THROW 50118, '0113: run it on ZED_CONSULTANT first.', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; as 0044, for procedures and functions). #V4_EDIT_MODULE edits one procedure or
-- function of this database in place: it reads the live definition, applies the replacements listed for it in #V4_EDITS
-- (each Find must occur exactly Expect times, at least once when Expect is NULL, any number of times when Expect is -1),
-- turns CREATE into ALTER (permissions are kept) and runs it with the module's own ANSI_NULLS / QUOTED_IDENTIFIER. A
-- definition that already contains @Marker is left alone. Any difference raises an error.
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
CREATE TABLE #V4_EDITS (Obj nvarchar(300) NOT NULL, Seq int NOT NULL, Find nvarchar(max) NOT NULL, Replacement nvarchar(max) NOT NULL, Expect int NULL);
GO
IF OBJECT_ID('tempdb..#V4_EDIT_MODULE') IS NOT NULL DROP PROCEDURE #V4_EDIT_MODULE;
GO
CREATE PROCEDURE #V4_EDIT_MODULE
    @Object nvarchar(300),
    @Marker nvarchar(400),
    @Optional bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id int = OBJECT_ID(@Object), @msg nvarchar(2048);
    IF @id IS NULL OR OBJECT_DEFINITION(@id) IS NULL
    BEGIN
        IF @Optional = 1 BEGIN PRINT CONCAT(DB_NAME(), N'.', @Object, N': not in this database, skipped.'); RETURN; END;
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': not found.');
        THROW 50114, @msg, 1;
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
        IF (@expect IS NULL AND @count = 0) OR (@expect >= 0 AND @count <> @expect)
        BEGIN
            SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': replacement ', @seq, N' found ', @count, N' time(s), expected ',
                ISNULL(CAST(@expect AS nvarchar(10)), N'at least 1'), N'. The live definition differs from the reviewed one: nothing was changed.');
            THROW 50115, @msg, 1;
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
        THROW 50116, @msg, 1;
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
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': the module was not altered as expected.');
        THROW 50117, @msg, 1;
    END
    PRINT CONCAT(DB_NAME(), N'.', @Object, N': edited.');
END
GO
-- ---------------------------------------------------------------------------------------------------------
-- 3. The handholding copy reads ZED_CONSULTANT's questionnaire.
-- ---------------------------------------------------------------------------------------------------------
-- Main and ZED_SURVEILLANCE: SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS copies "... ,@CertificationTblId FROM <table> WHERE"
-- (once per table) into ZED_CONSULTANT's Msme* tables.
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect)
SELECT N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', t.Seq,
       N',@CertificationTblId FROM ' + t.Tbl + N' WHERE',
       N',@CertificationTblId FROM /*V4_0113*/ ZED_CONSULTANT.dbo.' + t.Tbl + N' WHERE', 1
FROM (VALUES (1, N'Sections'), (2, N'Requirements'), (3, N'Options'), (4, N'SubOptions'), (5, N'Evidences')) t (Seq, Tbl);

-- ZED_CONSULTANT: three procedures copy from "ZEDCS_V2_LIVE.dbo.<table>" (once per table).
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect)
SELECT o.Obj, t.Seq, N'ZEDCS_V2_LIVE.dbo.' + t.Tbl + N' ', N'/*V4_0113*/ dbo.' + t.Tbl + N' ', 1
FROM (VALUES (N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS'), (N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO'),
             (N'dbo.SP_MSME_ZERO_PAYMENT_DETAILS')) o (Obj)
CROSS JOIN (VALUES (1, N'Sections'), (2, N'Requirements'), (3, N'Options'), (4, N'SubOptions'), (5, N'Evidences')) t (Seq, Tbl);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DB_NAME() <> N'ZED_CONSULTANT'
    EXEC #V4_EDIT_MODULE @Object = N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', @Marker = N'/*V4_0113*/';
IF DB_NAME() = N'ZED_CONSULTANT'
BEGIN
    EXEC #V4_EDIT_MODULE @Object = N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS', @Marker = N'/*V4_0113*/';
    EXEC #V4_EDIT_MODULE @Object = N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO', @Marker = N'/*V4_0113*/';
    EXEC #V4_EDIT_MODULE @Object = N'dbo.SP_MSME_ZERO_PAYMENT_DETAILS', @Marker = N'/*V4_0113*/';
END
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_MODULE;
DROP TABLE #V4_EDITS;
GO
