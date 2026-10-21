-- database\fixes\consultancy\08_coconsultant_exact_match_web.sql  (ZED_CONSULTANT)
-- SECURITY-FINDINGS #121 (consultancy part): the web lists and pages matched co-consultants with LIKE '%id%'.
-- =====================================================================================================================
-- REVIEW BEFORE RUNNING ON PRODUCTION. THE LIVE DEFINITIONS MAY DIFFER FROM THE LOCAL COPY THIS SCRIPT WAS BUILT AND
-- TESTED AGAINST: DIFF FIRST. Run it as it is (PREVIEW: prints the edited definitions, changes nothing), compare the
-- output with the live definition (SSMS: Script Procedure As > ALTER To), then set @Mode = 'APPLY' and run it again.
-- Save the current definitions first (Script As > CREATE To > File): that is the undo.
-- =====================================================================================================================
-- The same defect as #93 (fixed for the app login in 05), in the procedures behind the old consultancy web pages:
--   SP_ASSESSMENT_ALLOT_LIST   (consultant's unit list)          1 match
--   SP_ASSESSMENT_DA_DETAILS   (access check, IsCoAssessorLogin, the co-consultant's section list)   3 matches
--   SP_ASSESSMENT_SA_DETAILS   (access check; a second copy is in a comment, removed with the comments)   1 match
-- On the comma-separated MsmeCertifications.CoAssessorId,
--     CoAssessorId like '%'+@UserId+'%'
-- let a consultant whose id is contained in another's (ABC1 in ABC12) open that unit's pages with the SPOC's contact
-- details. It becomes an exact match on one element of the list (spaces ignored), as in 05:
--     CHARINDEX(','+@UserId+',', ','+REPLACE(CoAssessorId,' ','')+',') > 0
-- What breaks: only access that relied on the substring match. Same rule as V4 (exact ids).
-- Also removes comments holding example calls (ids) from these procedures.
--
-- Idempotent: a second run finds nothing to change and says so. Contains no password, key or ZED ID: the edits are
-- made by pattern on the definition read from the database at run time (helper below).
USE [ZED_CONSULTANT];
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary procedure, dropped at the end of this script). Identical in every script of database\fixes.
--
-- #V4_FIX_PROCEDURE reads the CURRENT definition of one procedure from this database, edits it by pattern
-- (it never needs to know a password, key or ZED ID), and then either prints the edited definition (PREVIEW)
-- or runs it as CREATE OR ALTER PROCEDURE (APPLY; permissions are kept, ANSI_NULLS / QUOTED_IDENTIFIER as the
-- procedure had them). Rules, each switched on per call:
--   @NeutralisePasswordLiterals  "@Password = '<literal>'" becomes "1=0" and "@Password != / <> '<literal>'"
--                                becomes "1=1", so a typed master password is treated like any wrong password.
--   @StripSensitiveComments      removes -- and /* */ comments that contain a quote, a ZED-style id
--                                (ZED<letters>...<digit>) or the words pass / pwd / secret / token / key
--                                (example calls with real ids and passwords).
--   @RemoveTestAmountLists       removes "IF @ZedId IN ('...', ...) BEGIN SET @AmountToBePaid = 1.00 END".
--   @NullLiteralsAliasedAs       comma list of column aliases: "'<literal>' Alias" becomes
--                                "CAST(NULL AS varchar(100)) Alias" (same result-set shape, no value).
--   @Find / @Replace             one plain-text replacement (case-insensitive) applied after the rules.
-- @Expect... : how many matches the reviewed local definition had. A different non-zero count means the live
-- definition differs: nothing is changed and an error is raised (diff it and adapt the call). Zero matches on
-- every rule means the fix is already in place: nothing is changed.
-- After the edit, every removed literal value is searched for in the new text; if it still occurs anywhere
-- the script stops (nothing is changed).
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#V4_FIX_PROCEDURE') IS NOT NULL DROP PROCEDURE #V4_FIX_PROCEDURE;
GO
CREATE PROCEDURE #V4_FIX_PROCEDURE
    @Procedure                  nvarchar(300),
    @Mode                       varchar(10),
    @NeutralisePasswordLiterals bit = 0,
    @ExpectPasswordLiterals     int = NULL,
    @StripSensitiveComments     bit = 1,
    @RemoveTestAmountLists      bit = 0,
    @ExpectTestAmountLists      int = NULL,
    @NullLiteralsAliasedAs      nvarchar(1000) = NULL,
    @ExpectNulledLiterals       int = NULL,
    @Find                       nvarchar(4000) = NULL,
    @Replace                    nvarchar(4000) = NULL,
    @ExpectFind                 int = NULL
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

    ------------------------------------------------------------------ tokenise
    -- kinds: S whitespace, C comment, L string literal, W word / identifier / number, P any other character
    DECLARE @t TABLE (pos int NOT NULL PRIMARY KEY, kind char(1) NOT NULL, txt nvarchar(max) NOT NULL);
    DECLARE @len int = LEN(@def + N'x') - 1, @i int = 1, @n int = 0, @j int, @a int, @b int, @depth int,
            @c nchar(1), @c2 nchar(1), @k char(1);
    WHILE @i <= @len
    BEGIN
        SET @c = SUBSTRING(@def, @i, 1); SET @c2 = SUBSTRING(@def, @i + 1, 1);
        IF @c IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13))
        BEGIN
            SET @j = @i + 1;
            WHILE @j <= @len AND SUBSTRING(@def, @j, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @j += 1;
            SET @k = 'S';
        END
        ELSE IF @c = N'-' AND @c2 = N'-'
        BEGIN
            SET @a = CHARINDEX(NCHAR(10), @def, @i); SET @b = CHARINDEX(NCHAR(13), @def, @i);
            SET @j = CASE WHEN @a = 0 AND @b = 0 THEN @len + 1 WHEN @a = 0 THEN @b WHEN @b = 0 THEN @a
                          WHEN @a < @b THEN @a ELSE @b END;
            SET @k = 'C';
        END
        ELSE IF @c = N'/' AND @c2 = N'*'
        BEGIN
            SET @j = @i + 2; SET @depth = 1;
            WHILE @depth > 0
            BEGIN
                SET @a = CHARINDEX(N'/*', @def, @j); SET @b = CHARINDEX(N'*/', @def, @j);
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
                SET @j = CHARINDEX(N'''', @def, @j);
                IF @j = 0 BEGIN SET @j = @len + 1; BREAK; END
                IF SUBSTRING(@def, @j + 1, 1) = N'''' SET @j += 2;
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
                SET @j = CHARINDEX(@c2, @def, @j);
                IF @j = 0 BEGIN SET @j = @len + 1; BREAK; END
                IF SUBSTRING(@def, @j + 1, 1) = @c2 SET @j += 2;
                ELSE BEGIN SET @j += 1; BREAK; END
            END
            SET @k = 'W';
        END
        ELSE IF @c LIKE N'[A-Za-z0-9_@#$.]'
        BEGIN
            SET @j = @i + 1;
            WHILE @j <= @len AND SUBSTRING(@def, @j, 1) LIKE N'[A-Za-z0-9_@#$.]' SET @j += 1;
            SET @k = 'W';
        END
        ELSE BEGIN SET @j = @i + 1; SET @k = 'P'; END
        SET @n += 1;
        INSERT @t (pos, kind, txt) VALUES (@n, @k, SUBSTRING(@def, @i, @j - @i));
        SET @i = @j;
    END

    DECLARE @removed TABLE (val nvarchar(max) NOT NULL);
    DECLARE @pw int = 0, @cm int = 0, @tl int = 0, @nl int = 0, @fc int = 0,
            @p int, @q int, @r int, @s int, @op nvarchar(4), @prev nvarchar(max), @ok bit, @w int, @wt nvarchar(40);
    DECLARE @want TABLE (n int PRIMARY KEY, w nvarchar(40));
    INSERT @want VALUES (1, N'BEGIN'), (2, N'SET'), (3, N'@AMOUNTTOBEPAID'), (4, N'='), (5, N'#AMOUNT'), (6, N'END');

    ------------------------------------------------------------------ rule: master-password comparisons
    IF @NeutralisePasswordLiterals = 1
    BEGIN
        SET @p = 0;
        WHILE 1 = 1
        BEGIN
            SELECT @p = MIN(pos) FROM @t WHERE pos > @p AND kind = 'W' AND UPPER(txt) = N'@PASSWORD';
            IF @p IS NULL BREAK;
            -- an assignment (SET / SELECT @Password = ...) is not a comparison: leave it
            SET @prev = (SELECT UPPER(txt) FROM @t WHERE pos = (SELECT MAX(pos) FROM @t WHERE pos < @p AND kind NOT IN ('S', 'C')));
            IF @prev IN (N'SET', N'SELECT', N'DECLARE', N',') CONTINUE;
            SELECT @q = MIN(pos) FROM @t WHERE pos > @p AND kind <> 'S';
            SET @op = (SELECT txt FROM @t WHERE pos = @q AND kind = 'P');
            IF @op IN (N'!', N'<')
            BEGIN
                SET @op = @op + ISNULL((SELECT txt FROM @t WHERE pos = @q + 1 AND kind = 'P'), N'');
                IF @op NOT IN (N'!=', N'<>') CONTINUE;
                SET @q += 1;
            END
            ELSE IF ISNULL(@op, N'') <> N'=' CONTINUE;
            SELECT @r = MIN(pos) FROM @t WHERE pos > @q AND kind <> 'S';
            IF NOT EXISTS (SELECT 1 FROM @t WHERE pos = @r AND kind = 'L') CONTINUE;
            INSERT @removed (val) SELECT txt FROM @t WHERE pos = @r;
            UPDATE @t SET txt = N'' WHERE pos > @p AND pos <= @r;
            UPDATE @t SET txt = CASE WHEN @op = N'=' THEN N'1=0' ELSE N'1=1' END WHERE pos = @p;
            SET @pw += 1;
            SET @p = @r;
        END
    END

    ------------------------------------------------------------------ rule: ₹1 test ZED-ID lists
    IF @RemoveTestAmountLists = 1
    BEGIN
        SET @p = 0;
        WHILE 1 = 1
        BEGIN
            SELECT @p = MIN(pos) FROM @t WHERE pos > @p AND kind = 'W' AND UPPER(txt) = N'IF';
            IF @p IS NULL BREAK;
            -- IF @ZedId IN (
            SELECT @q = MIN(pos) FROM @t WHERE pos > @p AND kind NOT IN ('S', 'C');
            IF NOT EXISTS (SELECT 1 FROM @t WHERE pos = @q AND UPPER(txt) = N'@ZEDID') CONTINUE;
            SELECT @q = MIN(pos) FROM @t WHERE pos > @q AND kind NOT IN ('S', 'C');
            IF NOT EXISTS (SELECT 1 FROM @t WHERE pos = @q AND UPPER(txt) = N'IN') CONTINUE;
            SELECT @q = MIN(pos) FROM @t WHERE pos > @q AND kind NOT IN ('S', 'C');
            IF NOT EXISTS (SELECT 1 FROM @t WHERE pos = @q AND txt = N'(') CONTINUE;
            -- only literals and commas up to the closing parenthesis
            SELECT @r = MIN(pos) FROM @t WHERE pos > @q AND kind = 'P' AND txt = N')';
            IF @r IS NULL OR EXISTS (SELECT 1 FROM @t WHERE pos > @q AND pos < @r AND NOT (kind IN ('S', 'C', 'L') OR txt = N',')) CONTINUE;
            -- BEGIN SET @AmountToBePaid = 1.00 END
            SET @ok = 1; SET @s = @r;
            SET @w = 1;
            WHILE @w <= 6
            BEGIN
                SET @wt = (SELECT w FROM @want WHERE n = @w);
                SELECT @s = MIN(pos) FROM @t WHERE pos > @s AND kind NOT IN ('S', 'C');
                IF @s IS NULL OR NOT EXISTS (SELECT 1 FROM @t WHERE pos = @s AND
                       (UPPER(txt) = @wt OR (@wt = N'#AMOUNT' AND txt IN (N'1', N'1.0', N'1.00'))))
                BEGIN SET @ok = 0; BREAK; END
                SET @w += 1;
            END
            IF @ok = 0 CONTINUE;
            INSERT @removed (val) SELECT txt FROM @t WHERE pos > @q AND pos < @r AND kind = 'L';
            UPDATE @t SET txt = N'' WHERE pos >= @p AND pos <= @s;
            SET @tl += 1;
            SET @p = @s;
        END
    END

    ------------------------------------------------------------------ rule: literals with given aliases -> NULL
    IF @NullLiteralsAliasedAs IS NOT NULL
    BEGIN
        DECLARE @aliases TABLE (a nvarchar(128) PRIMARY KEY);
        INSERT @aliases SELECT DISTINCT UPPER(LTRIM(RTRIM(value))) FROM STRING_SPLIT(@NullLiteralsAliasedAs, N',') WHERE LTRIM(RTRIM(value)) <> N'';
        SET @p = 0;
        WHILE 1 = 1
        BEGIN
            SELECT @p = MIN(pos) FROM @t WHERE pos > @p AND kind = 'L';
            IF @p IS NULL BREAK;
            SELECT @q = MIN(pos) FROM @t WHERE pos > @p AND kind <> 'S';
            IF EXISTS (SELECT 1 FROM @t WHERE pos = @q AND UPPER(txt) = N'AS')
                SELECT @q = MIN(pos) FROM @t WHERE pos > @q AND kind <> 'S';
            IF NOT EXISTS (SELECT 1 FROM @t t JOIN @aliases x ON x.a = UPPER(REPLACE(REPLACE(t.txt, N'[', N''), N']', N'')) WHERE t.pos = @q AND t.kind = 'W') CONTINUE;
            INSERT @removed (val) SELECT txt FROM @t WHERE pos = @p;
            UPDATE @t SET txt = N'CAST(NULL AS varchar(100))' WHERE pos = @p;
            SET @nl += 1;
        END
    END

    ------------------------------------------------------------------ rule: sensitive comments
    IF @StripSensitiveComments = 1
    BEGIN
        UPDATE @t SET txt = N''
        WHERE kind = 'C' AND txt <> N''
          AND (txt LIKE N'%''%' OR txt LIKE N'%ZED[A-Za-z]%[0-9]%' OR txt LIKE N'%pass%' OR txt LIKE N'%pwd%'
               OR txt LIKE N'%secret%' OR txt LIKE N'%token%' OR txt LIKE N'%key%');
        SET @cm = @@ROWCOUNT;
    END

    ------------------------------------------------------------------ CREATE -> CREATE OR ALTER
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

    ------------------------------------------------------------------ plain replacement
    IF @Find IS NOT NULL AND @Find <> N''
    BEGIN
        SET @fc = (DATALENGTH(@new) - DATALENGTH(REPLACE(@new, @Find, N''))) / DATALENGTH(@Find);
        SET @new = REPLACE(@new, @Find, ISNULL(@Replace, N''));
    END

    DECLARE @summary nvarchar(2000) = CONCAT(DB_NAME(), N'.', @Procedure, N': ',
        @pw, N' master-password comparison(s) neutralised, ', @tl, N' test amount list(s) removed, ',
        @nl, N' literal(s) replaced by NULL, ', @fc, N' text replacement(s), ', @cm, N' sensitive comment(s) removed.');
    PRINT @summary;

    IF @pw + @tl + @nl + @fc + @cm = 0
    BEGIN
        PRINT CONCAT(DB_NAME(), N'.', @Procedure, N': nothing to change (already fixed).');
        RETURN;
    END

    ------------------------------------------------------------------ expectations
    IF (@ExpectPasswordLiterals IS NOT NULL AND @pw NOT IN (0, @ExpectPasswordLiterals))
       OR (@ExpectTestAmountLists IS NOT NULL AND @tl NOT IN (0, @ExpectTestAmountLists))
       OR (@ExpectNulledLiterals IS NOT NULL AND @nl NOT IN (0, @ExpectNulledLiterals))
       OR (@ExpectFind IS NOT NULL AND @fc NOT IN (0, @ExpectFind))
    BEGIN
        RAISERROR('%s: the live definition differs from the reviewed one (match counts above). Nothing changed: diff it and adapt the call.', 16, 1, @Procedure);
        RETURN;
    END

    ------------------------------------------------------------------ no removed value may remain
    IF EXISTS (SELECT 1 FROM @removed x
               CROSS APPLY (SELECT REPLACE(SUBSTRING(x.val, CHARINDEX(N'''', x.val) + 1, LEN(x.val + N'x') - 1 - CHARINDEX(N'''', x.val) - 1), N'''''', N'''') AS v) y
               WHERE LEN(y.v) >= 4 AND CHARINDEX(y.v, @new) > 0)
    BEGIN
        RAISERROR('%s: a removed value still occurs elsewhere in the definition. Nothing changed: fix it by hand.', 16, 1, @Procedure);
        RETURN;
    END

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

DECLARE @Mode varchar(10) = 'PREVIEW';   -- PREVIEW: print only. APPLY: alter the procedures (all or none).
DECLARE @bad nvarchar(200) = N'CoAssessorId like ''%''+@UserId+''%''',
        @good nvarchar(200) = N'CHARINDEX('',''+@UserId+'','', '',''+REPLACE(CoAssessorId,'' '','''')+'','') > 0';
DECLARE @check TABLE (Proc_ sysname);
INSERT @check VALUES (N'dbo.SP_ASSESSMENT_ALLOT_LIST'), (N'dbo.SP_ASSESSMENT_DA_DETAILS'), (N'dbo.SP_ASSESSMENT_SA_DETAILS');
IF EXISTS (SELECT 1 FROM @check c CROSS APPLY (SELECT OBJECT_DEFINITION(OBJECT_ID(c.Proc_, 'P')) d) x
           WHERE x.d IS NOT NULL AND CHARINDEX(@bad, x.d) = 0 AND CHARINDEX(@good, x.d) = 0)
BEGIN
    RAISERROR('A live definition contains neither the reviewed text nor the fix. Nothing changed: diff it and adapt the script.', 16, 1);
    RETURN;
END
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    EXEC #V4_FIX_PROCEDURE @Procedure = N'dbo.SP_ASSESSMENT_ALLOT_LIST', @Mode = @Mode,
        @Find = @bad, @Replace = @good, @ExpectFind = 1;
    EXEC #V4_FIX_PROCEDURE @Procedure = N'dbo.SP_ASSESSMENT_DA_DETAILS', @Mode = @Mode,
        @Find = @bad, @Replace = @good, @ExpectFind = 3;
    EXEC #V4_FIX_PROCEDURE @Procedure = N'dbo.SP_ASSESSMENT_SA_DETAILS', @Mode = @Mode,
        @Find = @bad, @Replace = @good, @ExpectFind = 1;
    IF @Mode = 'APPLY' AND EXISTS (SELECT 1 FROM @check c WHERE CHARINDEX(@bad, OBJECT_DEFINITION(OBJECT_ID(c.Proc_, 'P'))) > 0)
        RAISERROR('A LIKE match is still present after the change. Nothing changed.', 16, 1);
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
IF OBJECT_ID('tempdb..#V4_FIX_PROCEDURE') IS NOT NULL DROP PROCEDURE #V4_FIX_PROCEDURE;
GO
