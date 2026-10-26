-- New in V4 (not part of the legacy schema). Run on ZEDCS_V2_LIVE only. Safe to re-run: CREATE OR ALTER of one
-- read-only procedure.
-- The staff dashboard's "ZED Dashboard" and "ZED Certification" views (Zed.Portal StaffDashboardController.Analytics),
-- the same figures as the ministry's Power BI pages: registered units or certified units with the filters, their split
-- by MSME size, gender and social category, by month, and the ranking of states, districts and two-digit activities.
--   @View 'registered': units registered between @From and @To (Msme.CreatedDate); Bronze/Silver/Gold = those units
--         certified at that level (any date); @Certification keeps the units certified at that level.
--   @View 'certified': certifications completed between @From and @To (MsmeCertifications.CertificationStatusDate of
--         the first completion; Bronze status 6, Silver and Gold 16, as SP_DASHBOARD_COUNTS_BY_FILTERS), one per unit
--         and level; @Certification limits it to one level.
-- The test Udyam numbers are left out, as in SP_DASHBOARD_GET_DETAILS. Re-certification and duplicate rows (ZedId with
-- "_R_..." or "_D...") count for their unit, as there. Reads only; the V4 logins have EXECUTE on schema dbo (zed_v4_app).
-- Result sets: 0 totals | 1 MSME size | 2 gender | 3 social category | 4 months (last 12 of the range: registrations and
-- certifications, each by its own date) | 5 states |
-- 6 districts | 7 two-digit activities (all, the page scrolls and sorts them) | 8 districts of @State (filter choices) |
-- 9 the status cards (Total, Pending, NC Raised, Certified, Rejected per level): SP_DASHBOARD_GET_DETAILS's counts for
--   @UserId/@RoleId (agencies and assessors: their own allotments; the other dashboard roles: the whole portal), limited
--   to the filtered units and to the date range: the units' registration ('registered') or the application date
--   ('certified', MsmeCertifications.CreatedDate) |
-- 10 years (registrations and certifications per year, each by its own date, in the range).
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
    @To             date         = NULL,
    @UserId         varchar(100) = NULL,
    @RoleId         varchar(10)  = NULL
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
           -- Male, female; anything else (others, not given) counts as OTHERS.
           CASE WHEN LOWER(LTRIM(RTRIM(B.Gender))) IN ('male', 'female') THEN LOWER(LTRIM(RTRIM(B.Gender))) ELSE 'OTHERS' END,
           ISNULL(NULLIF(LTRIM(RTRIM(B.SocialCategoryName)), ''), 'Not given')
    FROM dbo.Msme M
    INNER JOIN dbo.MsmeBasicInformation B ON B.ZedId = M.ZedId
    WHERE M.ZedId IS NOT NULL
      AND ISNULL(B.UdyogAadharNo, '') NOT IN ('UDYAM-GJ-01-0013310', 'UDYAM-MH-23-0006117', 'UDYAM-UP-29-0003915', 'UDYAM-UP-16-0001476')
      AND (@State IS NULL OR M.PStateName = @State)
      AND (@District IS NULL OR M.PDistrictName = @District)
      AND (@Size IS NULL OR M.EnterpriseTypee = @Size)
      AND (@SocialCategory IS NULL OR B.SocialCategoryName = @SocialCategory)
      AND (@Gender IS NULL
           OR (@Gender = 'OTHERS' AND ISNULL(LOWER(LTRIM(RTRIM(B.Gender))), '') NOT IN ('male', 'female'))
           OR (@Gender <> 'OTHERS' AND LOWER(LTRIM(RTRIM(B.Gender))) = LOWER(@Gender)))
    OPTION (RECOMPILE);
    CREATE CLUSTERED INDEX IX_U ON #U (ZedId);

    -- Every certification row of the filtered units, with its unit's ZedId (re-certification "_R_...", duplicates "_D...").
    CREATE TABLE #A
    (
        Id int NOT NULL, ZedId varchar(50) NOT NULL, Certification varchar(50) NULL, CertificationStatus int NULL,
        CertificationStatusDate datetime NULL, CreatedDate datetime NULL, UnitCreatedDate datetime NULL, HasDaCert bit NOT NULL, HasSaCert bit NOT NULL,
        CertificationBodyUserId varchar(100) NULL, DesktopAssessorId varchar(100) NULL, SiteAssessorId varchar(100) NULL
    );
    INSERT #A
    SELECT X.Id, X.BaseZedId, X.Certification, X.CertificationStatus, X.CertificationStatusDate, X.CreatedDate,
           (SELECT MIN(U.CreatedDate) FROM #U U WHERE U.ZedId = X.BaseZedId),
           X.HasDaCert, X.HasSaCert, X.CertificationBodyUserId, X.DesktopAssessorId, X.SiteAssessorId
    FROM (
        SELECT C.Id,
               CASE
                   WHEN CHARINDEX('_D', C.ZedId) > 0 AND (CHARINDEX('_R_', C.ZedId) = 0 OR CHARINDEX('_D', C.ZedId) < CHARINDEX('_R_', C.ZedId))
                       THEN LEFT(C.ZedId, CHARINDEX('_D', C.ZedId) - 1)
                   WHEN CHARINDEX('_R_', C.ZedId) > 0 THEN LEFT(C.ZedId, CHARINDEX('_R_', C.ZedId) - 1)
                   ELSE C.ZedId
               END AS BaseZedId,
               C.Certification, C.CertificationStatus, C.CertificationStatusDate, C.CreatedDate,
               CAST(CASE WHEN C.DaCertificateNo IS NOT NULL THEN 1 ELSE 0 END AS bit) AS HasDaCert,
               CAST(CASE WHEN C.SaCertificateNo IS NOT NULL THEN 1 ELSE 0 END AS bit) AS HasSaCert,
               C.CertificationBodyUserId, C.DesktopAssessorId, C.SiteAssessorId
        FROM dbo.MsmeCertifications C
        WHERE C.ZedId IS NOT NULL
    ) X
    WHERE EXISTS (SELECT 1 FROM #U U WHERE U.ZedId = X.BaseZedId)
    OPTION (RECOMPILE);
    CREATE CLUSTERED INDEX IX_A ON #A (ZedId);

    -- Completed certifications, one per unit and level (its first completion).
    CREATE TABLE #C (ZedId varchar(50) NOT NULL, Level varchar(10) NOT NULL, CertDate datetime NULL);
    INSERT #C (ZedId, Level, CertDate)
    SELECT A.ZedId, A.Certification, MIN(A.CertificationStatusDate)
    FROM #A A
    WHERE (A.Certification = 'Bronze' AND A.CertificationStatus = 6) OR (A.Certification IN ('Silver', 'Gold') AND A.CertificationStatus = 16)
    GROUP BY A.ZedId, A.Certification;
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
          AND (@ToNext IS NULL OR U.CreatedDate < @ToNext)
          AND (@Certification IS NULL OR EXISTS (SELECT 1 FROM #C C WHERE C.ZedId = U.ZedId AND C.Level = @Certification));

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

    -- The trend: registrations (units of the filters, by registration date) and certifications (by certification date),
    -- both in the date range and, with a level chosen, for that level.
    CREATE TABLE #T (Kind char(1) NOT NULL, EventDate datetime NOT NULL);
    INSERT #T
    SELECT 'R', U.CreatedDate FROM #U U
    WHERE U.CreatedDate IS NOT NULL
      AND (@FromTime IS NULL OR U.CreatedDate >= @FromTime) AND (@ToNext IS NULL OR U.CreatedDate < @ToNext)
      AND (@Certification IS NULL OR EXISTS (SELECT 1 FROM #C C WHERE C.ZedId = U.ZedId AND C.Level = @Certification));
    INSERT #T
    SELECT 'C', C.CertDate FROM #C C
    WHERE C.CertDate IS NOT NULL
      AND (@Certification IS NULL OR C.Level = @Certification)
      AND (@FromTime IS NULL OR C.CertDate >= @FromTime) AND (@ToNext IS NULL OR C.CertDate < @ToNext);

    -- 4: the last 12 months of the range (up to @To, else up to the latest date).
    DECLARE @Last datetime = ISNULL(CAST(@To AS datetime), ISNULL((SELECT MAX(EventDate) FROM #T), GETDATE()));
    DECLARE @LastMonth date = DATEFROMPARTS(YEAR(@Last), MONTH(@Last), 1);
    DECLARE @FirstMonth date = DATEADD(MONTH, -11, @LastMonth);
    SELECT CONVERT(char(7), EventDate, 126) AS Month,
           SUM(CASE WHEN Kind = 'R' THEN 1 ELSE 0 END) AS Registered, SUM(CASE WHEN Kind = 'C' THEN 1 ELSE 0 END) AS Certified
    FROM #T
    WHERE EventDate >= @FirstMonth AND EventDate < DATEADD(MONTH, 1, @LastMonth)
    GROUP BY CONVERT(char(7), EventDate, 126)
    ORDER BY Month;

    -- 5-7: rankings.
    SELECT StateName AS Label, COUNT(*) AS Total FROM #S GROUP BY StateName ORDER BY Total DESC, Label;
    SELECT DistrictName AS Label, COUNT(*) AS Total FROM #S GROUP BY DistrictName ORDER BY Total DESC, Label;
    SELECT Activity AS Label, COUNT(*) AS Total FROM #S GROUP BY Activity ORDER BY Total DESC, Label;

    -- 8: the districts of the chosen state (the District filter's choices).
    SELECT DISTINCT LTRIM(RTRIM(M.PDistrictName)) AS Label
    FROM dbo.Msme M
    WHERE @State IS NOT NULL AND M.PStateName = @State AND NULLIF(LTRIM(RTRIM(M.PDistrictName)), '') IS NOT NULL
    ORDER BY Label;

    -- 9: the status cards, as SP_DASHBOARD_GET_DETAILS counts them, for the filtered units and applications in the range.
    IF @RoleId IN ('2', '3')
    BEGIN
        ;WITH Mine AS (
            SELECT A.ZedId, A.Certification, A.CertificationStatus, A.HasDaCert, A.HasSaCert,
                   ROW_NUMBER() OVER (PARTITION BY A.ZedId, A.Certification, CASE WHEN A.CertificationStatus = 99 THEN 1 ELSE 0 END
                                      ORDER BY CASE WHEN A.HasSaCert = 1 THEN 1 WHEN A.HasDaCert = 1 THEN 2 ELSE 3 END, A.Id DESC) AS rn
            FROM #A A
            WHERE ((@RoleId = '2' AND A.CertificationBodyUserId = @UserId) OR (@RoleId = '3' AND (A.DesktopAssessorId = @UserId OR A.SiteAssessorId = @UserId)))
              AND (@FromTime IS NULL OR (CASE WHEN @View = 'certified' THEN A.CreatedDate ELSE A.UnitCreatedDate END) >= @FromTime)
              AND (@ToNext IS NULL OR (CASE WHEN @View = 'certified' THEN A.CreatedDate ELSE A.UnitCreatedDate END) < @ToNext)
        )
        SELECT
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' THEN 1 ELSE 0 END), 0) AS BronzeTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND HasDaCert = 0 AND CertificationStatus < 6 AND CertificationStatus > 1 THEN 1 ELSE 0 END), 0) AS BronzePending,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus IN (4, 5, 7) THEN 1 ELSE 0 END), 0) AS BronzeNcRaised,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND HasDaCert = 1 THEN 1 ELSE 0 END), 0) AS BronzeCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS BronzeRejected,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' THEN 1 ELSE 0 END), 0) AS SilverTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND HasSaCert = 0 THEN 1 ELSE 0 END), 0) AS SaSilverPending,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus IN (14, 15, 17) THEN 1 ELSE 0 END), 0) AS SilverNcRaised,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND HasSaCert = 1 THEN 1 ELSE 0 END), 0) AS SaSilverCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS SilverRejected,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' THEN 1 ELSE 0 END), 0) AS GoldTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND HasSaCert = 0 THEN 1 ELSE 0 END), 0) AS SaGoldPending,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus IN (14, 15, 17) THEN 1 ELSE 0 END), 0) AS GoldNcRaised,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND HasSaCert = 1 THEN 1 ELSE 0 END), 0) AS SaGoldCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS GoldRejected
        FROM Mine WHERE rn = 1;
    END
    ELSE
    BEGIN
        ;WITH Deduped AS (
            SELECT A.ZedId, A.Certification, A.CertificationStatus,
                   ROW_NUMBER() OVER (PARTITION BY A.ZedId, A.Certification, CASE WHEN A.CertificationStatus = 99 THEN 1 ELSE 0 END
                                      ORDER BY CASE WHEN A.CertificationStatus = 16 THEN 1 WHEN A.CertificationStatus = 6 THEN 2 ELSE 3 END, A.Id DESC) AS rn
            FROM #A A
            WHERE (@FromTime IS NULL OR (CASE WHEN @View = 'certified' THEN A.CreatedDate ELSE A.UnitCreatedDate END) >= @FromTime)
              AND (@ToNext IS NULL OR (CASE WHEN @View = 'certified' THEN A.CreatedDate ELSE A.UnitCreatedDate END) < @ToNext)
        )
        SELECT
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus <> 1 THEN 1 ELSE 0 END), 0) AS BronzeTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus IN (2, 3) THEN 1 ELSE 0 END), 0) AS BronzePending,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus IN (4, 5, 7) THEN 1 ELSE 0 END), 0) AS BronzeNcRaised,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus = 6 THEN 1 ELSE 0 END), 0) AS BronzeCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS BronzeRejected,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus <> 1 THEN 1 ELSE 0 END), 0) AS SilverTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13) THEN 1 ELSE 0 END), 0) AS SaSilverPending,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus IN (14, 15, 17) THEN 1 ELSE 0 END), 0) AS SilverNcRaised,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus = 16 THEN 1 ELSE 0 END), 0) AS SaSilverCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS SilverRejected,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus <> 1 THEN 1 ELSE 0 END), 0) AS GoldTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13) THEN 1 ELSE 0 END), 0) AS SaGoldPending,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus IN (14, 15, 17) THEN 1 ELSE 0 END), 0) AS GoldNcRaised,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus = 16 THEN 1 ELSE 0 END), 0) AS SaGoldCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS GoldRejected
        FROM Deduped WHERE rn = 1;
    END

    -- 10: the year-wise trend.
    SELECT YEAR(EventDate) AS Year,
           SUM(CASE WHEN Kind = 'R' THEN 1 ELSE 0 END) AS Registered, SUM(CASE WHEN Kind = 'C' THEN 1 ELSE 0 END) AS Certified
    FROM #T
    GROUP BY YEAR(EventDate)
    ORDER BY Year;
END
GO
