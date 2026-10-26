-- New in V4 (not part of the legacy schema). Run on ZEDCS_V2_LIVE only. Safe to re-run: CREATE OR ALTER of one
-- read-only procedure.
-- The staff dashboard's "ZED Dashboard" and "ZED Certification" views (Zed.Portal StaffDashboardController.Analytics),
-- the same figures as the ministry's Power BI pages: registered units or certified units with the filters, their split
-- by MSME size, gender and social category, by month, and the ranking of states, districts and two-digit activities.
--   @View 'registered': units registered between @From and @To (Msme.CreatedDate); Bronze/Silver/Gold = those units
--         certified at that level (any date).
--   @View 'certified': certifications completed between @From and @To (MsmeCertifications.CertificationStatusDate of
--         the first completion; Bronze status 6, Silver and Gold 16, as SP_DASHBOARD_COUNTS_BY_FILTERS), one per unit
--         and level; @Certification limits it to one level.
-- The three test Udyam numbers are left out, as in SP_DASHBOARD_COUNTS_BY_FILTERS. Re-certification rows (ZedId with
-- "_R" and the row id) count for their unit. Reads only; the V4 logins have EXECUTE on schema dbo (zed_v4_app).
-- Result sets: 0 totals | 1 MSME size | 2 gender | 3 social category | 4 months (last 12 of the range) | 5 states |
-- 6 districts (top 50) | 7 two-digit activities (top 50) | 8 districts of @State (filter choices).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_DASHBOARD_ANALYTICS
    @View           varchar(20)  = 'registered',
    @State          varchar(100) = NULL,
    @District       varchar(100) = NULL,
    @Certification  varchar(10)  = NULL,
    @Gender         varchar(50)  = NULL,
    @Size           varchar(50)  = NULL,
    @SocialCategory varchar(50)  = NULL,
    @From           date         = NULL,
    @To             date         = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @State = '' SET @State = NULL;
    IF @District = '' SET @District = NULL;
    IF @Certification = '' SET @Certification = NULL;
    IF @Gender = '' SET @Gender = NULL;
    IF @Size = '' SET @Size = NULL;
    IF @SocialCategory = '' SET @SocialCategory = NULL;
    DECLARE @FromTime datetime = CAST(@From AS datetime);
    DECLARE @ToNext datetime = DATEADD(DAY, 1, CAST(@To AS datetime));

    -- Units with the unit filters (no dates yet).
    CREATE TABLE #U
    (
        ZedId varchar(50) NOT NULL, CreatedDate datetime NULL, StateName varchar(100) NOT NULL, DistrictName varchar(100) NOT NULL,
        Size varchar(50) NOT NULL, Activity varchar(2000) NOT NULL, Gender varchar(50) NOT NULL, Social varchar(50) NOT NULL
    );
    INSERT #U (ZedId, CreatedDate, StateName, DistrictName, Size, Activity, Gender, Social)
    SELECT M.ZedId, M.CreatedDate,
           ISNULL(NULLIF(LTRIM(RTRIM(M.PStateName)), ''), 'Not given'),
           ISNULL(NULLIF(LTRIM(RTRIM(M.PDistrictName)), ''), 'Not given'),
           ISNULL(NULLIF(LTRIM(RTRIM(M.EnterpriseTypee)), ''), 'Not given'),
           ISNULL(NULLIF(LTRIM(RTRIM(M.TwoDigitActivity)), ''), 'Not given'),
           ISNULL(NULLIF(LTRIM(RTRIM(B.Gender)), ''), 'NA'),
           ISNULL(NULLIF(LTRIM(RTRIM(B.SocialCategoryName)), ''), 'Not given')
    FROM dbo.Msme M
    INNER JOIN dbo.MsmeBasicInformation B ON B.ZedId = M.ZedId
    WHERE M.ZedId IS NOT NULL
      AND ISNULL(B.UdyogAadharNo, '') NOT IN ('UDYAM-GJ-01-0013310', 'UDYAM-MH-23-0006117', 'UDYAM-UP-29-0003915')
      AND (@State IS NULL OR M.PStateName = @State)
      AND (@District IS NULL OR M.PDistrictName = @District)
      AND (@Size IS NULL OR M.EnterpriseTypee = @Size)
      AND (@SocialCategory IS NULL OR B.SocialCategoryName = @SocialCategory)
      AND (@Gender IS NULL OR B.Gender = @Gender OR (@Gender = 'NA' AND NULLIF(LTRIM(RTRIM(B.Gender)), '') IS NULL))
    OPTION (RECOMPILE);
    CREATE CLUSTERED INDEX IX_U ON #U (ZedId);

    -- Completed certifications, one per unit and level (its first completion).
    CREATE TABLE #C (ZedId varchar(50) NOT NULL, Level varchar(10) NOT NULL, CertDate datetime NULL);
    INSERT #C (ZedId, Level, CertDate)
    SELECT X.BaseZedId, X.Certification, MIN(X.CertificationStatusDate)
    FROM (
        SELECT CASE WHEN C.ZedId LIKE '%[_]R%' THEN REPLACE(REPLACE(C.ZedId, '_R', ''), CONCAT('_', C.Id), '') ELSE C.ZedId END AS BaseZedId,
               C.Certification, C.CertificationStatusDate
        FROM dbo.MsmeCertifications C
        WHERE C.ZedId IS NOT NULL
          AND ((C.Certification = 'Bronze' AND C.CertificationStatus = 6) OR (C.Certification IN ('Silver', 'Gold') AND C.CertificationStatus = 16))
    ) X
    GROUP BY X.BaseZedId, X.Certification
    OPTION (RECOMPILE);
    CREATE CLUSTERED INDEX IX_C ON #C (ZedId);

    -- What the breakdowns count: registered units, or certified (unit, level) rows.
    CREATE TABLE #S
    (
        ZedId varchar(50) NOT NULL, Level varchar(10) NULL, EventDate datetime NULL, StateName varchar(100) NOT NULL,
        DistrictName varchar(100) NOT NULL, Size varchar(50) NOT NULL, Activity varchar(2000) NOT NULL, Gender varchar(50) NOT NULL,
        Social varchar(50) NOT NULL
    );
    IF @View = 'certified'
        INSERT #S
        SELECT U.ZedId, C.Level, C.CertDate, U.StateName, U.DistrictName, U.Size, U.Activity, U.Gender, U.Social
        FROM #C C INNER JOIN #U U ON U.ZedId = C.ZedId
        WHERE (@Certification IS NULL OR C.Level = @Certification)
          AND (@FromTime IS NULL OR C.CertDate >= @FromTime)
          AND (@ToNext IS NULL OR C.CertDate < @ToNext);
    ELSE
        INSERT #S
        SELECT U.ZedId, NULL, U.CreatedDate, U.StateName, U.DistrictName, U.Size, U.Activity, U.Gender, U.Social
        FROM #U U
        WHERE (@FromTime IS NULL OR U.CreatedDate >= @FromTime)
          AND (@ToNext IS NULL OR U.CreatedDate < @ToNext);

    -- 0: totals.
    IF @View = 'certified'
        SELECT (SELECT COUNT(*) FROM #U) AS Registered, COUNT(*) AS Certified,
               SUM(CASE WHEN Level = 'Bronze' THEN 1 ELSE 0 END) AS Bronze,
               SUM(CASE WHEN Level = 'Silver' THEN 1 ELSE 0 END) AS Silver,
               SUM(CASE WHEN Level = 'Gold' THEN 1 ELSE 0 END) AS Gold
        FROM #S;
    ELSE
        SELECT (SELECT COUNT(*) FROM #S) AS Registered,
               (SELECT COUNT(*) FROM #C C WHERE EXISTS (SELECT 1 FROM #S S WHERE S.ZedId = C.ZedId)) AS Certified,
               (SELECT COUNT(*) FROM #C C WHERE C.Level = 'Bronze' AND EXISTS (SELECT 1 FROM #S S WHERE S.ZedId = C.ZedId)) AS Bronze,
               (SELECT COUNT(*) FROM #C C WHERE C.Level = 'Silver' AND EXISTS (SELECT 1 FROM #S S WHERE S.ZedId = C.ZedId)) AS Silver,
               (SELECT COUNT(*) FROM #C C WHERE C.Level = 'Gold' AND EXISTS (SELECT 1 FROM #S S WHERE S.ZedId = C.ZedId)) AS Gold;

    -- 1-3: splits.
    SELECT Size AS Label, COUNT(*) AS Total FROM #S GROUP BY Size ORDER BY Total DESC;
    SELECT Gender AS Label, COUNT(*) AS Total FROM #S GROUP BY Gender ORDER BY Total DESC;
    SELECT Social AS Label, COUNT(*) AS Total FROM #S GROUP BY Social ORDER BY Total DESC;

    -- 4: the last 12 months of the range (up to @To, else up to the latest date).
    DECLARE @LastMonth date = DATEFROMPARTS(YEAR(ISNULL(@To, ISNULL((SELECT MAX(EventDate) FROM #S), GETDATE()))),
                                            MONTH(ISNULL(@To, ISNULL((SELECT MAX(EventDate) FROM #S), GETDATE()))), 1);
    DECLARE @FirstMonth date = DATEADD(MONTH, -11, @LastMonth);
    SELECT CONVERT(char(7), EventDate, 126) AS Month, COUNT(*) AS Total
    FROM #S
    WHERE EventDate >= @FirstMonth AND EventDate < DATEADD(MONTH, 1, @LastMonth)
    GROUP BY CONVERT(char(7), EventDate, 126)
    ORDER BY Month;

    -- 5-7: rankings.
    SELECT StateName AS Label, COUNT(*) AS Total FROM #S GROUP BY StateName ORDER BY Total DESC, Label;
    SELECT TOP (50) DistrictName AS Label, COUNT(*) AS Total FROM #S GROUP BY DistrictName ORDER BY Total DESC, Label;
    SELECT TOP (50) Activity AS Label, COUNT(*) AS Total FROM #S GROUP BY Activity ORDER BY Total DESC, Label;

    -- 8: the districts of the chosen state (the District filter's choices).
    SELECT DISTINCT LTRIM(RTRIM(M.PDistrictName)) AS Label
    FROM dbo.Msme M
    WHERE @State IS NOT NULL AND M.PStateName = @State AND NULLIF(LTRIM(RTRIM(M.PDistrictName)), '') IS NOT NULL
    ORDER BY Label;
END
GO
