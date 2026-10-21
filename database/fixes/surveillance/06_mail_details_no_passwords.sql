-- database\fixes\surveillance\06_mail_details_no_passwords.sql  (ZED_SURVEILLANCE)
-- SECURITY-FINDINGS #35 (ZED_SURVEILLANCE part; the same as #117 for the consultancy copy).
-- =====================================================================================================================
-- REVIEW BEFORE RUNNING ON PRODUCTION. THE LIVE DEFINITIONS MAY DIFFER FROM THE LOCAL COPY THIS SCRIPT WAS BUILT AND
-- TESTED AGAINST: DIFF FIRST. Run it as it is (PREVIEW: prints the edited definitions, changes nothing), compare the
-- output with the live definition (SSMS: Script Procedure As > ALTER To), then set @Mode = 'APPLY' and run it again.
-- Save the current definitions first (Script As > CREATE To > File): that is the undo.
-- =====================================================================================================================
-- SP_EMAIL_GET_DETAILS returned the plain-text portal passwords of the assessor (Password), the co-assessor
-- (CoAssessorPassword) and the MSME (MsmePassword, read from ZEDCS_V2_LIVE.Users); SP_EMAIL_GET_DETAILS_FA returned the
-- financial assessor's (Password). The old surveillance site and services put them into allotment and NC mails.
-- Now those columns are NULL (same names and types, so every caller keeps working: the old code reads them with
-- .ToString(), which gives an empty string; V4 never reads them).
-- What breaks: the old surveillance allotment / NC-raised / FA allotment mails show an empty password cell. Users sign
-- in with the password they already have or reset it ("Forgot password").
--
-- Idempotent: a second run finds the fix marker in each procedure and says "nothing to change". Contains no password,
-- key or ZED ID.
USE [ZED_SURVEILLANCE];
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helpers (temporary procedures, dropped at the end of this script). Identical in every script of database\fixes
-- that changes procedure logic (04 onwards); 01-03 use #V4_FIX_PROCEDURE for their literal clean-ups.
--
-- #V4_EDIT_PROCEDURE reads the CURRENT definition of one procedure from this database and applies the edits listed
-- for it in #V4_EDITS, in Seq order. Each edit is a token pattern (Find) and its replacement text:
--   - Find is compared token by token, ignoring whitespace, comments and letter case, so a different indentation or
--     line ending in the live definition does not matter; #LIT# in Find stands for any one string literal (so no
--     ZED ID, password or other value has to be written in a script).
--   - Find must match exactly Expect times (non-overlapping). Any other count means the live definition differs from
--     the reviewed local copy: an error is raised and NOTHING is changed (all procedures of a script change, or none).
--   - Every replacement contains the marker comment of this fix (@Marker). A definition that already contains the
--     marker is left alone ("nothing to change"), so a second run is harmless.
-- PREVIEW prints the edited definition and changes nothing; APPLY runs it as CREATE OR ALTER PROCEDURE (permissions
-- are kept, ANSI_NULLS / QUOTED_IDENTIFIER as the procedure had them) and checks the stored text afterwards.
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#V4_EDIT_PROCEDURE') IS NOT NULL DROP PROCEDURE #V4_EDIT_PROCEDURE;
IF OBJECT_ID('tempdb..#V4_TOKENIZE') IS NOT NULL DROP PROCEDURE #V4_TOKENIZE;
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
GO
CREATE TABLE #V4_EDITS (Proc_ nvarchar(300) NOT NULL, Seq int NOT NULL, Find nvarchar(max) NOT NULL,
                        Replacement nvarchar(max) NOT NULL, Expect int NOT NULL DEFAULT 1, PRIMARY KEY (Proc_, Seq));
