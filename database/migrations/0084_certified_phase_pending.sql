-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE, after 0079, 0081, 0082 and 0083. Safe to re-run: once edited, nothing is left
-- to change.
--
-- 2026-11-15 (correction of the "certified by record" rule of 0079, used by 0081, 0082 and 0083):
-- ZEDCS_V2_LIVE.dbo.MsmeCertifications.CertificationPhase has DEFAULT ('PENDING'): a new record keeps PENDING until it is
-- certified (the final submits set ACTIVE; later UPGRADED, EXPIRED, SUSPENDED, WITHDRAWN; a rejection sets REJECTED with
-- status 99). The rule read "certified at the desktop" as status 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS
-- NOT NULL), so every record at 6 waiting for its visit (phase PENDING: a Silver / Gold after its desktop step, a Bronze
-- with a visit, a level sent straight to its visit) counted as certified, and "waiting for a visit" (phase IS NULL) matched
-- nothing: e.g. the agency's site allotment (SP_ASSESSMENT_ALLOT_LIST) listed no unit waiting for its visit.
-- The phase now counts only when certification gave it:
--   certified at the desktop  CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL
--                             OR ISNULL(CertificationPhase, 'PENDING') NOT IN ('PENDING', 'REJECTED'))
--   waiting for a visit       CertificationStatus = 6 AND DaCertificateNo IS NULL
--                             AND ISNULL(CertificationPhase, 'PENDING') IN ('PENDING', 'REJECTED')
-- (The same in C#: Zed.Portal DocumentLevels.IsCertifiedRecord / IsCertificationPhase, Zed.Main.MobileApi BronzeVisitAppStatus.)
-- Records certified today (16; 6 with a desktop number; 6 with ACTIVE / UPGRADED / EXPIRED / SUSPENDED / WITHDRAWN) answer as
-- before; a record at 6 with PENDING, REJECTED or no phase and no desktop number is waiting.
--
-- How: 0079, 0081, 0082 and 0083 wrote the rule in three shapes only, each with one alias on both columns:
--   {a}DaCertificateNo IS NOT NULL OR {a}CertificationPhase IS NOT NULL
--   {a}CertificationStatus = 6 AND {a}CertificationPhase IS NOT NULL
--   {a}DaCertificateNo IS NULL AND {a}CertificationPhase IS NULL
-- (aliases none, C., G., MC., P., S., ZP., lc., main.; matching ignores case as the database does). Every procedure, view
-- or function of this database whose definition contains one of them is edited in place: each shape replaced, CREATE turned
-- into ALTER (permissions kept), run with its own ANSI_NULLS / QUOTED_IDENTIFIER; afterwards none may be left anywhere.
-- Legacy code never wrote these shapes, so nothing else is touched. One transaction: an error changes nothing.
--
-- Also (ZEDCS_V2_LIVE only): a unit whose level's flow has no desktop step (Remote only / Onsite only) skips it
-- (SP_V4_SKIP_DESKTOP, migrations 0074 / 0078) and kept DesktopAccepted NULL, so SP_MONITORING_GET_LIST, which lists and
-- counts only DesktopAccepted = 1 for the admin, the agency and the assessor, never showed it: the agency could not reach the
-- quality check of its visit (status 15) from Assessment Monitoring. The skip now marks the desktop step accepted
-- (DesktopAccepted = 1; every other reader pairs it with a DesktopAssessorId, which a skipped record has none of), and the
-- records skipped before are marked from the skip's own history row (MsmeHistory StatusType 'DesktopSkipped').
-- And (both databases): such a unit has no desktop assessor, and SP_REPORT_GET_DETAILS joined dbo.Users on DesktopAssessorId
-- as an inner (comma) join, so a certified unit without a desktop step had no report (no unit row). The join is a LEFT JOIN
-- now (DesktopAssessorName NULL; the report page leaves that line out), in main's two branches and surveillance's Bronze
-- branch (its other branch joins the round's site assessor, which a visit round always has). The basic-info reports
-- (SP_DYNAMIC_REPORT_ZED_BASIC_INFO and its year copies) join the desktop assessor for its name only: LEFT JOIN too.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE')
    THROW 50084, '0084 runs on ZEDCS_V2_LIVE and ZED_SURVEILLANCE.', 1;
GO
IF OBJECT_ID('tempdb..#V4_PHASE') IS NOT NULL DROP TABLE #V4_PHASE;
CREATE TABLE #V4_PHASE (Seq int IDENTITY(1, 1) NOT NULL, Find nvarchar(400) NOT NULL, Replacement nvarchar(800) NOT NULL);
DECLARE @a TABLE (Alias nvarchar(10) NOT NULL);
INSERT @a VALUES (N''), (N'C.'), (N'G.'), (N'MC.'), (N'P.'), (N'S.'), (N'ZP.'), (N'lc.'), (N'main.');
DECLARE @certified nvarchar(100) = N', ''PENDING'') NOT IN (''PENDING'', ''REJECTED'')',
        @waiting nvarchar(100) = N', ''PENDING'') IN (''PENDING'', ''REJECTED'')';
INSERT #V4_PHASE (Find, Replacement)
SELECT Alias + N'DaCertificateNo IS NOT NULL OR ' + Alias + N'CertificationPhase IS NOT NULL',
       Alias + N'DaCertificateNo IS NOT NULL OR ISNULL(' + Alias + N'CertificationPhase' + @certified FROM @a
UNION ALL
SELECT Alias + N'CertificationStatus = 6 AND ' + Alias + N'CertificationPhase IS NOT NULL',
       Alias + N'CertificationStatus = 6 AND ISNULL(' + Alias + N'CertificationPhase' + @certified FROM @a
UNION ALL
SELECT Alias + N'DaCertificateNo IS NULL AND ' + Alias + N'CertificationPhase IS NULL',
       Alias + N'DaCertificateNo IS NULL AND ISNULL(' + Alias + N'CertificationPhase' + @waiting FROM @a;
GO
IF OBJECT_ID('tempdb..#V4_ALTER_MODULE') IS NOT NULL DROP PROCEDURE #V4_ALTER_MODULE;
GO
-- Runs @Def, an edited definition of the module @Id, as ALTER: the first word outside comments CREATE -> ALTER (CREATE OR
-- ALTER -> ALTER; permissions are kept), with the module's own ANSI_NULLS / QUOTED_IDENTIFIER (as 0079's helper).
CREATE PROCEDURE #V4_ALTER_MODULE @Id int, @Def nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @name nvarchar(300) = QUOTENAME(OBJECT_SCHEMA_NAME(@Id)) + N'.' + QUOTENAME(OBJECT_NAME(@Id)), @msg nvarchar(2048),
            @i int = 1, @j int, @k int, @len int = LEN(@Def + N'x') - 1;
    WHILE @i <= @len
    BEGIN
        IF SUBSTRING(@Def, @i, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @i += 1;
        ELSE IF SUBSTRING(@Def, @i, 2) = N'--'
        BEGIN
            SET @j = CHARINDEX(NCHAR(10), @Def, @i);
            SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 1 END;
        END
        ELSE IF SUBSTRING(@Def, @i, 2) = N'/*'
        BEGIN
            SET @j = CHARINDEX(N'*/', @Def, @i + 2);
            SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 2 END;
        END
        ELSE BREAK;
    END
    IF UPPER(SUBSTRING(@Def, @i, 6)) <> N'CREATE'
    BEGIN
        SET @msg = CONCAT(DB_NAME(), N'.', @name, N': the definition does not start with CREATE.');
        THROW 50084, @msg, 1;
    END
    SET @Def = STUFF(@Def, @i, 6, N'ALTER');
    SET @j = @i + 5;
    WHILE SUBSTRING(@Def, @j, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @j += 1;
    IF UPPER(SUBSTRING(@Def, @j, 3)) IN (N'OR ', N'OR' + NCHAR(9), N'OR' + NCHAR(10), N'OR' + NCHAR(13))
    BEGIN
        SET @k = CHARINDEX(N'ALTER', @Def, @j);
        SET @Def = STUFF(@Def, @j, @k + 5 - @j, N'');
    END
    DECLARE @sql nvarchar(400) = (SELECT CONCAT(N'SET ANSI_NULLS ', CASE WHEN uses_ansi_nulls = 1 THEN N'ON' ELSE N'OFF' END,
        N'; SET QUOTED_IDENTIFIER ', CASE WHEN uses_quoted_identifier = 1 THEN N'ON' ELSE N'OFF' END, N'; EXEC sys.sp_executesql @d;')
        FROM sys.sql_modules WHERE object_id = @Id);
    EXEC sys.sp_executesql @sql, N'@d nvarchar(max)', @d = @Def;
    PRINT CONCAT(DB_NAME(), N'.', @name, N': edited.');
END
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @id int, @name nvarchar(300), @def nvarchar(max), @find nvarchar(400), @rep nvarchar(800), @msg nvarchar(2048), @edited int = 0;
DECLARE m CURSOR LOCAL FAST_FORWARD FOR
    SELECT s.object_id FROM sys.sql_modules s
    WHERE s.definition IS NOT NULL AND EXISTS (SELECT 1 FROM #V4_PHASE f WHERE CHARINDEX(f.Find, s.definition) > 0)
    ORDER BY OBJECT_NAME(s.object_id);
OPEN m;
FETCH NEXT FROM m INTO @id;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @def = OBJECT_DEFINITION(@id);
    DECLARE f CURSOR LOCAL FAST_FORWARD FOR SELECT Find, Replacement FROM #V4_PHASE ORDER BY Seq;
    OPEN f;
    FETCH NEXT FROM f INTO @find, @rep;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @def = REPLACE(@def, @find, @rep);
        FETCH NEXT FROM f INTO @find, @rep;
    END
    CLOSE f;
    DEALLOCATE f;
    EXEC #V4_ALTER_MODULE @Id = @id, @Def = @def;
    SET @edited += 1;
    FETCH NEXT FROM m INTO @id;
END
CLOSE m;
DEALLOCATE m;

-- Nothing of the old rule may be left in this database.
SELECT @name = MIN(OBJECT_NAME(s.object_id)) FROM sys.sql_modules s
WHERE EXISTS (SELECT 1 FROM #V4_PHASE f WHERE CHARINDEX(f.Find, s.definition) > 0);
IF @name IS NOT NULL
BEGIN
    SET @msg = CONCAT(DB_NAME(), N'.', @name, N': the old rule is still in its definition.');
    THROW 50084, @msg, 1;
END
IF @edited = 0 PRINT CONCAT(DB_NAME(), N': nothing left to change in the certified rule (already edited).');
ELSE PRINT CONCAT(DB_NAME(), N': ', @edited, N' object(s) edited for the certified rule.');

-- The desktop assessor joined as a LEFT JOIN (a unit without a desktop step has none). Each object: skipped when missing in
-- this database or already edited (Marker); otherwise every Find of it must occur, as many times as its first one.
DECLARE @j TABLE (Obj nvarchar(200) NOT NULL, Seq int NOT NULL, Find nvarchar(400) NOT NULL, Replacement nvarchar(400) NOT NULL, Marker nvarchar(200) NOT NULL);
INSERT @j VALUES
(N'dbo.SP_REPORT_GET_DETAILS', 1, N'FROM MsmeCertifications C, Msme M, MsmeBasicInformation B, Users U',
 N'FROM MsmeCertifications C LEFT JOIN Users U ON (C.DesktopAssessorId = U.UserId), Msme M, MsmeBasicInformation B', N'LEFT JOIN Users U ON (C.DesktopAssessorId = U.UserId)'),
(N'dbo.SP_REPORT_GET_DETAILS', 2, N'AND C.DesktopAssessorId=U.UserId',
 N'/* V4 0084: Users U is a LEFT JOIN on DesktopAssessorId */', N'LEFT JOIN Users U ON (C.DesktopAssessorId = U.UserId)'),
(N'dbo.SP_DYNAMIC_REPORT_ZED_BASIC_INFO', 1, N'inner join Users UD on (UD.UserId=C.DesktopAssessorId)',
 N'left join Users UD on (UD.UserId=C.DesktopAssessorId)', N'left join Users UD on (UD.UserId=C.DesktopAssessorId)'),
(N'dbo.SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2022_2023', 1, N'inner join Users UD on (UD.UserId=C.DesktopAssessorId)',
 N'left join Users UD on (UD.UserId=C.DesktopAssessorId)', N'left join Users UD on (UD.UserId=C.DesktopAssessorId)'),
(N'dbo.SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2024_2025', 1, N'inner join Users UD on (UD.UserId=C.DesktopAssessorId)',
 N'left join Users UD on (UD.UserId=C.DesktopAssessorId)', N'left join Users UD on (UD.UserId=C.DesktopAssessorId)');
DECLARE @obj nvarchar(200), @marker nvarchar(200), @first int, @n2 int;
DECLARE o CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT Obj, Marker FROM @j ORDER BY Obj;
OPEN o;
FETCH NEXT FROM o INTO @obj, @marker;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @id = OBJECT_ID(@obj, N'P');
    IF @id IS NULL PRINT CONCAT(DB_NAME(), N'.', @obj, N': not in this database, skipped.');
    ELSE IF CHARINDEX(@marker, OBJECT_DEFINITION(@id)) > 0 PRINT CONCAT(DB_NAME(), N'.', @obj, N': already edited.');
    ELSE
    BEGIN
        SET @def = OBJECT_DEFINITION(@id);
        SET @first = NULL;
        DECLARE r CURSOR LOCAL FAST_FORWARD FOR SELECT Find, Replacement FROM @j WHERE Obj = @obj ORDER BY Seq;
        OPEN r;
        FETCH NEXT FROM r INTO @find, @rep;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @n2 = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @find, N''))) / DATALENGTH(@find);
            SET @first = ISNULL(@first, @n2);
            IF @n2 = 0 OR @n2 <> @first
            BEGIN
                SET @msg = CONCAT(DB_NAME(), N'.', @obj, N': "', @find, N'" found ', @n2, N' time(s), expected ', CASE WHEN @first = 0 THEN N'at least 1' ELSE CAST(@first AS nvarchar(10)) END,
                    N'. The live definition differs from the reviewed one: nothing was changed.');
                THROW 50084, @msg, 1;
            END
            SET @def = REPLACE(@def, @find, @rep);
            FETCH NEXT FROM r INTO @find, @rep;
        END
        CLOSE r;
        DEALLOCATE r;
        EXEC #V4_ALTER_MODULE @Id = @id, @Def = @def;
    END
    FETCH NEXT FROM o INTO @obj, @marker;
END
CLOSE o;
DEALLOCATE o;

-- A skipped desktop step counts as accepted (ZEDCS_V2_LIVE: SP_V4_SKIP_DESKTOP is main's).
IF DB_NAME() = N'ZEDCS_V2_LIVE'
BEGIN
    DECLARE @skipFind nvarchar(200) = N'SET CertificationStatus = 6, CertificationStatusDate = GETDATE()',
            @skipMarker nvarchar(200) = N'CertificationStatusDate = GETDATE(), DesktopAccepted = 1', @count int;
    SET @id = OBJECT_ID(N'dbo.SP_V4_SKIP_DESKTOP', N'P');
    IF @id IS NULL THROW 50084, 'dbo.SP_V4_SKIP_DESKTOP not found: run 0074 and 0078 first.', 1;
    SET @def = OBJECT_DEFINITION(@id);
    IF CHARINDEX(@skipMarker, @def) > 0 PRINT CONCAT(DB_NAME(), N'.[dbo].[SP_V4_SKIP_DESKTOP]: already edited.');
    ELSE
    BEGIN
        SET @count = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @skipFind, N''))) / DATALENGTH(@skipFind);
        IF @count <> 1
        BEGIN
            SET @msg = CONCAT(DB_NAME(), N'.dbo.SP_V4_SKIP_DESKTOP: the status update found ', @count, N' time(s), expected 1. The live definition differs from the reviewed one: nothing was changed.');
            THROW 50084, @msg, 1;
        END
        SET @def = REPLACE(@def, @skipFind, @skipFind + N', DesktopAccepted = 1');
        EXEC #V4_ALTER_MODULE @Id = @id, @Def = @def;
    END
    -- (Through sp_executesql: the batch also compiles on ZED_SURVEILLANCE, whose tables may lack these columns.)
    EXEC sys.sp_executesql N'UPDATE C SET DesktopAccepted = 1
    FROM dbo.MsmeCertifications C
    WHERE C.DesktopAccepted IS NULL AND NULLIF(C.DesktopAssessorId, '''') IS NULL AND C.CertificationStatus >= 6
      AND EXISTS (SELECT 1 FROM dbo.MsmeHistory H WHERE H.ZedId = C.ZedId AND H.CertificationType = C.Certification AND H.StatusType = ''DesktopSkipped'');
    SET @n = @@ROWCOUNT;', N'@n int OUTPUT', @n = @count OUTPUT;
    PRINT CONCAT(DB_NAME(), N': ', @count, N' record(s) that skipped the desktop step marked accepted.');
END
COMMIT;
GO
DROP PROCEDURE #V4_ALTER_MODULE;
DROP TABLE #V4_PHASE;
GO
