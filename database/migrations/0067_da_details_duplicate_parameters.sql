-- Run on ZEDCS_V2_LIVE (after 0050). Safe to re-run: the edit is made once (marker V4_0067 in the procedure).
--
-- Assessment Details (staff/assessment/da-details) failed with "Subquery returned more than 1 value" (2026-11-08, ZEDM000001
-- Bronze). SP_ASSESSMENT_DA_DETAILS reads each parameter's "in surveillance" flag with
--     (select SurveMandatories from sections SS where SS.sectioncode=S.sectioncode and SectionType=@Certification)
-- which fails as soon as dbo.Sections has two rows of the level with the same parameter code (also "1" and "1 ": SQL
-- compares without trailing spaces). This takes one row: the one marked Yes, else the first. Nothing else changes.
-- When the live text differs from the reviewed one, nothing is changed and a warning is printed (the run goes on).
-- Find such duplicates (read-only):
--     SELECT SectionType, LTRIM(RTRIM(SectionCode)) AS Code, COUNT(*) AS Rows, STRING_AGG(CONCAT(Id, ': ', SectionName), ' | ')
--     FROM dbo.Sections GROUP BY SectionType, LTRIM(RTRIM(SectionCode)) HAVING COUNT(*) > 1;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50067, '0067 runs on ZEDCS_V2_LIVE only.', 1;
GO
DECLARE @id int = OBJECT_ID(N'dbo.SP_ASSESSMENT_DA_DETAILS', 'P');
DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@id);
DECLARE @find nvarchar(400) = N'(select SurveMandatories from sections SS where SS.sectioncode=S.sectioncode and SectionType=@Certification) SurveMandatories';
DECLARE @rep nvarchar(600) = N'(select TOP (1) SurveMandatories from sections SS where SS.sectioncode=S.sectioncode and SectionType=@Certification '
    + N'ORDER BY CASE WHEN SS.SurveMandatories = ''Yes'' THEN 0 ELSE 1 END, SS.Id) SurveMandatories /* V4_0067 */';
IF @id IS NULL
    PRINT CONCAT(DB_NAME(), N'.dbo.SP_ASSESSMENT_DA_DETAILS: not found, skipped.');
ELSE IF CHARINDEX(N'V4_0067', @def) > 0
    PRINT CONCAT(DB_NAME(), N'.dbo.SP_ASSESSMENT_DA_DETAILS: already edited.');
ELSE
BEGIN
    DECLARE @count int = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @find, N''))) / DATALENGTH(@find);
    IF @count <> 2
        PRINT CONCAT(N'WARNING ', DB_NAME(), N'.dbo.SP_ASSESSMENT_DA_DETAILS: the parameter lookup was found ', @count,
            N' time(s), expected 2. The live definition differs from the reviewed one: nothing was changed.');
    ELSE
    BEGIN
        SET @def = REPLACE(@def, @find, @rep);
        -- CREATE -> ALTER: the first word outside the leading comments and blanks (as 0050's helper).
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
            PRINT CONCAT(N'WARNING ', DB_NAME(), N'.dbo.SP_ASSESSMENT_DA_DETAILS: the definition does not start with CREATE: nothing was changed.');
        ELSE
        BEGIN
            SET @def = STUFF(@def, @at, 6, N'ALTER');
            DECLARE @sql nvarchar(400) = CONCAT(N'SET ANSI_NULLS ', CASE WHEN OBJECTPROPERTY(@id, 'ExecIsAnsiNullsOn') = 1 THEN N'ON' ELSE N'OFF' END,
                N'; SET QUOTED_IDENTIFIER ', CASE WHEN OBJECTPROPERTY(@id, 'ExecIsQuotedIdentOn') = 1 THEN N'ON' ELSE N'OFF' END, N'; EXEC sys.sp_executesql @d;');
            EXEC sys.sp_executesql @sql, N'@d nvarchar(max)', @d = @def;
            PRINT CONCAT(DB_NAME(), N'.dbo.SP_ASSESSMENT_DA_DETAILS: edited (one row per parameter code).');
        END
    END
END
GO