GO
-- Splits @Text into tokens in #V4_TOK (created by the caller), set @Set.
-- kinds: S whitespace, C comment, L string literal, W word / identifier / number, P any other character
CREATE PROCEDURE #V4_TOKENIZE @Text nvarchar(max), @Set int
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @len int = LEN(@Text + N'x') - 1, @i int = 1, @n int = 0, @j int, @a int, @b int, @depth int,
            @c nchar(1), @c2 nchar(1), @k char(1);
    DELETE FROM #V4_TOK WHERE SetId = @Set;
    WHILE @i <= @len
    BEGIN
        SET @c = SUBSTRING(@Text, @i, 1); SET @c2 = SUBSTRING(@Text, @i + 1, 1);
        IF @c IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13))
        BEGIN
            SET @j = @i + 1;
            WHILE @j <= @len AND SUBSTRING(@Text, @j, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @j += 1;
            SET @k = 'S';
        END
        ELSE IF @c = N'-' AND @c2 = N'-'
        BEGIN
            SET @a = CHARINDEX(NCHAR(10), @Text, @i); SET @b = CHARINDEX(NCHAR(13), @Text, @i);
            SET @j = CASE WHEN @a = 0 AND @b = 0 THEN @len + 1 WHEN @a = 0 THEN @b WHEN @b = 0 THEN @a
                          WHEN @a < @b THEN @a ELSE @b END;
            SET @k = 'C';
        END
        ELSE IF @c = N'/' AND @c2 = N'*'
        BEGIN
            SET @j = @i + 2; SET @depth = 1;
            WHILE @depth > 0
            BEGIN
                SET @a = CHARINDEX(N'/*', @Text, @j); SET @b = CHARINDEX(N'*/', @Text, @j);
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
                SET @j = CHARINDEX(N'''', @Text, @j);
                IF @j = 0 BEGIN SET @j = @len + 1; BREAK; END
                IF SUBSTRING(@Text, @j + 1, 1) = N'''' SET @j += 2;
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
                SET @j = CHARINDEX(@c2, @Text, @j);
                IF @j = 0 BEGIN SET @j = @len + 1; BREAK; END
                IF SUBSTRING(@Text, @j + 1, 1) = @c2 SET @j += 2;
                ELSE BEGIN SET @j += 1; BREAK; END
            END
            SET @k = 'W';
        END
        ELSE IF @c LIKE N'[A-Za-z0-9_@#$.]'
        BEGIN
            SET @j = @i + 1;
            WHILE @j <= @len AND SUBSTRING(@Text, @j, 1) LIKE N'[A-Za-z0-9_@#$.]' SET @j += 1;
            SET @k = 'W';
        END
        ELSE BEGIN SET @j = @i + 1; SET @k = 'P'; END
        SET @n += 1;
        INSERT #V4_TOK (SetId, pos, kind, txt) VALUES (@Set, @n, @k, SUBSTRING(@Text, @i, @j - @i));
        SET @i = @j;
    END
END
GO
CREATE PROCEDURE #V4_EDIT_PROCEDURE @Procedure nvarchar(300), @Mode varchar(10), @Marker nvarchar(200)
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
    IF CHARINDEX(@Marker, @def) > 0
    BEGIN
        PRINT CONCAT(DB_NAME(), N'.', @Procedure, N': nothing to change (already fixed: "', @Marker, N'" found).');
        RETURN;
    END
    DECLARE @ansiNulls bit, @quotedId bit;
    SELECT @ansiNulls = uses_ansi_nulls, @quotedId = uses_quoted_identifier FROM sys.sql_modules WHERE object_id = @objId;

    IF OBJECT_ID('tempdb..#V4_TOK') IS NOT NULL DROP TABLE #V4_TOK;
    CREATE TABLE #V4_TOK (SetId int NOT NULL, pos int NOT NULL, kind char(1) NOT NULL, txt nvarchar(max) NOT NULL, PRIMARY KEY (SetId, pos));

    DECLARE @new nvarchar(max) = @def, @seq int = 0, @find nvarchar(max), @repl nvarchar(max), @expect int,
            @k int, @count int, @summary nvarchar(max) = N'', @n int, @lastEnd int, @s int;
    DECLARE @sig TABLE (si int PRIMARY KEY, pos int NOT NULL, kind char(1) NOT NULL, u nvarchar(max) NOT NULL);
    DECLARE @pat TABLE (k int PRIMARY KEY, wild bit NOT NULL, u nvarchar(max) NOT NULL);
    DECLARE @hit TABLE (n int PRIMARY KEY, si int NOT NULL);
    DECLARE @use TABLE (si int PRIMARY KEY, firstPos int NOT NULL, lastPos int NOT NULL);

    WHILE 1 = 1
    BEGIN
        SELECT TOP 1 @seq = Seq, @find = Find, @repl = Replacement, @expect = Expect
        FROM #V4_EDITS WHERE Proc_ = @Procedure AND Seq > @seq ORDER BY Seq;
        IF @@ROWCOUNT = 0 BREAK;
        IF CHARINDEX(@Marker, @repl) = 0
        BEGIN RAISERROR('%s: edit %d does not contain the marker; fix the script.', 16, 1, @Procedure, @seq); RETURN; END

        EXEC #V4_TOKENIZE @new, 1;
        EXEC #V4_TOKENIZE @find, 2;
        DELETE @sig; DELETE @pat; DELETE @hit; DELETE @use;
        INSERT @sig (si, pos, kind, u)
            SELECT ROW_NUMBER() OVER (ORDER BY pos), pos, kind, UPPER(txt) FROM #V4_TOK WHERE SetId = 1 AND kind NOT IN ('S', 'C');
        INSERT @pat (k, wild, u)
            SELECT ROW_NUMBER() OVER (ORDER BY pos), CASE WHEN UPPER(txt) = N'#LIT#' THEN 1 ELSE 0 END, UPPER(txt)
            FROM #V4_TOK WHERE SetId = 2 AND kind NOT IN ('S', 'C');
        SET @k = (SELECT COUNT(*) FROM @pat);

        INSERT @hit (n, si)
            SELECT ROW_NUMBER() OVER (ORDER BY s.si), s.si FROM @sig s
            WHERE NOT EXISTS (SELECT 1 FROM @pat p LEFT JOIN @sig d ON d.si = s.si + p.k - 1
                              WHERE d.si IS NULL OR NOT ((p.wild = 1 AND d.kind = 'L') OR (p.wild = 0 AND d.u = p.u)));
        -- non-overlapping, first to last
        SET @n = 1; SET @lastEnd = 0;
        WHILE 1 = 1
        BEGIN
            SELECT @s = si FROM @hit WHERE n = @n;
            IF @@ROWCOUNT = 0 BREAK;
            IF @s > @lastEnd
            BEGIN
                INSERT @use (si, firstPos, lastPos)
                    SELECT @s, (SELECT pos FROM @sig WHERE si = @s), (SELECT pos FROM @sig WHERE si = @s + @k - 1);
                SET @lastEnd = @s + @k - 1;
            END
            SET @n += 1;
        END
        SET @count = (SELECT COUNT(*) FROM @use);
        SET @summary = CONCAT(@summary, N' edit ', @seq, N': ', @count, N' of ', @expect, N';');
        IF @count <> @expect
        BEGIN
            PRINT CONCAT(DB_NAME(), N'.', @Procedure, N':', @summary);
            RAISERROR('%s: edit %d matched %d time(s), expected %d. The live definition differs from the reviewed one. Nothing changed: diff it and adapt the script.', 16, 1, @Procedure, @seq, @count, @expect);
            RETURN;
        END
        -- replace each matched span (from its first to its last significant token) by the replacement text
        UPDATE t SET txt = CASE WHEN t.pos = u.firstPos THEN @repl ELSE N'' END
        FROM #V4_TOK t JOIN @use u ON t.SetId = 1 AND t.pos BETWEEN u.firstPos AND u.lastPos;
        SET @new = (SELECT STRING_AGG(CAST(txt AS nvarchar(max)), N'') WITHIN GROUP (ORDER BY pos) FROM #V4_TOK WHERE SetId = 1);
    END

    IF @seq = 0 BEGIN RAISERROR('%s: no edits listed in #V4_EDITS.', 16, 1, @Procedure); RETURN; END

    ------------------------------------------------------------------ CREATE -> CREATE OR ALTER
    EXEC #V4_TOKENIZE @new, 1;
    DECLARE @p int, @q int;
    SELECT @p = MIN(pos) FROM #V4_TOK WHERE SetId = 1 AND kind NOT IN ('S', 'C');
    IF NOT EXISTS (SELECT 1 FROM #V4_TOK WHERE SetId = 1 AND pos = @p AND UPPER(txt) = N'CREATE')
    BEGIN
        RAISERROR('%s: the definition does not start with CREATE; fix it by hand.', 16, 1, @Procedure);
        RETURN;
    END
    SELECT @q = MIN(pos) FROM #V4_TOK WHERE SetId = 1 AND pos > @p AND kind NOT IN ('S', 'C');
    IF NOT EXISTS (SELECT 1 FROM #V4_TOK WHERE SetId = 1 AND pos = @q AND UPPER(txt) = N'OR')
        UPDATE #V4_TOK SET txt = N'CREATE OR ALTER' WHERE SetId = 1 AND pos = @p;
    SET @new = (SELECT STRING_AGG(CAST(txt AS nvarchar(max)), N'') WITHIN GROUP (ORDER BY pos) FROM #V4_TOK WHERE SetId = 1);

    PRINT CONCAT(DB_NAME(), N'.', @Procedure, N':', @summary, N' ready (', @Marker, N').');

    IF @Mode = 'PREVIEW'
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
    PRINT CONCAT(DB_NAME(), N'.', @Procedure, N': altered.');
END
GO
INSERT #V4_EDITS (Proc_, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_EMAIL_GET_DETAILS', 1,
 N'case when CertificationStatus<=6 then U2.Password else U5.Password end as Password',
 N'CAST(NULL AS varchar(50)) as Password /* V4 fix surveillance/06a (#35): no credentials in mails */', 1),
(N'dbo.SP_EMAIL_GET_DETAILS', 2,
 N'U3.Password MsmePassword',
 N'CAST(NULL AS varchar(50)) MsmePassword /* V4 fix surveillance/06a (#35) */', 1),
(N'dbo.SP_EMAIL_GET_DETAILS', 3,
 N'U4.Password CoAssessorPassword',
 N'CAST(NULL AS varchar(50)) CoAssessorPassword /* V4 fix surveillance/06a (#35) */', 1),
(N'dbo.SP_EMAIL_GET_DETAILS_FA', 1,
 N'U2.Password, null ModeOfAssessment',
 N'CAST(NULL AS varchar(50)) Password /* V4 fix surveillance/06b (#35): no credentials in mails */, null ModeOfAssessment', 1);
GO

DECLARE @Mode varchar(10) = 'PREVIEW';   -- PREVIEW: print only. APPLY: alter the procedures (all or none).
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    EXEC #V4_EDIT_PROCEDURE @Procedure = N'dbo.SP_EMAIL_GET_DETAILS',    @Mode = @Mode, @Marker = N'V4 fix surveillance/06a';
    EXEC #V4_EDIT_PROCEDURE @Procedure = N'dbo.SP_EMAIL_GET_DETAILS_FA', @Mode = @Mode, @Marker = N'V4 fix surveillance/06b';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
IF OBJECT_ID('tempdb..#V4_EDIT_PROCEDURE') IS NOT NULL DROP PROCEDURE #V4_EDIT_PROCEDURE;
IF OBJECT_ID('tempdb..#V4_TOKENIZE') IS NOT NULL DROP PROCEDURE #V4_TOKENIZE;
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
GO
