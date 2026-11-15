-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE, after 0017, 0030 and 0078. Safe to re-run: columns are added
-- once, the procedure edits are skipped once made.
--
-- 2026-11-15 (the user): Admin -> Settings -> App Forms -> Edit field -> "Validation required" (the Admin's own fields of the
-- ZED MSME app's Basic Information form). The assessor who raises the NCs of the round checks each such answer: Valid, or
-- Not valid with a remark. Final submit needs every one checked, and each Not valid becomes an NC item on the field, which
-- the unit answers in the ZED MSME app (NC screen) by entering the field again. The assessor checks it again in the next round.
-- Who checks follows the level's flow (Administration -> Certification Levels, 0078): the desktop assessor for a level
-- certified at the desktop, the lead assessor's web review (remote or onsite) for a level with a visit.
--
-- Columns are added to the existing App Forms tables (no new table), in all three databases (the portal reads the same
-- columns everywhere); the NC is raised only on ZEDCS_V2_LIVE:
--   dbo.V4AppFormFields.NeedsVerification   bit NULL: 1 = the assessor checks the answer ("Validation required" on the page;
--                                           not named ValidationRequired: MsmeEvidences.ValidationRequired means the opposite).
--   dbo.V4AppFormValues:
--     ValidStatus   'Yes' / 'No'   the check (null: not checked)
--     ValidRemarks  the remark (required for 'No')
--     ValidStage    'DA' / 'SA'    who checked: the desktop or the site / remote assessor
--     ValidRound    MsmeCertifications.NcCount when checked (0: the first assessment)
--     ValidBy, ValidOn
--     NcRound       the NC round raised on this answer (set by the final submit)
--     NcValue       the answer found not valid; NcRemarks the remark that raised the NC
--     NcAnsweredOn  when the unit answered that NC in the app
--
-- ZEDCS_V2_LIVE: SP_ASSESSMENT_DA_FINAL_SUBMIT (its desktop-level branch: Bronze, or every desktop-only level once 0078 ran)
-- and SP_ASSESSMENT_RA_FINAL_SUBMIT count an answer checked
-- 'No' in the round being submitted as an NC (as a product or requirement found not conforming) and, below NC 5, mark it
-- raised in the next round. Edited in place by exact replacement (helper below, as in 0051 and 0077): a live text that
-- differs from the reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50080, '0080 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
IF OBJECT_ID(N'dbo.V4AppFormFields', N'U') IS NULL OR OBJECT_ID(N'dbo.V4AppFormValues', N'U') IS NULL
    THROW 50080, 'Run 0017 first (dbo.V4AppFormFields, dbo.V4AppFormValues).', 1;
GO
IF COL_LENGTH('dbo.V4AppFormFields', 'NeedsVerification') IS NULL ALTER TABLE dbo.V4AppFormFields ADD NeedsVerification bit NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'ValidStatus') IS NULL ALTER TABLE dbo.V4AppFormValues ADD ValidStatus varchar(3) NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'ValidRemarks') IS NULL ALTER TABLE dbo.V4AppFormValues ADD ValidRemarks nvarchar(1000) NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'ValidStage') IS NULL ALTER TABLE dbo.V4AppFormValues ADD ValidStage varchar(2) NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'ValidRound') IS NULL ALTER TABLE dbo.V4AppFormValues ADD ValidRound int NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'ValidBy') IS NULL ALTER TABLE dbo.V4AppFormValues ADD ValidBy varchar(50) NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'ValidOn') IS NULL ALTER TABLE dbo.V4AppFormValues ADD ValidOn datetime2(0) NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'NcRound') IS NULL ALTER TABLE dbo.V4AppFormValues ADD NcRound int NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'NcValue') IS NULL ALTER TABLE dbo.V4AppFormValues ADD NcValue nvarchar(max) NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'NcRemarks') IS NULL ALTER TABLE dbo.V4AppFormValues ADD NcRemarks nvarchar(1000) NULL;
IF COL_LENGTH('dbo.V4AppFormValues', 'NcAnsweredOn') IS NULL ALTER TABLE dbo.V4AppFormValues ADD NcAnsweredOn datetime2(0) NULL;
GO
IF OBJECT_ID(N'dbo.CK_V4AppFormValues_ValidStatus', N'C') IS NULL
    ALTER TABLE dbo.V4AppFormValues ADD CONSTRAINT CK_V4AppFormValues_ValidStatus CHECK (ValidStatus IN ('Yes', 'No'));
IF OBJECT_ID(N'dbo.CK_V4AppFormValues_ValidStage', N'C') IS NULL
    ALTER TABLE dbo.V4AppFormValues ADD CONSTRAINT CK_V4AppFormValues_ValidStage CHECK (ValidStage IN ('DA', 'SA'));
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; the same as in 0077). #V4_EDIT_PROCEDURE edits one procedure of this database in
-- place: it reads the live definition, applies the replacements listed for it in #V4_EDITS (each Find must occur exactly
-- Expect times, or at least once when Expect is NULL), turns CREATE into ALTER (permissions are kept) and runs it with the
-- procedure's own ANSI_NULLS / QUOTED_IDENTIFIER. A definition that already contains @Marker (code text of the edit, never
-- a comment) is left alone. Any difference raises an error.
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
-- The edits: just before each procedure decides on the NC (IF (@ErrorStatus=1 and @NcCount=0), once in each: the Bronze
-- branch of the desktop one, the whole site one).
-- ---------------------------------------------------------------------------------------------------------
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 1,
N'IF (@ErrorStatus=1 and @NcCount=0)',
N'IF EXISTS (SELECT 1 FROM dbo.V4AppFormValues WHERE ZedId = @ZedId AND CertificationType = @CertificationType   -- V4 0080: App Forms answers found not valid
		           AND ValidStage = ''DA'' AND ValidRound = @NcCount AND ValidStatus = ''No'')
		BEGIN
			SET @ErrorStatus = 1
			IF @NcCount < 5
				UPDATE dbo.V4AppFormValues SET NcRound = @NcCount + 1, NcValue = Value, NcRemarks = ValidRemarks, NcAnsweredOn = NULL
				WHERE ZedId = @ZedId AND CertificationType = @CertificationType AND ValidStage = ''DA'' AND ValidRound = @NcCount AND ValidStatus = ''No''
		END

		IF (@ErrorStatus=1 and @NcCount=0)', 1),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 1,
N'IF (@ErrorStatus=1 and @NcCount=0)',
N'IF EXISTS (SELECT 1 FROM dbo.V4AppFormValues WHERE ZedId = @ZedId AND CertificationType = @CertificationType   -- V4 0080: App Forms answers found not valid
		           AND ValidStage = ''SA'' AND ValidRound = @NcCount AND ValidStatus = ''No'')
		BEGIN
			SET @ErrorStatus = 1
			IF @NcCount < 5
				UPDATE dbo.V4AppFormValues SET NcRound = @NcCount + 1, NcValue = Value, NcRemarks = ValidRemarks, NcAnsweredOn = NULL
				WHERE ZedId = @ZedId AND CertificationType = @CertificationType AND ValidStage = ''SA'' AND ValidRound = @NcCount AND ValidStatus = ''No''
		END

		IF (@ErrorStatus=1 and @NcCount=0)', 1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DB_NAME() = N'ZEDCS_V2_LIVE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', @Marker = N'dbo.V4AppFormValues';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', @Marker = N'dbo.V4AppFormValues';
END
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
