-- New in V4 (not part of the legacy schema). Run on ZED_SURVEILLANCE only. Safe to re-run: CREATE OR ALTER of one
-- read-only procedure.
-- The Surveillance portal's staff dashboard (Zed.Portal StaffDashboardController.Analytics): the same figures as the
-- certification portal's (migration 0019), for surveillance: registered units of this database, surveillance completed
-- (Bronze status 6, Silver and Gold 16, the first completion per unit and level), their split by MSME size, gender and
-- social category, by month and year, and the ranking of states, districts and sectors.
--   @View 'registered': units registered between @From and @To (Msme.CreatedDate); 'certified': surveillance completed
--         between @From and @To (CertificationStatusDate); @Certification keeps one level.
-- Agencies (@RoleId 2) and assessors (3) see only their allocations (CertificationBodyUserId; DesktopAssessorId or
-- SiteAssessorId), a state-bound Ministry user its state (the API passes @State).
-- Result set 9, the status cards, as this database's SP_DASHBOARD_GET_DETAILS counts them: Total, Surveillance Pending
-- (Bronze status 2-5, Silver and Gold 9-13), NC Raised (Silver and Gold 14), Surveillance Completed (6 / 16), Rejected (99);
-- agencies and assessors by their certificate numbers, as there.
-- Result sets as 0019: 0 totals | 1 size | 2 gender | 3 social category | 4 months | 5 states | 6 districts |
-- 7 sectors | 8 districts of @State | 9 status cards | 10 years. Reads only (zed_v4_app has EXECUTE on schema dbo).
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
    @RoleId         varchar(10)  = NULL,
    -- 1 on the test server: the four test Udyam numbers below are counted too (PortalOptions.DashboardCountsTestUnits).
    @IncludeTestUnits bit        = 0,
    -- The scope of a Master Admin / Ministry login (migration 0057; NULL = no limit): Manufacturing or Services, the level
    -- codes and the plant state codes, comma-separated.
    @ScopeSector    varchar(20)  = NULL,
    @ScopeLevels    varchar(200) = NULL,
    @ScopeStates    varchar(1000) = NULL
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
    IF @ScopeSector NOT IN ('Manufacturing', 'Services') SET @ScopeSector = NULL;
    IF @ScopeLevels = '' SET @ScopeLevels = NULL;
    IF @ScopeStates = '' SET @ScopeStates = NULL;
    -- A unit's category for the scope: the type of its NIC sector (Masters -> Sectors, migration 0025, read here only when
    -- the column exists), else its Udyam activity, as Zed.Portal UserSectorActivity.UnitCategory.
    CREATE TABLE #SectorTypes (SectorCode varchar(20) NOT NULL PRIMARY KEY, SectorType varchar(20) NOT NULL);
    IF @ScopeSector IS NOT NULL AND COL_LENGTH('dbo.Sectors', 'SectorType') IS NOT NULL
        INSERT #SectorTypes EXEC sp_executesql N'SELECT LTRIM(RTRIM(SectorCode)), MAX(SectorType) FROM dbo.Sectors
            WHERE SectorType IN (''Manufacturing'', ''Services'') AND NULLIF(LTRIM(RTRIM(SectorCode)), '''') IS NOT NULL GROUP BY LTRIM(RTRIM(SectorCode));';

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
      AND (@IncludeTestUnits = 1 OR ISNULL(B.UdyogAadharNo, '') NOT IN ('UDYAM-GJ-01-0013310', 'UDYAM-MH-23-0006117', 'UDYAM-UP-29-0003915'))
      AND (@State IS NULL OR M.PStateName = @State)
      AND (@ScopeStates IS NULL OR CHARINDEX(',' + CAST(M.PStateId AS varchar(12)) + ',', ',' + @ScopeStates + ',') > 0)
      AND (@ScopeSector IS NULL OR ISNULL(
            (SELECT T.SectorType FROM #SectorTypes T WHERE T.SectorCode = LEFT(LTRIM(M.TwoDigitActivity), 2)),
            CASE WHEN NULLIF(LTRIM(RTRIM(M.Activity)), '') IS NULL THEN @ScopeSector
                 WHEN LTRIM(M.Activity) LIKE 'Manuf%' THEN 'Manufacturing' ELSE 'Services' END) = @ScopeSector)
      AND (@District IS NULL OR M.PDistrictName = @District)
      AND (@Size IS NULL OR M.EnterpriseTypee = @Size)
      AND (@SocialCategory IS NULL OR B.SocialCategoryName = @SocialCategory)
      AND (@Gender IS NULL
           OR (@Gender = 'OTHERS' AND ISNULL(LOWER(LTRIM(RTRIM(B.Gender))), '') NOT IN ('male', 'female'))
           OR (@Gender <> 'OTHERS' AND LOWER(LTRIM(RTRIM(B.Gender))) = LOWER(@Gender)))
    OPTION (RECOMPILE);
    CREATE CLUSTERED INDEX IX_U ON #U (ZedId);

    -- Agencies and assessors: only the units allotted to them.
    DECLARE @OwnOnly bit = CASE WHEN @RoleId IN ('2', '3') THEN 1 ELSE 0 END;
    IF @OwnOnly = 1
    BEGIN
        SELECT DISTINCT
               CASE
                   WHEN CHARINDEX('_D', C.ZedId) > 0 AND (CHARINDEX('_R_', C.ZedId) = 0 OR CHARINDEX('_D', C.ZedId) < CHARINDEX('_R_', C.ZedId))
                       THEN LEFT(C.ZedId, CHARINDEX('_D', C.ZedId) - 1)
                   WHEN CHARINDEX('_R_', C.ZedId) > 0 THEN LEFT(C.ZedId, CHARINDEX('_R_', C.ZedId) - 1)
                   ELSE C.ZedId
               END AS ZedId
        INTO #Mine
        FROM dbo.MsmeCertifications C
        WHERE C.ZedId IS NOT NULL
          AND ((@RoleId = '2' AND C.CertificationBodyUserId = @UserId) OR (@RoleId = '3' AND (C.DesktopAssessorId = @UserId OR C.SiteAssessorId = @UserId)));
        DELETE U FROM #U U WHERE NOT EXISTS (SELECT 1 FROM #Mine M WHERE M.ZedId = U.ZedId);
    END

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
    -- Agencies and assessors: only the certifications allotted to them.
    IF @OwnOnly = 1
        DELETE FROM #A
        WHERE NOT ((@RoleId = '2' AND CertificationBodyUserId = @UserId)
                   OR (@RoleId = '3' AND (DesktopAssessorId = @UserId OR SiteAssessorId = @UserId)));
    -- The scope's levels (surveillance and milestone names count as their level).
    IF @ScopeLevels IS NOT NULL
        DELETE A FROM #A A
        WHERE ',' + @ScopeLevels + ',' NOT LIKE '%,' + CASE WHEN A.Certification LIKE 'Bronze%' THEN 'Bronze' WHEN A.Certification LIKE 'Silver%' THEN 'Silver'
              WHEN A.Certification LIKE 'Gold%' THEN 'Gold' WHEN A.Certification LIKE 'ZEDX%' THEN 'ZEDX' ELSE ISNULL(A.Certification, '') END + ',%';
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

    -- 9: the status cards, as this database's SP_DASHBOARD_GET_DETAILS counts them, for the filtered units and the date range.
    IF @RoleId IN ('2', '3')
    BEGIN
        ;WITH Mine AS (
            SELECT A.ZedId, A.Certification, A.CertificationStatus, A.HasDaCert, A.HasSaCert,
                   ROW_NUMBER() OVER (PARTITION BY A.ZedId, A.Certification, CASE WHEN A.CertificationStatus = 99 THEN 1 ELSE 0 END
                                      ORDER BY CASE WHEN A.HasSaCert = 1 THEN 1 WHEN A.HasDaCert = 1 THEN 2 ELSE 3 END, A.Id DESC) AS rn
            FROM #A A
            WHERE (@FromTime IS NULL OR (CASE WHEN @View = 'certified' THEN A.CreatedDate ELSE A.UnitCreatedDate END) >= @FromTime)
              AND (@ToNext IS NULL OR (CASE WHEN @View = 'certified' THEN A.CreatedDate ELSE A.UnitCreatedDate END) < @ToNext)
        )
        SELECT
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' THEN 1 ELSE 0 END), 0) AS BronzeTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND HasDaCert = 0 AND CertificationStatus > 1 AND CertificationStatus < 6 THEN 1 ELSE 0 END), 0) AS BronzePending,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND HasDaCert = 1 THEN 1 ELSE 0 END), 0) AS BronzeCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS BronzeRejected,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' THEN 1 ELSE 0 END), 0) AS SilverTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND HasDaCert = 0 AND CertificationStatus > 8 AND CertificationStatus < 14 THEN 1 ELSE 0 END), 0) AS SilverPending,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus = 14 AND HasSaCert = 0 THEN 1 ELSE 0 END), 0) AS SaSilverNcRaised,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND HasSaCert = 1 THEN 1 ELSE 0 END), 0) AS SaSilverCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS SilverRejected,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' THEN 1 ELSE 0 END), 0) AS GoldTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND HasDaCert = 0 AND CertificationStatus > 8 AND CertificationStatus < 14 THEN 1 ELSE 0 END), 0) AS GoldPending,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus = 14 AND HasSaCert = 0 THEN 1 ELSE 0 END), 0) AS SaGoldNcRaised,
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
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus > 1 AND CertificationStatus < 6 THEN 1 ELSE 0 END), 0) AS BronzePending,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus = 6 THEN 1 ELSE 0 END), 0) AS BronzeCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Bronze' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS BronzeRejected,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus <> 1 THEN 1 ELSE 0 END), 0) AS SilverTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus > 8 AND CertificationStatus < 14 THEN 1 ELSE 0 END), 0) AS SilverPending,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus = 14 THEN 1 ELSE 0 END), 0) AS SaSilverNcRaised,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus = 16 THEN 1 ELSE 0 END), 0) AS SaSilverCompleted,
            ISNULL(SUM(CASE WHEN Certification = 'Silver' AND CertificationStatus = 99 THEN 1 ELSE 0 END), 0) AS SilverRejected,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus <> 1 THEN 1 ELSE 0 END), 0) AS GoldTotal,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus > 8 AND CertificationStatus < 14 THEN 1 ELSE 0 END), 0) AS GoldPending,
            ISNULL(SUM(CASE WHEN Certification = 'Gold' AND CertificationStatus = 14 THEN 1 ELSE 0 END), 0) AS SaGoldNcRaised,
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
