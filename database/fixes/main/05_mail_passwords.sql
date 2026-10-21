-- database\fixes\main\05_mail_passwords.sql  (ZEDCS_V2_LIVE)
-- SECURITY-FINDINGS #35: portal passwords put into e-mails by the main database's procedures.
-- =====================================================================================================================
-- REVIEW BEFORE RUNNING ON PRODUCTION. THE LIVE DEFINITIONS MAY DIFFER FROM THE LOCAL COPY THIS SCRIPT WAS BUILT AND
-- TESTED AGAINST: DIFF FIRST. Run it as it is (PREVIEW: prints each change, changes nothing), compare with the live
-- definitions (SSMS: Script Procedure As > ALTER To), then set @Mode = 'APPLY' and run it again.
-- Save the current definitions first (Script As > CREATE To > File): that is the undo.
-- =====================================================================================================================
-- Changes:
--   - SP_EMAIL_GET_DETAILS (allotment mails of the old site): the columns Password (desktop or site assessor),
--     MsmePassword and CoAssessorPassword return NULL (same names and type, varchar(50)).
--   - SP_EMAIL_GET_DETAILS_FA (financial assistance allotment mail): Password returns NULL.
--   - The reminder / status jobs that put the unit's portal password into the mail body (apply for surveillance,
--     Bronze and second surveillance with their reminders, re-certification, suspension, withdrawal, and the
--     _BACKUP / _manually copies): the password column becomes the fixed text "Your existing password (use Forgot
--     Password on the portal to reset it)". The mail layout is unchanged. These jobs are run by the V4 Zed.Jobs
--     service after the cut-over (docs/JOBS.md), so without this script V4 would keep mailing passwords.
-- What breaks: nothing a user needs. Assessors and units already have their passwords; the old site's allotment
-- mails show an empty password line. The job mails show the sentence above in the password row.
-- Not changed here: the ZED_CONSULTANT / ZED_SURVEILLANCE copies of these procedures (scripts in their folders).
--
-- Idempotent: a second run finds nothing to change and says so. Contains no password, key or ZED ID: the edits are
-- made by pattern on the definitions read from the database at run time (helper below).
USE [ZEDCS_V2_LIVE];
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary procedures, dropped at the end of this script). Identical in scripts 05 and later; 01-04
-- use the older #V4_FIX_PROCEDURE, which has fixed rules only.
--
-- #V4_REWRITE_PROCEDURE reads the CURRENT definition of one procedure from this database and applies the edits
-- listed for it in #V4_EDITS (in Seq order). An edit is "replace the code Find by the code Repl". Find is
-- matched as a sequence of T-SQL tokens: whitespace, line breaks, comments and upper/lower case do not matter,
-- and code inside comments is never matched. The token #ANY# in Find matches any one token (used where the
-- reviewed code contains a value that must not be written in this script). Then the procedure either prints
-- what changes (PREVIEW) or runs the new definition as CREATE OR ALTER PROCEDURE (APPLY; permissions are kept,
-- ANSI_NULLS / QUOTED_IDENTIFIER as the procedure had them).
-- For every edit:
--   - Find occurs Expect times (outside places that already hold Repl): the edit is made.
--   - Find does not occur and Repl does: the edit is already in place (a second run changes nothing).
--   - anything else: the live definition differs from the reviewed one. An error is raised and, because the
--     calls run in one transaction, nothing at all is changed. Diff the live definition and adapt the edit.
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
CREATE TABLE #V4_EDITS (
    Seq      int IDENTITY(1, 1) PRIMARY KEY,
    ProcName nvarchar(300) NOT NULL,
    Note     nvarchar(400) NOT NULL,
    Find     nvarchar(max) NOT NULL,
    Repl     nvarchar(max) NOT NULL,
    Expect   int NOT NULL);
