-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE, after 0041 (every deploy runs both, in that order). Safe to
-- re-run.
--
-- Switching a subsidy category off (2026-11-13; Admin -> Masters -> Payments, Disable / Enable on a category). The Admin
-- switches a category (1 SC, 2 woman, 3 ST, 4 aspirational, 5 LWE, 6 Himalayan, 7 island, 8 NER; never 0 General) off on
-- the three portals at once. New columns of the legacy table, the same on every row of the category:
--   dbo.AssessmentFee.SubsidyOff        bit NULL            1 = switched off (NULL / 0 = on)
--   dbo.AssessmentFee.SubsidyOffReason  nvarchar(500) NULL  why (the Disable box)
--   dbo.AssessmentFee.SubsidyOffBy      varchar(50) NULL    the Admin who last switched it
--   dbo.AssessmentFee.SubsidyOffOn      datetime NULL       when
-- dbo.FN_V4_SUBSIDY_CATEGORY (0041) leaves out a category that has any row switched off, so the payment procedures charge
-- the unit's next eligible category (General when none). Rows added later for a level are covered (the whole category is
-- off). Payments already made are records and do not change.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50070, '0070 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
IF COL_LENGTH('dbo.AssessmentFee', 'SubsidyOff') IS NULL ALTER TABLE dbo.AssessmentFee ADD SubsidyOff bit NULL;
IF COL_LENGTH('dbo.AssessmentFee', 'SubsidyOffReason') IS NULL ALTER TABLE dbo.AssessmentFee ADD SubsidyOffReason nvarchar(500) NULL;
IF COL_LENGTH('dbo.AssessmentFee', 'SubsidyOffBy') IS NULL ALTER TABLE dbo.AssessmentFee ADD SubsidyOffBy varchar(50) NULL;
IF COL_LENGTH('dbo.AssessmentFee', 'SubsidyOffOn') IS NULL ALTER TABLE dbo.AssessmentFee ADD SubsidyOffOn datetime NULL;
GO
-- The function: 0041 creates it again on every deploy, so its text is the reviewed one; the filter is added once.
DECLARE @id int = OBJECT_ID(N'dbo.FN_V4_SUBSIDY_CATEGORY');
DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@id);
DECLARE @find nvarchar(100) = N'WHERE x.FeeRows > 0';
DECLARE @rep nvarchar(400) = N'WHERE x.FeeRows > 0 AND (f.Category = 0 OR NOT EXISTS (SELECT 1 FROM dbo.AssessmentFee o '
    + N'WHERE o.SpecialCategory = f.Category AND o.SubsidyOff = 1)) /* V4_0070 */';
IF @id IS NULL
    THROW 50070, '0070: dbo.FN_V4_SUBSIDY_CATEGORY is missing (0041 runs first).', 1;
IF CHARINDEX(N'V4_0070', @def) > 0
    PRINT CONCAT(DB_NAME(), N'.dbo.FN_V4_SUBSIDY_CATEGORY: already leaves out switched-off categories.');
ELSE
BEGIN
    DECLARE @count int = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @find, N''))) / DATALENGTH(@find);
    IF @count <> 1
        THROW 50070, '0070: dbo.FN_V4_SUBSIDY_CATEGORY differs from the reviewed text (the category filter was not found once).', 1;
    SET @def = REPLACE(@def, @find, @rep);
    -- The first word outside the leading comments and blanks: CREATE OR ALTER runs as it is, CREATE becomes ALTER.
    DECLARE @at int = 1, @j int, @len int = LEN(@def + N'x') - 1;
    WHILE @at <= @len
    BEGIN
        IF SUBSTRING(@def, @at, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @at += 1;
        ELSE IF SUBSTRING(@def, @at, 2) = N'--'
        BEGIN
            SET @j = CHARINDEX(NCHAR(10), @def, @at);
            SET @at = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 1 END;
        END
        ELSE IF SUBSTRING(@def, @at, 2) = N'/*'
        BEGIN
            SET @j = CHARINDEX(N'*/', @def, @at + 2);
            SET @at = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 2 END;
        END
        ELSE BREAK;
    END
    IF UPPER(SUBSTRING(@def, @at, 6)) <> N'CREATE'
        THROW 50070, '0070: dbo.FN_V4_SUBSIDY_CATEGORY does not start with CREATE.', 1;
    IF UPPER(REPLACE(REPLACE(REPLACE(SUBSTRING(@def, @at, 40), NCHAR(13), N' '), NCHAR(10), N' '), NCHAR(9), N' ')) NOT LIKE N'CREATE OR ALTER %'
        SET @def = STUFF(@def, @at, 6, N'ALTER');
    EXEC sys.sp_executesql @def;
    PRINT CONCAT(DB_NAME(), N'.dbo.FN_V4_SUBSIDY_CATEGORY: leaves out switched-off categories.');
END
GO
