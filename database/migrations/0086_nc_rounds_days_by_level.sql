-- V4 0086 (2026-11-16, approved): the Admin sets each level's NC rounds and the days to close them
-- (Administration → Certification Levels, Certificate tab "Non-conformities").
-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE (deploy\Invoke-ZedDatabaseScripts.ps1 does), after 0078 and 0080. Safe to re-run:
-- the columns and functions are created when missing, each procedure is edited once (marker), all in one transaction.
--
-- The rule (user, 2026-11-16): a level whose flow has a desktop step and a visit (Desktop + Remote, Desktop + Onsite) raises
-- its NCs only at the remote / onsite assessment (0078 already sends its desktop step to the agency without NCs); the visit
-- flows (Remote only, Onsite only, and the combined ones) have 5 rounds and 60 days; Desktop only keeps 5 rounds and 30 days.
-- The days count from the first NC and cover every round (as before: NcFinalClosureDt is set when NC 1 is raised).
--
-- dbo.SectionTypes.NcRounds (1-5; the records have five NC round columns) and NcDays (1-365), NULL = the default:
--   FN_V4_NC_ROUNDS(level)        the stored rounds, else 5
--   FN_V4_NC_DAYS(level, stage)   the stored days, else 30 for a desktop NC ('DA'), 60 for a remote / onsite NC ('SA')
-- The portal saves main's row and the surveillance database's copy (as the level's flow).
-- Procedures (both databases, surveillance included as asked): SP_ASSESSMENT_DA_FINAL_SUBMIT and SP_ASSESSMENT_RA_FINAL_SUBMIT
-- (next round copied while NcCount < rounds; NcFinalClosureDt = today + days, was 1 / 2 months; past the last round the
-- application is rejected, 7 / 17, as after NC 5 before), SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT and
-- SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT (no NC is raised in the last round). Surveillance keeps its scheme deadline cap.
-- ZEDCS_V2_LIVE only: SP_ASSESSMENT_DA_AUTO_REJECT rejects an NC past its final closure date at every level (it took
-- desktop NCs of Bronze only and visit NCs of Silver / Gold / site levels: a desktop-only Silver or a Bronze with a visit
-- was never rejected).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE')
    THROW 50086, '0086 runs on ZEDCS_V2_LIVE and ZED_SURVEILLANCE.', 1;
IF OBJECT_ID(N'dbo.FN_V4_LEVEL_DESKTOP') IS NULL
    THROW 50086, 'Run 0078 first.', 1;
GO
IF COL_LENGTH('dbo.SectionTypes', 'NcRounds') IS NULL
    ALTER TABLE dbo.SectionTypes ADD NcRounds int NULL CONSTRAINT CK_SectionTypes_NcRounds CHECK (NcRounds BETWEEN 1 AND 5);
IF COL_LENGTH('dbo.SectionTypes', 'NcDays') IS NULL
    ALTER TABLE dbo.SectionTypes ADD NcDays int NULL CONSTRAINT CK_SectionTypes_NcDays CHECK (NcDays BETWEEN 1 AND 365);
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_NC_ROUNDS (@Code varchar(50))
RETURNS int
AS
BEGIN
    -- V4 0086: the level's NC rounds (Admin), else 5.
    DECLARE @n int;
    SELECT TOP (1) @n = NcRounds FROM dbo.SectionTypes WHERE SectionType = @Code AND IsCertificationLevel = 1;
    RETURN CASE WHEN @n BETWEEN 1 AND 5 THEN @n ELSE 5 END;
END
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_NC_DAYS (@Code varchar(50), @Stage varchar(2))
RETURNS int
AS
BEGIN
    -- V4 0086: the level's days to close its NCs (Admin), else 30 for a desktop NC ('DA') and 60 for a remote / onsite one.
    DECLARE @d int;
    SELECT TOP (1) @d = NcDays FROM dbo.SectionTypes WHERE SectionType = @Code AND IsCertificationLevel = 1;
    RETURN CASE WHEN @d BETWEEN 1 AND 365 THEN @d WHEN @Stage = 'DA' THEN 30 ELSE 60 END;
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
-- The final submits and their checks (both databases).
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 1, N'Select @NcCount=NcCount from MsmeCertifications where ZedId=@ZedId AND Certification=@CertificationType',
 N'Select @NcCount=NcCount from MsmeCertifications where ZedId=@ZedId AND Certification=@CertificationType
	DECLARE @NcRounds int = dbo.FN_V4_NC_ROUNDS(@CertificationType), @NcDays int = dbo.FN_V4_NC_DAYS(@CertificationType, ''DA'')   -- V4 0086: the level''s NC rounds and days (Admin)', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 2, N'IF @NcCount<5',
 N'IF @NcCount < @NcRounds', 2),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 3, N'IF @NcCount > 5',
 N'IF @NcCount > @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 4, N'IF @NcCount<6',
 N'IF @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 5, N'DATEADD(MONTH, 1, GETDATE())',
 N'DATEADD(DAY, @NcDays, GETDATE())', 2),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 6, N'set Nc2Status=1 where ZedId=@ZedId and Certification=@CertificationType',
 N'set Nc2Status=1 where ZedId=@ZedId and Certification=@CertificationType AND @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 7, N'set Nc3Status=1 where ZedId=@ZedId and Certification=@CertificationType',
 N'set Nc3Status=1 where ZedId=@ZedId and Certification=@CertificationType AND @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 8, N'set Nc4Status=1 where ZedId=@ZedId and Certification=@CertificationType',
 N'set Nc4Status=1 where ZedId=@ZedId and Certification=@CertificationType AND @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 9, N'set Nc5Status=1 where ZedId=@ZedId and Certification=@CertificationType',
 N'set Nc5Status=1 where ZedId=@ZedId and Certification=@CertificationType AND @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 1, N'Select @NcCount=NcCount from MsmeCertifications where ZedId=@ZedId AND Certification=@CertificationType',
 N'Select @NcCount=NcCount from MsmeCertifications where ZedId=@ZedId AND Certification=@CertificationType
	DECLARE @NcRounds int = dbo.FN_V4_NC_ROUNDS(@CertificationType), @NcDays int = dbo.FN_V4_NC_DAYS(@CertificationType, ''SA'')   -- V4 0086: the level''s NC rounds and days (Admin)', 1),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 2, N'IF @NcCount<5',
 N'IF @NcCount < @NcRounds', 2),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 3, N'IF @NcCount > 5',
 N'IF @NcCount > @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 4, N'IF @NcCount<6',
 N'IF @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 5, N'DATEADD(MONTH, 2, GETDATE())',
 N'DATEADD(DAY, @NcDays, GETDATE())', 2),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 6, N'set Nc2Status=1 where ZedId=@ZedId and Certification=@CertificationType',
 N'set Nc2Status=1 where ZedId=@ZedId and Certification=@CertificationType AND @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 7, N'set Nc3Status=1 where ZedId=@ZedId and Certification=@CertificationType',
 N'set Nc3Status=1 where ZedId=@ZedId and Certification=@CertificationType AND @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 8, N'set Nc4Status=1 where ZedId=@ZedId and Certification=@CertificationType',
 N'set Nc4Status=1 where ZedId=@ZedId and Certification=@CertificationType AND @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 9, N'set Nc5Status=1 where ZedId=@ZedId and Certification=@CertificationType',
 N'set Nc5Status=1 where ZedId=@ZedId and Certification=@CertificationType AND @NcCount <= @NcRounds', 1),
