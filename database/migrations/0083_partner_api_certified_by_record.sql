-- Run on ZEDCS_V2_LIVE, after 0047 (the expiry date by the level's validity) and 0079 (the record rule); fix 12 (API token
-- logging) may have run before or not. Safe to re-run: the procedure is skipped once edited.
--
-- 2026-11-15 (the user): SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS, the Andhra Pradesh partner API (Silver / Gold, applied from
-- 2026-04-01), read "certified" as status 16 with the site number. Since 0078 a Silver / Gold can be certified at the desktop
-- (status 6, DaCertificateNo), which this API showed as "Assessment in progress". Its Certification branch now reads it by
-- the record, as 0079:
--   certified            CertificationStatus = 16
--                        OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))
--   CertificateNumber    the desktop number for a record certified at 6, else SaCertificateNo as before
--   CertifiedDate, CertificateExpiryDate, ApplicationStatus 'Certified'  also for a record certified at 6
-- A Silver / Gold waiting at 6 for its visit (no number, no phase) stays "Assessment in progress"; every record of today
-- (certified at 16) answers the same. The level filter (not Bronze), the Handholding branch, the paging and the token
-- logging are unchanged. Edited in place by exact replacement (helper as in 0079): a live text that differs from the
-- reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50083, '0083 runs on ZEDCS_V2_LIVE.', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; as in 0079). #V4_EDIT_PROCEDURE edits one procedure of this
-- database in place: it reads the live definition, applies the replacements listed for it in #V4_EDITS (each Find
-- must occur exactly Expect times, at least once when Expect is NULL, any number of times when Expect is -1), turns
-- CREATE into ALTER (permissions are kept) and runs it with the procedure's own ANSI_NULLS / QUOTED_IDENTIFIER. A
-- definition that already contains @Marker (code text of the edit, never a comment) is left alone. Any difference
-- raises an error.
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
        IF (@expect IS NULL AND @count = 0) OR (@expect IS NOT NULL AND @expect <> -1 AND @count <> @expect)
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
-- The edits (the Certification branch only)
-- ---------------------------------------------------------------------------------------------------------
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS', 1,
N'C.SaCertificateNo AS CertificateNumber,',
N'CASE WHEN (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)) THEN C.DaCertificateNo ELSE C.SaCertificateNo END AS CertificateNumber,',
1),
(N'dbo.SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS', 2,
N'case when C.CertificationStatus in (16,99) then FORMAT(C.CertificationStatusDate, ''dd/MM/yyyy'')',
N'case when C.CertificationStatus in (16,99) OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)) then FORMAT(C.CertificationStatusDate, ''dd/MM/yyyy'')',
1),
(N'dbo.SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS', 3,
N'WHEN C.CertificationStatus = 16 THEN FORMAT(DATEADD(',
N'WHEN C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)) THEN FORMAT(DATEADD(',
1),
(N'dbo.SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS', 4,
N'WHEN CertificationStatus in (2,3,5,6,8,9,13,14,15,17) THEN ''Assessment in progress''',
N'WHEN (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)) THEN ''Certified''
		WHEN CertificationStatus in (2,3,5,6,8,9,13,14,15,17) THEN ''Assessment in progress''',
1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_API_GET_STATE_CERTIFIED_UNIT_DETAILS', @Marker = N'WHEN (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)) THEN ''Certified''';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