GO
IF OBJECT_ID('tempdb..#V4_TOKENISE') IS NOT NULL DROP PROCEDURE #V4_TOKENISE;
GO
-- Splits T-SQL text into tokens (kinds: S whitespace, C comment, L string literal, W word / identifier / number,
-- P any other character). Concatenating the tokens in pos order gives the text back unchanged.
CREATE PROCEDURE #V4_TOKENISE @text nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @t TABLE (pos int NOT NULL PRIMARY KEY, kind char(1) NOT NULL, txt nvarchar(max) NOT NULL);
    DECLARE @len int = LEN(ISNULL(@text, N'') + N'x') - 1, @i int = 1, @n int = 0, @j int, @a int, @b int, @depth int,
            @c nchar(1), @c2 nchar(1), @k char(1);
    WHILE @i <= @len
    BEGIN
        SET @c = SUBSTRING(@text, @i, 1); SET @c2 = SUBSTRING(@text, @i + 1, 1);
        IF @c IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13))
        BEGIN
            SET @j = @i + 1;
            WHILE @j <= @len AND SUBSTRING(@text, @j, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @j += 1;
            SET @k = 'S';
        END
        ELSE IF @c = N'-' AND @c2 = N'-'
        BEGIN
            SET @a = CHARINDEX(NCHAR(10), @text, @i); SET @b = CHARINDEX(NCHAR(13), @text, @i);
            SET @j = CASE WHEN @a = 0 AND @b = 0 THEN @len + 1 WHEN @a = 0 THEN @b WHEN @b = 0 THEN @a
                          WHEN @a < @b THEN @a ELSE @b END;
            SET @k = 'C';
        END
        ELSE IF @c = N'/' AND @c2 = N'*'
        BEGIN
            SET @j = @i + 2; SET @depth = 1;
            WHILE @depth > 0
            BEGIN
                SET @a = CHARINDEX(N'/*', @text, @j); SET @b = CHARINDEX(N'*/', @text, @j);
                IF @b = 0 BEGIN SET @j = @len + 1; BREAK; END
                IF @a > 0 AND @a < @b BEGIN SET @depth += 1; SET @j = @a + 2; END
                ELSE BEGIN SET @depth -= 1; SET @j = @b + 2; END
            END
            SET @k = 'C';
        END
        ELSE IF @c = N'''' OR (@c IN (N'N', N'n') AND @c2 = N'''')
        BEGIN
            SET @j = @i + CASE WHEN @c = N'''' THEN 1 ELSE 2 END;
            WHILE 1 = 1
            BEGIN
                SET @j = CHARINDEX(N'''', @text, @j);
                IF @j = 0 BEGIN SET @j = @len + 1; BREAK; END
                IF SUBSTRING(@text, @j + 1, 1) = N'''' SET @j += 2;
                ELSE BEGIN SET @j += 1; BREAK; END
            END
            SET @k = 'L';
        END
        ELSE IF @c IN (N'[', N'"')
        BEGIN
            SET @c2 = CASE WHEN @c = N'[' THEN N']' ELSE N'"' END;
            SET @j = @i + 1;
            WHILE 1 = 1
            BEGIN
                SET @j = CHARINDEX(@c2, @text, @j);
                IF @j = 0 BEGIN SET @j = @len + 1; BREAK; END
                IF SUBSTRING(@text, @j + 1, 1) = @c2 SET @j += 2;
                ELSE BEGIN SET @j += 1; BREAK; END
            END
            SET @k = 'W';
        END
        ELSE IF @c LIKE N'[A-Za-z0-9_@#$.]'
        BEGIN
            SET @j = @i + 1;
            WHILE @j <= @len AND SUBSTRING(@text, @j, 1) LIKE N'[A-Za-z0-9_@#$.]' SET @j += 1;
            SET @k = 'W';
        END
        ELSE BEGIN SET @j = @i + 1; SET @k = 'P'; END
        SET @n += 1;
        INSERT @t (pos, kind, txt) VALUES (@n, @k, SUBSTRING(@text, @i, @j - @i));
        SET @i = @j;
    END
    SELECT pos, kind, txt FROM @t ORDER BY pos;
END
GO
IF OBJECT_ID('tempdb..#V4_REWRITE_PROCEDURE') IS NOT NULL DROP PROCEDURE #V4_REWRITE_PROCEDURE;
GO
CREATE PROCEDURE #V4_REWRITE_PROCEDURE
    @Procedure        nvarchar(300),
    @Mode             varchar(10),
    @PrintDefinition  bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @Mode NOT IN ('PREVIEW', 'APPLY') BEGIN RAISERROR('@Mode must be PREVIEW or APPLY.', 16, 1); RETURN; END

    DECLARE @objId int = OBJECT_ID(@Procedure, 'P');
    DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@objId);
    IF @def IS NULL
    BEGIN
        RAISERROR('%s: not found (or encrypted) in this database; skipped.', 10, 1, @Procedure) WITH NOWAIT;
        RETURN;
    END
    DECLARE @ansiNulls bit, @quotedId bit;
    SELECT @ansiNulls = uses_ansi_nulls, @quotedId = uses_quoted_identifier FROM sys.sql_modules WHERE object_id = @objId;

    DECLARE @t    TABLE (pos int NOT NULL PRIMARY KEY, kind char(1) NOT NULL, txt nvarchar(max) NOT NULL);
    DECLARE @tok  TABLE (pos int NOT NULL PRIMARY KEY, kind char(1) NOT NULL, txt nvarchar(max) NOT NULL);
    DECLARE @sig  TABLE (rn int NOT NULL PRIMARY KEY, pos int NOT NULL, u nvarchar(max) NOT NULL);
    DECLARE @f    TABLE (k int NOT NULL PRIMARY KEY, u nvarchar(max) NOT NULL);
    DECLARE @r    TABLE (k int NOT NULL PRIMARY KEY, u nvarchar(max) NOT NULL);
    DECLARE @rs   TABLE (s int NOT NULL PRIMARY KEY, e int NOT NULL);
    DECLARE @cand TABLE (s int NOT NULL PRIMARY KEY);
    DECLARE @hit  TABLE (s int NOT NULL PRIMARY KEY, e int NOT NULL, p1 int NULL, p2 int NULL);
    DECLARE @seq int = 0, @note nvarchar(400), @find nvarchar(max), @repl nvarchar(max), @expect int,
            @nf int, @nr int, @fm int, @rm int, @s int, @last int, @changed int = 0, @was nvarchar(max),
            @prefix nvarchar(400) = CONCAT(DB_NAME(), N'.', @Procedure);

    WHILE 1 = 1
    BEGIN
        SELECT TOP (1) @seq = Seq, @note = Note, @find = Find, @repl = Repl, @expect = Expect
        FROM #V4_EDITS WHERE ProcName = @Procedure AND Seq > @seq ORDER BY Seq;
        IF @@ROWCOUNT = 0 BREAK;

        DELETE @t;   INSERT @t EXEC #V4_TOKENISE @def;
        DELETE @sig; INSERT @sig (rn, pos, u) SELECT ROW_NUMBER() OVER (ORDER BY pos), pos, UPPER(txt) FROM @t WHERE kind NOT IN ('S', 'C');
        DELETE @tok; INSERT @tok EXEC #V4_TOKENISE @find;
        DELETE @f;   INSERT @f (k, u) SELECT ROW_NUMBER() OVER (ORDER BY pos), UPPER(txt) FROM @tok WHERE kind NOT IN ('S', 'C');
        DELETE @tok; INSERT @tok EXEC #V4_TOKENISE @repl;
        DELETE @r;   INSERT @r (k, u) SELECT ROW_NUMBER() OVER (ORDER BY pos), UPPER(txt) FROM @tok WHERE kind NOT IN ('S', 'C');
        SELECT @nf = COUNT(*) FROM @f;
        SELECT @nr = COUNT(*) FROM @r;
        IF @nf = 0 OR @nr = 0 BEGIN RAISERROR('%s edit %d: Find and Repl must both contain code.', 16, 1, @Procedure, @seq); RETURN; END

        -- places that already hold the fixed code
        DELETE @rs;
        INSERT @rs (s, e)
        SELECT s.rn, s.rn + @nr - 1 FROM @sig s
        WHERE s.u = (SELECT u FROM @r WHERE k = 1)
          AND NOT EXISTS (SELECT 1 FROM @r r LEFT JOIN @sig x ON x.rn = s.rn + r.k - 1 AND x.u = r.u WHERE x.rn IS NULL);

        -- places that hold the reviewed (old) code, outside the fixed places, left to right without overlap
        DELETE @cand;
        INSERT @cand (s)
        SELECT s.rn FROM @sig s
        WHERE (s.u = (SELECT u FROM @f WHERE k = 1) OR (SELECT u FROM @f WHERE k = 1) = N'#ANY#')
          AND NOT EXISTS (SELECT 1 FROM @f f LEFT JOIN @sig x ON x.rn = s.rn + f.k - 1 AND (x.u = f.u OR f.u = N'#ANY#') WHERE x.rn IS NULL)
          AND NOT EXISTS (SELECT 1 FROM @rs r WHERE s.rn BETWEEN r.s AND r.e);
        DELETE @hit; SET @last = 0;
        WHILE 1 = 1
        BEGIN
            SET @s = NULL;
            SELECT @s = MIN(s) FROM @cand WHERE s > @last;
            IF @s IS NULL BREAK;
            INSERT @hit (s, e) VALUES (@s, @s + @nf - 1);
            SET @last = @s + @nf - 1;
        END
        SELECT @fm = COUNT(*) FROM @hit;
        SELECT @rm = COUNT(*) FROM @rs;

        IF @fm = 0 AND @rm > 0
        BEGIN
            PRINT CONCAT(@prefix, N' edit ', @seq, N' (', @note, N'): already in place.');
            CONTINUE;
        END
        IF @fm <> @expect
        BEGIN
            RAISERROR('%s edit %d: the reviewed code occurs %d time(s), %d expected (fixed code: %d). The live definition differs from the reviewed one. Nothing changed: diff it and adapt the edit.',
                16, 1, @Procedure, @seq, @fm, @expect, @rm);
            RETURN;
        END

        UPDATE h SET p1 = a.pos, p2 = b.pos FROM @hit h JOIN @sig a ON a.rn = h.s JOIN @sig b ON b.rn = h.e;
        PRINT CONCAT(@prefix, N' edit ', @seq, N' (', @note, N'): ', @fm, N' place(s) changed.');
        SET @s = 0;
        WHILE 1 = 1
        BEGIN
            SELECT TOP (1) @s = s FROM @hit WHERE s > @s ORDER BY s;
            IF @@ROWCOUNT = 0 BREAK;
            -- values matched by #ANY# are not printed
            SELECT @was = STRING_AGG(CAST(CASE WHEN a.pos IS NOT NULL AND t.kind = 'L' THEN N'''<value>''' ELSE t.txt END AS nvarchar(max)), N'')
                          WITHIN GROUP (ORDER BY t.pos)
            FROM @t t JOIN @hit h ON h.s = @s AND t.pos BETWEEN h.p1 AND h.p2
            LEFT JOIN (SELECT x.pos FROM @f f JOIN @sig x ON x.rn = @s + f.k - 1 WHERE f.u = N'#ANY#') a ON a.pos = t.pos;
            PRINT CONCAT(N'    was: ', LEFT(REPLACE(REPLACE(@was, NCHAR(13), N''), NCHAR(10), N' '), 3900));
            PRINT CONCAT(N'    now: ', LEFT(REPLACE(REPLACE(@repl, NCHAR(13), N''), NCHAR(10), N' '), 3900));
        END
        UPDATE t SET txt = CASE WHEN t.pos = h.p1 THEN @repl ELSE N'' END
        FROM @t t JOIN @hit h ON t.pos BETWEEN h.p1 AND h.p2;
        SELECT @def = STRING_AGG(CAST(txt AS nvarchar(max)), N'') WITHIN GROUP (ORDER BY pos) FROM @t;
        SET @changed += 1;
    END

    IF @changed = 0
    BEGIN
        PRINT CONCAT(@prefix, N': nothing to change (already fixed).');
        RETURN;
    END

    ------------------------------------------------------------------ CREATE -> CREATE OR ALTER
    DELETE @t; INSERT @t EXEC #V4_TOKENISE @def;
    DECLARE @p int, @q int;
    SELECT @p = MIN(pos) FROM @t WHERE kind NOT IN ('S', 'C');
    IF NOT EXISTS (SELECT 1 FROM @t WHERE pos = @p AND UPPER(txt) = N'CREATE')
    BEGIN
        RAISERROR('%s: the definition does not start with CREATE; fix it by hand.', 16, 1, @Procedure);
        RETURN;
    END
    SELECT @q = MIN(pos) FROM @t WHERE pos > @p AND kind NOT IN ('S', 'C');
    IF NOT EXISTS (SELECT 1 FROM @t WHERE pos = @q AND UPPER(txt) = N'OR')
        UPDATE @t SET txt = N'CREATE OR ALTER' WHERE pos = @p;
    DECLARE @new nvarchar(max) = (SELECT STRING_AGG(CAST(txt AS nvarchar(max)), N'') WITHIN GROUP (ORDER BY pos) FROM @t);

    IF @Mode = 'PREVIEW'
    BEGIN
        IF @PrintDefinition = 1
        BEGIN
            PRINT N'---------- new definition (PREVIEW; nothing changed) ----------';
            DECLARE @rest nvarchar(max) = REPLACE(@new, NCHAR(13), N''), @line nvarchar(max), @nlPos int;
            WHILE LEN(@rest + N'x') > 1
            BEGIN
                SET @nlPos = CHARINDEX(NCHAR(10), @rest);
                IF @nlPos = 0 SET @nlPos = LEN(@rest + N'x');
                SET @line = LEFT(@rest, @nlPos - 1);
                SET @rest = SUBSTRING(@rest, @nlPos + 1, LEN(@rest + N'x'));
                WHILE LEN(@line + N'x') - 1 > 4000 BEGIN PRINT LEFT(@line, 4000); SET @line = SUBSTRING(@line, 4001, LEN(@line + N'x')); END
                PRINT @line;
            END
            PRINT N'---------- end ----------';
        END
        PRINT CONCAT(@prefix, N': would be altered (PREVIEW; nothing changed).');
        RETURN;
    END

    DECLARE @sql nvarchar(400) = CONCAT(N'SET ANSI_NULLS ', CASE WHEN @ansiNulls = 1 THEN N'ON' ELSE N'OFF' END,
        N'; SET QUOTED_IDENTIFIER ', CASE WHEN @quotedId = 1 THEN N'ON' ELSE N'OFF' END, N'; EXEC sys.sp_executesql @d;');
    EXEC sys.sp_executesql @sql, N'@d nvarchar(max)', @d = @new;
    -- SQL Server stores CREATE OR ALTER as CREATE plus spaces: compare without whitespace.
    DECLARE @cur nvarchar(max) = OBJECT_DEFINITION(OBJECT_ID(@Procedure, 'P'));
    SET @cur = REPLACE(REPLACE(REPLACE(REPLACE(@cur, N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'');
    SET @new = REPLACE(REPLACE(REPLACE(REPLACE(@new, N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'');
    IF @cur IS NULL OR REPLACE(@cur, N'CREATEORALTER', N'CREATE') <> REPLACE(@new, N'CREATEORALTER', N'CREATE')
    BEGIN
        RAISERROR('%s: the procedure was not altered as expected.', 16, 1, @Procedure);
        RETURN;
    END
    PRINT CONCAT(@prefix, N': altered.');
END
GO
-- ---------------------------------------------------------------------------------------------------------
-- The edits (reviewed against the local copy of the definitions).
-- ---------------------------------------------------------------------------------------------------------
INSERT #V4_EDITS (ProcName, Note, Find, Repl, Expect) VALUES
(N'dbo.SP_EMAIL_GET_DETAILS', N'assessor password',
 N'case when CertificationStatus<=6 then U2.Password else U5.Password end as Password',
 N'CAST(NULL AS varchar(50)) as Password', 1),
(N'dbo.SP_EMAIL_GET_DETAILS', N'MSME password',
 N'U3.Password MsmePassword',
 N'CAST(NULL AS varchar(50)) MsmePassword', 1),
(N'dbo.SP_EMAIL_GET_DETAILS', N'co-assessor password',
 N'U4.Password CoAssessorPassword',
 N'CAST(NULL AS varchar(50)) CoAssessorPassword', 1),
(N'dbo.SP_EMAIL_GET_DETAILS_FA', N'assessor password',
 N'U2.Password, null ModeOfAssessment',
 N'CAST(NULL AS varchar(50)) Password, null ModeOfAssessment', 1);

DECLARE @text nvarchar(200) = N'CAST(N''Your existing password (use Forgot Password on the portal to reset it)'' AS nvarchar(255))';
INSERT #V4_EDITS (ProcName, Note, Find, Repl, Expect)
SELECT N'dbo.' + p, N'unit password in the mail', N'U.Password', @text, 1
FROM (VALUES
    (N'SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL_REM1'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL_REM2'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_BRONZE_SURVEILLANCE_MAIL'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_BRONZE_SURVEILLANCE_MAIL_REM1'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_BRONZE_SURVEILLANCE_MAIL_REM2_BACKUP'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL_REM1'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL_REM2'),
    (N'SP_JOB_TO_SEND_APPLY_FOR_SECOND_SURVEILLANCE_MAIL_manually'),
    (N'SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION'),
    (N'SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_SUSPENSION'),
    (N'SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_WITHDRAW')) v(p)
ORDER BY p;
GO

DECLARE @Mode varchar(10) = 'PREVIEW';   -- PREVIEW: print only. APPLY: alter the procedures (all or none).
DECLARE @PrintDefinitions bit = 0;       -- 1: PREVIEW also prints each new definition in full.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @procs TABLE (n int IDENTITY(1, 1) PRIMARY KEY, ProcName nvarchar(300) NOT NULL);
    INSERT @procs (ProcName) SELECT ProcName FROM #V4_EDITS GROUP BY ProcName ORDER BY MIN(Seq);
    DECLARE @n int = 0, @proc nvarchar(300);
    WHILE 1 = 1
    BEGIN
        SELECT TOP (1) @n = n, @proc = ProcName FROM @procs WHERE n > @n ORDER BY n;
        IF @@ROWCOUNT = 0 BREAK;
        EXEC #V4_REWRITE_PROCEDURE @Procedure = @proc, @Mode = @Mode, @PrintDefinition = @PrintDefinitions;
    END
    COMMIT TRANSACTION;
    IF @Mode = 'PREVIEW' PRINT N'PREVIEW: nothing was changed. Set @Mode = ''APPLY'' to make the changes.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
IF OBJECT_ID('tempdb..#V4_REWRITE_PROCEDURE') IS NOT NULL DROP PROCEDURE #V4_REWRITE_PROCEDURE;
IF OBJECT_ID('tempdb..#V4_TOKENISE') IS NOT NULL DROP PROCEDURE #V4_TOKENISE;
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
GO