(N'dbo.SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT', 1, N'IF @NcCount>=5',
 N'IF @NcCount >= dbo.FN_V4_NC_ROUNDS(@CertificationType)', 1),
(N'dbo.SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT', 1, N'IF @NcCount>=5',
 N'IF @NcCount >= dbo.FN_V4_NC_ROUNDS(@CertificationType)', 1);
-- 0080's App Forms NC (main's copies only).
IF DB_NAME() = N'ZEDCS_V2_LIVE'
    INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
    (N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 20, N'IF @NcCount < 5',
 N'IF @NcCount < @NcRounds', 1),
    (N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', 20, N'IF @NcCount < 5',
 N'IF @NcCount < @NcRounds', 1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', @Marker = N'FN_V4_NC_ROUNDS';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT', @Marker = N'FN_V4_NC_ROUNDS';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT', @Marker = N'FN_V4_NC_ROUNDS';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT', @Marker = N'FN_V4_NC_ROUNDS';
IF DB_NAME() = N'ZEDCS_V2_LIVE'
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE [dbo].[SP_ASSESSMENT_DA_AUTO_REJECT]
(
	@ZedId VarChar(50)						= NULL,
	@CertificationType VarChar(50)			= NULL,
	@AssessorRemarks VarChar(5000)			= NULL
)
AS
BEGIN
	SET NOCOUNT ON;
	-- V4 0086: an NC not closed by its final closure date rejects the application at every level
	-- (desktop NC 4 -> 7, remote / onsite NC 14 -> 17); the date comes from the level''s NC days (FN_V4_NC_DAYS).
	insert into MsmeHistory(ZedId,Descrip,CreatedDate,CertificationType,StatusType)
	select ZedId,concat(''Auto Rejected On '',FORMAT(getdate(), ''MMMM d, yyyy'')),getdate(),Certification,''Certification auto Rejected due to NC closure time is exceeded'' from MsmeCertifications where certificationstatus=4 and NcFinalClosureDt<GETDATE()
	UPDATE MsmeCertifications set NcCount=6, CertificationStatus=7,CertificationStatusDate=getdate(),IsAutoReject=1 where certificationstatus=4 and NcFinalClosureDt<GETDATE()

	insert into MsmeHistory(ZedId,Descrip,CreatedDate,CertificationType,StatusType)
	select ZedId,concat(''Auto Rejected On '',FORMAT(getdate(), ''MMMM d, yyyy'')),getdate(),Certification,''Certification auto Rejected due to NC closure time is exceeded'' from MsmeCertifications where certificationstatus=14 and NcFinalClosureDt<GETDATE()
	UPDATE MsmeCertifications set NcCount=6, CertificationStatus=17,CertificationStatusDate=getdate(),IsAutoReject=1 where certificationstatus=14 and NcFinalClosureDt<GETDATE()
END';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
