-- Run on ZED_SURVEILLANCE (after 0028 and 0033; reads ZEDCS_V2_LIVE's levels, so after 0065 there). Additive and safe to
-- re-run (every deploy runs it).
--
-- Generic certification levels (2026-11-08), the surveillance side of 0065:
--   dbo.Msme.Is{Code}PaymentDone bit   for every V4 level (ZEDCS_V2_LIVE.dbo.SectionTypes or this database's SectionTypes,
--                                      IsCertificationLevel = 1, not Bronze / Silver / Gold), as ZED-X's of 0033 (the portal
--                                      adds it when the Admin adds the level; this migration when it could not).
--                                      SP_V4_SURVEILLANCE_PAID (0033) already sets it by name when it exists.
--   dbo.FN_V4_LEVEL_MODE(@Code)        as main's: 'Site' / 'Desktop' for a V4 level (ZED-X 'Site'), NULL otherwise; used by the
--                                      patched surveillance procedures (fix surveillance/08).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZED_SURVEILLANCE'
    THROW 50066, '0066 runs on ZED_SURVEILLANCE.', 1;
GO
DECLARE @Code varchar(50), @Sql nvarchar(max);
IF OBJECT_ID('tempdb..#V4Levels') IS NOT NULL DROP TABLE #V4Levels;
CREATE TABLE #V4Levels (Code varchar(50) NOT NULL PRIMARY KEY);
INSERT INTO #V4Levels (Code)
SELECT DISTINCT LTRIM(RTRIM(SectionType)) FROM ZEDCS_V2_LIVE.dbo.SectionTypes
WHERE IsCertificationLevel = 1 AND SectionType IS NOT NULL;
IF COL_LENGTH('dbo.SectionTypes', 'IsCertificationLevel') IS NOT NULL
    EXEC sys.sp_executesql N'INSERT INTO #V4Levels (Code)
        SELECT DISTINCT LTRIM(RTRIM(SectionType)) FROM dbo.SectionTypes s
        WHERE IsCertificationLevel = 1 AND SectionType IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM #V4Levels l WHERE l.Code = LTRIM(RTRIM(s.SectionType)));';
DELETE FROM #V4Levels
WHERE Code IN ('Bronze', 'Silver', 'Gold') OR LEN(Code) NOT BETWEEN 2 AND 20 OR Code NOT LIKE '[A-Za-z]%' OR Code LIKE '%[^A-Za-z0-9]%';

DECLARE levels CURSOR LOCAL FAST_FORWARD FOR SELECT Code FROM #V4Levels ORDER BY Code;
OPEN levels;
FETCH NEXT FROM levels INTO @Code;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF COL_LENGTH('dbo.Msme', 'Is' + @Code + 'PaymentDone') IS NULL
    BEGIN
        SET @Sql = N'ALTER TABLE dbo.Msme ADD ' + QUOTENAME('Is' + @Code + 'PaymentDone') + N' bit NULL;';
        EXEC sys.sp_executesql @Sql;
    END
    FETCH NEXT FROM levels INTO @Code;
END
CLOSE levels;
DEALLOCATE levels;
DROP TABLE #V4Levels;
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_LEVEL_MODE (@Code varchar(50))
RETURNS varchar(10)
AS
BEGIN
    -- V4_0066: 'Site' / 'Desktop' for a V4 level (main's SectionTypes: the Admin keeps the levels there), NULL for
    -- Bronze, Silver, Gold and unknown codes. ZED-X is always 'Site' (the procedures treat it as Gold).
    RETURN CASE
        WHEN @Code IS NULL OR LTRIM(RTRIM(@Code)) IN ('Bronze', 'Silver', 'Gold') THEN NULL
        WHEN LTRIM(RTRIM(@Code)) = 'ZEDX' THEN 'Site'
        ELSE (SELECT TOP (1) CASE WHEN AssessmentMode = 'Desktop' THEN 'Desktop' ELSE 'Site' END
              FROM ZEDCS_V2_LIVE.dbo.SectionTypes WHERE SectionType = LTRIM(RTRIM(@Code)) AND IsCertificationLevel = 1)
    END;
END
GO
