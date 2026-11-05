-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (deploy\Invoke-ZedDatabaseScripts.ps1 does). Safe to re-run;
-- each database's edits are one transaction (all or nothing).
--
-- A certificate's expiry from its level's validity (Admin -> Certification Levels, SectionTypes.ValidityMonths on main,
-- 36 months by default) instead of a fixed 3 years, where it is shown or given out (migration 0046 did the expiry job and
-- the renewal mail; the certificates print the validity themselves):
--   dbo.FN_V4_VALIDITY_MONTHS(@Certification): the level's validity in months (36 when the level or its setting is
--     missing); in ZED_CONSULTANT and ZED_SURVEILLANCE it reads main's levels (ZEDCS_V2_LIVE.dbo.SectionTypes).
--   SP_VERIFY_QR_CODE (main, ZED_CONSULTANT): DateOfExpiry on the QR verification page.
--   The certified-unit APIs for other systems: SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM (main, ZED_CONSULTANT,
--     ZED_SURVEILLANCE: the expiry date), SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_MULTIPLE_UDYAMS (the expiry date and the
--     expired flag), SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS (the expiry date), SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_
--     AND_ZEDID (ValidUpto).
-- With every level at 36 months nothing changes. The procedures are edited in place by exact replacement (helper below;
-- fix main\12_api_token_logging.sql edits other parts of the API procedures, in either order): a live text that differs
-- from the reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50047, '0047 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
IF DB_NAME() = N'ZEDCS_V2_LIVE'
    EXEC sys.sp_executesql N'CREATE OR ALTER FUNCTION dbo.FN_V4_VALIDITY_MONTHS (@Certification varchar(50))
RETURNS int
AS
BEGIN
    -- V4 0047: the level''s certificate validity in months (Admin -> Certification Levels); 36 when not set.
    DECLARE @Months int = (SELECT TOP (1) ValidityMonths FROM dbo.SectionTypes WHERE SectionType = @Certification);
    RETURN CASE WHEN @Months >= 1 THEN @Months ELSE 36 END;
END';
ELSE
    EXEC sys.sp_executesql N'CREATE OR ALTER FUNCTION dbo.FN_V4_VALIDITY_MONTHS (@Certification varchar(50))
RETURNS int
AS
BEGIN
    -- V4 0047: the level''s certificate validity in months (main''s Admin -> Certification Levels); 36 when not set.
    DECLARE @Months int = (SELECT TOP (1) ValidityMonths FROM ZEDCS_V2_LIVE.dbo.SectionTypes WHERE SectionType = @Certification);
    RETURN CASE WHEN @Months >= 1 THEN @Months ELSE 36 END;
END';
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; the same in 0044 to 0046). #V4_EDIT_PROCEDURE edits one procedure of this
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
-- ---------------------------------------------------------------------------------------------------------
-- The edits (only the procedures this database has are listed)
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_UDYAM', 1,
N'dateadd(yy,3,CertificationStatusDate)',
N'DATEADD(MONTH, dbo.FN_V4_VALIDITY_MONTHS(Certification), CertificationStatusDate)', 1);
IF DB_NAME() <> N'ZED_SURVEILLANCE'
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_VERIFY_QR_CODE', 1,
N'dateadd(yy,3,CertificationStatusDate)',
N'DATEADD(MONTH, dbo.FN_V4_VALIDITY_MONTHS(@CertificationType), CertificationStatusDate)', 1);
IF DB_NAME() = N'ZEDCS_V2_LIVE'
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_MULTIPLE_UDYAMS', 1,
N'dateadd(yy,3,C.CertificationStatusDate)',
N'DATEADD(MONTH, dbo.FN_V4_VALIDITY_MONTHS(C.Certification), C.CertificationStatusDate)', NULL),
(N'dbo.SP_API_GET_CERTIFIED_UNIT_DETAILS_BY_MULTIPLE_UDYAMS', 2,
N'DATEADD(YEAR, 3, C.CertificationStatusDate)',
N'DATEADD(MONTH, dbo.FN_V4_VALIDITY_MONTHS(C.Certification), C.CertificationStatusDate)', NULL),
(N'dbo.SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS', 1,
N'DATEADD(year, 3, C.CertificationStatusDate)',
N'DATEADD(MONTH, dbo.FN_V4_VALIDITY_MONTHS(C.Certification), C.CertificationStatusDate)', NULL),
(N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID', 1,
N'DATEADD(YEAR, 3, CertificationStatusDate)',
N'DATEADD(MONTH, dbo.FN_V4_VALIDITY_MONTHS(Certification), CertificationStatusDate)', NULL);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @proc nvarchar(300);
DECLARE p CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT Obj FROM #V4_EDITS ORDER BY Obj;
OPEN p;
FETCH NEXT FROM p INTO @proc;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = @proc, @Marker = N'FN_V4_VALIDITY_MONTHS';
    FETCH NEXT FROM p INTO @proc;
END
CLOSE p;
DEALLOCATE p;
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
