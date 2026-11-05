-- Run on ZEDCS_V2_LIVE only, after 0048 and 0049. Safe to re-run: the procedure edits are skipped once made, and the
-- recalculation of existing certificates (part 3) runs once (extended property V4_0050_SecondSurveDueDate on
-- dbo.MsmeCertifications).
--
-- The second surveillance due date (MsmeCertifications.SecondSurveDueDate) from the level's settings (Admin ->
-- Certification Levels: first surveillance after FirstSurveillanceMonths, the next SurveillanceIntervalMonths later,
-- SurveillanceCount surveillances; Silver / Gold 15 + 12 = 27 months, Bronze has one). Until now only the V4 surveillance
-- schedule wrote it, when round 2's notice went out, so it was empty before and the verification page did not show it.
--   1. dbo.FN_V4_SECOND_SURVEILLANCE_MONTHS(@Certification): months from certification to the second surveillance;
--      NULL when the level has surveillance off or fewer than two surveillances.
--   2. SP_MONITORING_DA_FINAL_SUBMIT and SP_MONITORING_RA_FINAL_SUBMIT set it with the first due date (0048); the upgrade
--      that ends a lower level's certificate clears it with the first. SP_VERIFY_QR_CODE gives it (SecondSurveDueDate),
--      the verification page shows it once surveillance 1 is completed.
--   3. Once: certificates issued before get it (certification date + the months above) where the second surveillance
--      has not started: certified, ACTIVE, the current record, round 2 not opened (EnableSurveillance1 below 2). Each
--      change is written to dbo.MsmeHistory (StatusType 'V4SecondSurveDueDate', old and new date: the undo).
-- The procedures are edited in place by exact replacement (helper below): a live text that differs from the reviewed
-- one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50050, '0050 runs on ZEDCS_V2_LIVE only.', 1;
IF OBJECT_ID(N'dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS') IS NULL
    THROW 50050, 'Run 0048 first.', 1;
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_SECOND_SURVEILLANCE_MONTHS (@Certification varchar(50))
RETURNS int
AS
BEGIN
    -- V4 0050: months from certification to the second surveillance (Admin -> Certification Levels).
    DECLARE @First int = dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS(@Certification), @Count int, @Interval int;
    IF @First IS NULL RETURN NULL;
    SELECT TOP (1) @Count = SurveillanceCount, @Interval = SurveillanceIntervalMonths FROM dbo.SectionTypes WHERE SectionType = @Certification;
    IF ISNULL(@Count, 2) < 2 RETURN NULL;
    RETURN @First + CASE WHEN @Interval >= 1 THEN @Interval ELSE 12 END;
END
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
-- 2. The final submits that certify a unit, and the verification page
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MONITORING_DA_FINAL_SUBMIT', 1,
N'FirstSurveDueDate = DATEADD(MONTH, dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS(@CertificationType), GETDATE())',
N'FirstSurveDueDate = DATEADD(MONTH, dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS(@CertificationType), GETDATE()), SecondSurveDueDate = DATEADD(MONTH, dbo.FN_V4_SECOND_SURVEILLANCE_MONTHS(@CertificationType), GETDATE())', 1),
(N'dbo.SP_MONITORING_RA_FINAL_SUBMIT', 1,
N'FirstSurveDueDate = DATEADD(MONTH, dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS(@CertificationType), GETDATE())',
N'FirstSurveDueDate = DATEADD(MONTH, dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS(@CertificationType), GETDATE()), SecondSurveDueDate = DATEADD(MONTH, dbo.FN_V4_SECOND_SURVEILLANCE_MONTHS(@CertificationType), GETDATE())', 1),
(N'dbo.SP_MONITORING_RA_FINAL_SUBMIT', 2,
N'FirstSurveDueDate=NULL',
N'FirstSurveDueDate=NULL, SecondSurveDueDate=NULL', NULL),
(N'dbo.SP_VERIFY_QR_CODE', 1,
N'FORMAT(FirstSurveDueDate, ''MMMM d, yyyy'') FirstSurveDueDate,',
N'FORMAT(FirstSurveDueDate, ''MMMM d, yyyy'') FirstSurveDueDate, FORMAT(SecondSurveDueDate, ''MMMM d, yyyy'') SecondSurveDueDate,', NULL);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_DA_FINAL_SUBMIT', @Marker = N'FN_V4_SECOND_SURVEILLANCE_MONTHS';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_RA_FINAL_SUBMIT', @Marker = N'FN_V4_SECOND_SURVEILLANCE_MONTHS';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_VERIFY_QR_CODE', @Marker = N'SecondSurveDueDate';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
-- ---------------------------------------------------------------------------------------------------------
-- 3. Once: certificates issued before
-- ---------------------------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID(N'dbo.MsmeCertifications') AND minor_id = 0
           AND name = N'V4_0050_SecondSurveDueDate')
BEGIN
    PRINT 'Second surveillance due dates: already set (0050 ran before).';
    RETURN;
END

BEGIN TRANSACTION;

DECLARE @Changed TABLE (Id int PRIMARY KEY, ZedId varchar(50), Certification varchar(50), OldDue datetime NULL, NewDue datetime);
UPDATE C SET SecondSurveDueDate = X.NewDue
OUTPUT inserted.Id, inserted.ZedId, inserted.Certification, deleted.SecondSurveDueDate, inserted.SecondSurveDueDate INTO @Changed
FROM dbo.MsmeCertifications C
CROSS APPLY (SELECT DATEADD(MONTH, dbo.FN_V4_SECOND_SURVEILLANCE_MONTHS(C.Certification), C.CertificationStatusDate) AS NewDue) X
WHERE C.CertificationStatusDate IS NOT NULL
  AND ((C.Certification = 'Bronze' AND C.CertificationStatus = 6) OR (C.Certification <> 'Bronze' AND C.CertificationStatus = 16))
  AND ISNULL(C.CertificationPhase, 'ACTIVE') = 'ACTIVE'
  AND C.ZedId NOT LIKE '%[_]%'
  AND ISNULL(C.EnableSurveillance1, 0) < 2
  AND X.NewDue IS NOT NULL
  AND (C.SecondSurveDueDate IS NULL OR CAST(C.SecondSurveDueDate AS date) <> CAST(X.NewDue AS date));

INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
SELECT ZedId,
       CONCAT('Second surveillance due date set to ', FORMAT(NewDue, 'MMMM d, yyyy'), ' from the level setting (was ',
              ISNULL(FORMAT(OldDue, 'MMMM d, yyyy'), 'not set'), ')'),
       GETDATE(), Certification, 'V4SecondSurveDueDate'
FROM @Changed;

EXEC sys.sp_addextendedproperty @name = N'V4_0050_SecondSurveDueDate', @value = N'Second surveillance due dates set (migration 0050)',
    @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'MsmeCertifications';

COMMIT;

DECLARE @n int = (SELECT COUNT(*) FROM @Changed);
PRINT CONCAT('Second surveillance due dates set: ', @n, ' certificate(s).');
SELECT Certification, COUNT(*) AS Certificates FROM @Changed GROUP BY Certification ORDER BY Certification;
GO
