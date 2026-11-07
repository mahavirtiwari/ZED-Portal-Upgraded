-- New in V4 (not part of the legacy schema). Run on ZED_CONSULTANT only. Safe to re-run: CREATE OR ALTER of one
-- read-only procedure.
-- The Consultancy (handholding) portal's staff dashboard (Zed.Portal StaffDashboardController.Analytics), the same view
-- as the certification portal's (migration 0019) with handholding figures. The columns keep 0019's names; the page
-- names them for handholding:
--   Registered = units registered in this database; Certified = handholding completed (milestone 3 done: status 100 with
--   NcCount 3, or status 16; the first completion per unit and level); Bronze = handholding applications (Silver and
--   Gold, one per unit and level, from MsmePaymentInfo); Silver / Gold = the applications at that level.
--   @View 'registered': units registered between @From and @To (Msme.CreatedDate), their applications and completions
--         (any date); 'certified': completions between @From and @To, applications made in the range.
--   @Certification (Silver or Gold) keeps one level.
-- Consultant organisations (@RoleId 2) and consultants (3) see only their allocations (CertificationBodyUserId;
-- DesktopAssessorId or SiteAssessorId), a state-bound Ministry user its state (the API passes @State).
-- Result set 9, the status cards, as this database's SP_DASHBOARD_GET_DETAILS counts them (per level: applications,
-- milestone payments received, units at each completed milestone; Technology Intervention: total, approved, pending).
-- Result sets: 0 totals | 1 size | 2 gender | 3 social category | 4 months | 5 states | 6 districts | 7 sectors |
-- 8 districts of @State | 9 status cards | 10 years. Reads only (zed_v4_app has EXECUTE on schema dbo).
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
    @IncludeTestUnits bit        = 0
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
    DECLARE @ByDone bit = CASE WHEN @View = 'certified' THEN 1 ELSE 0 END;

    -- Units with the unit filters.
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
           CASE WHEN LOWER(LTRIM(RTRIM(B.Gender))) IN ('male', 'female') THEN LOWER(LTRIM(RTRIM(B.Gender))) ELSE 'OTHERS' END,
           ISNULL(NULLIF(LTRIM(RTRIM(B.SocialCategoryName)), ''), 'Not given')
    FROM dbo.Msme M
    INNER JOIN dbo.MsmeBasicInformation B ON B.ZedId = M.ZedId
    WHERE M.ZedId IS NOT NULL
      AND (@IncludeTestUnits = 1 OR ISNULL(B.UdyogAadharNo, '') NOT IN ('UDYAM-GJ-01-0013310', 'UDYAM-MH-23-0006117', 'UDYAM-UP-29-0003915'))
      AND (@State IS NULL OR M.PStateName = @State)
      AND (@District IS NULL OR M.PDistrictName = @District)
      AND (@Size IS NULL OR M.EnterpriseTypee = @Size)
      AND (@SocialCategory IS NULL OR B.SocialCategoryName = @SocialCategory)
      AND (@Gender IS NULL
           OR (@Gender = 'OTHERS' AND ISNULL(LOWER(LTRIM(RTRIM(B.Gender))), '') NOT IN ('male', 'female'))
           OR (@Gender <> 'OTHERS' AND LOWER(LTRIM(RTRIM(B.Gender))) = LOWER(@Gender)))
    OPTION (RECOMPILE);
    CREATE CLUSTERED INDEX IX_U ON #U (ZedId);

    -- Consultant organisations and consultants: only the units allotted to them.
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

    -- Handholding rows (Silver / Gold) of the units, with their unit's ZedId.
    CREATE TABLE #A
    (
        Id int NOT NULL, ZedId varchar(50) NOT NULL, Certification varchar(50) NULL, CertificationStatus int NULL, NcCount int NULL,
        CertificationStatusDate datetime NULL, CreatedDate datetime NULL, UnitCreatedDate datetime NULL,
        CertificationBodyUserId varchar(100) NULL, DesktopAssessorId varchar(100) NULL, SiteAssessorId varchar(100) NULL
    );
    INSERT #A
    SELECT X.Id, X.BaseZedId, X.Certification, X.CertificationStatus, X.NcCount, X.CertificationStatusDate, X.CreatedDate,
           (SELECT MIN(U.CreatedDate) FROM #U U WHERE U.ZedId = X.BaseZedId),
           X.CertificationBodyUserId, X.DesktopAssessorId, X.SiteAssessorId
    FROM (
        SELECT C.Id,
               CASE
                   WHEN CHARINDEX('_D', C.ZedId) > 0 AND (CHARINDEX('_R_', C.ZedId) = 0 OR CHARINDEX('_D', C.ZedId) < CHARINDEX('_R_', C.ZedId))
                       THEN LEFT(C.ZedId, CHARINDEX('_D', C.ZedId) - 1)
                   WHEN CHARINDEX('_R_', C.ZedId) > 0 THEN LEFT(C.ZedId, CHARINDEX('_R_', C.ZedId) - 1)
                   ELSE C.ZedId
               END AS BaseZedId,
               C.Certification, C.CertificationStatus, C.NcCount, C.CertificationStatusDate, C.CreatedDate,
               C.CertificationBodyUserId, C.DesktopAssessorId, C.SiteAssessorId
        FROM dbo.MsmeCertifications C
        WHERE C.ZedId IS NOT NULL AND C.Certification IN ('Silver', 'Gold')
    ) X
    WHERE EXISTS (SELECT 1 FROM #U U WHERE U.ZedId = X.BaseZedId)
    OPTION (RECOMPILE);
    IF @OwnOnly = 1
        DELETE FROM #A
        WHERE NOT ((@RoleId = '2' AND CertificationBodyUserId = @UserId)
                   OR (@RoleId = '3' AND (DesktopAssessorId = @UserId OR SiteAssessorId = @UserId)));
    CREATE CLUSTERED INDEX IX_A ON #A (ZedId);

    -- Milestone payments of the units (MsmePaymentInfo), one row per unit, level and milestone.
    CREATE TABLE #P (ZedId varchar(50) NOT NULL, Level varchar(10) NOT NULL, MileStone int NOT NULL, PaidDate datetime NULL, UnitCreatedDate datetime NULL);
    INSERT #P
    SELECT X.BaseZedId, X.Certification, X.MileStone, MIN(X.CreatedDate), (SELECT MIN(U.CreatedDate) FROM #U U WHERE U.ZedId = X.BaseZedId)
    FROM (
        SELECT CASE WHEN CHARINDEX('_D', P.ZedId) > 0 THEN LEFT(P.ZedId, CHARINDEX('_D', P.ZedId) - 1) ELSE P.ZedId END AS BaseZedId,
               P.Certification, ISNULL(P.MileStoneNum, 1) AS MileStone, P.CreatedDate
        FROM dbo.MsmePaymentInfo P
        WHERE P.ZedId IS NOT NULL AND P.Certification IN ('Silver', 'Gold')
    ) X
    WHERE EXISTS (SELECT 1 FROM #U U WHERE U.ZedId = X.BaseZedId)
    GROUP BY X.BaseZedId, X.Certification, X.MileStone;
    -- Consultant organisations and consultants: the payments of the units and levels allotted to them.
    IF @OwnOnly = 1
        DELETE P FROM #P P WHERE NOT EXISTS (SELECT 1 FROM #A A WHERE A.ZedId = P.ZedId AND A.Certification = P.Level);
    CREATE CLUSTERED INDEX IX_P ON #P (ZedId);

    -- Applications: one per unit and level (its first payment), and completions: milestone 3 done (first time).
    CREATE TABLE #App (ZedId varchar(50) NOT NULL, Level varchar(10) NOT NULL, AppliedDate datetime NULL);
    INSERT #App SELECT ZedId, Level, MIN(PaidDate) FROM #P WHERE @Certification IS NULL OR Level = @Certification GROUP BY ZedId, Level;
    CREATE TABLE #C (ZedId varchar(50) NOT NULL, Level varchar(10) NOT NULL, CertDate datetime NULL);
    INSERT #C
    SELECT ZedId, Certification, MIN(CertificationStatusDate)
    FROM #A
    WHERE ((CertificationStatus = 100 AND NcCount = 3) OR CertificationStatus = 16)
      AND (@Certification IS NULL OR Certification = @Certification)
    GROUP BY ZedId, Certification;

    -- What the breakdowns count: registered units, or completed (unit, level) rows.
    CREATE TABLE #S
    (
        ZedId varchar(50) NOT NULL, Level varchar(10) NULL, EventDate datetime NULL, StateName varchar(100) NOT NULL,
        DistrictName varchar(100) NOT NULL, Size varchar(50) NOT NULL, Activity varchar(2000) NOT NULL, Gender varchar(50) NOT NULL,
        Social varchar(50) NOT NULL
    );
    IF @ByDone = 1
        INSERT #S
        SELECT U.ZedId, C.Level, C.CertDate, U.StateName, U.DistrictName, U.Size, U.Activity, U.Gender, U.Social
        FROM #C C INNER JOIN #U U ON U.ZedId = C.ZedId
        WHERE (@FromTime IS NULL OR C.CertDate >= @FromTime) AND (@ToNext IS NULL OR C.CertDate < @ToNext);
    ELSE
        INSERT #S
        SELECT U.ZedId, NULL, U.CreatedDate, U.StateName, U.DistrictName, U.Size, U.Activity, U.Gender, U.Social
        FROM #U U
        WHERE (@FromTime IS NULL OR U.CreatedDate >= @FromTime) AND (@ToNext IS NULL OR U.CreatedDate < @ToNext)
          AND (@Certification IS NULL OR EXISTS (SELECT 1 FROM #App A WHERE A.ZedId = U.ZedId));

    -- 0: totals (Registered, Certified = completed, Bronze = applications, Silver / Gold = applications at the level).
    IF @ByDone = 1
        SELECT (SELECT COUNT(*) FROM #U) AS Registered, (SELECT COUNT(*) FROM #S) AS Certified,
               COUNT(*) AS Bronze, ISNULL(SUM(CASE WHEN Level = 'Silver' THEN 1 ELSE 0 END), 0) AS Silver, ISNULL(SUM(CASE WHEN Level = 'Gold' THEN 1 ELSE 0 END), 0) AS Gold
        FROM #App
        WHERE (@FromTime IS NULL OR AppliedDate >= @FromTime) AND (@ToNext IS NULL OR AppliedDate < @ToNext);
    ELSE
        SELECT (SELECT COUNT(*) FROM #S) AS Registered,
               (SELECT COUNT(*) FROM #C C WHERE EXISTS (SELECT 1 FROM #S S WHERE S.ZedId = C.ZedId)) AS Certified,
               COUNT(*) AS Bronze, ISNULL(SUM(CASE WHEN Level = 'Silver' THEN 1 ELSE 0 END), 0) AS Silver, ISNULL(SUM(CASE WHEN Level = 'Gold' THEN 1 ELSE 0 END), 0) AS Gold
        FROM #App A
        WHERE EXISTS (SELECT 1 FROM #S S WHERE S.ZedId = A.ZedId);

    -- 1-3: splits.
    SELECT Size AS Label, COUNT(*) AS Total FROM #S GROUP BY Size ORDER BY Total DESC;
    SELECT Gender AS Label, COUNT(*) AS Total FROM #S GROUP BY Gender ORDER BY Total DESC;
    SELECT Social AS Label, COUNT(*) AS Total FROM #S GROUP BY Social ORDER BY Total DESC;

    -- The trend: registrations (by registration date) and completions (by completion date), both in the range.
    CREATE TABLE #T (Kind char(1) NOT NULL, EventDate datetime NOT NULL);
    INSERT #T
    SELECT 'R', U.CreatedDate FROM #U U
    WHERE U.CreatedDate IS NOT NULL
      AND (@FromTime IS NULL OR U.CreatedDate >= @FromTime) AND (@ToNext IS NULL OR U.CreatedDate < @ToNext)
      AND (@Certification IS NULL OR EXISTS (SELECT 1 FROM #App A WHERE A.ZedId = U.ZedId));
    INSERT #T
    SELECT 'C', C.CertDate FROM #C C
    WHERE C.CertDate IS NOT NULL AND (@FromTime IS NULL OR C.CertDate >= @FromTime) AND (@ToNext IS NULL OR C.CertDate < @ToNext);

    -- 4: the last 12 months of the range.
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

    -- 8: the districts of the chosen state.
    SELECT DISTINCT LTRIM(RTRIM(M.PDistrictName)) AS Label
    FROM dbo.Msme M
    WHERE @State IS NOT NULL AND M.PStateName = @State AND NULLIF(LTRIM(RTRIM(M.PDistrictName)), '') IS NOT NULL
    ORDER BY Label;

    -- 9: the status cards. The date range: the units' registration ('registered') or the application / payment date.
    ;WITH Stage AS (
        -- The latest row of each unit and level: the milestone it stands at (status 100 with NcCount = the milestone done).
        SELECT A.ZedId, A.Certification, A.CertificationStatus, A.NcCount,
               ROW_NUMBER() OVER (PARTITION BY A.ZedId, A.Certification ORDER BY A.Id DESC) AS rn
        FROM #A A
        WHERE (@FromTime IS NULL OR (CASE WHEN @ByDone = 1 THEN A.CreatedDate ELSE A.UnitCreatedDate END) >= @FromTime)
          AND (@ToNext IS NULL OR (CASE WHEN @ByDone = 1 THEN A.CreatedDate ELSE A.UnitCreatedDate END) < @ToNext)
    ),
    Paid AS (
        SELECT P.ZedId, P.Level, P.MileStone
        FROM #P P
        WHERE (@FromTime IS NULL OR (CASE WHEN @ByDone = 1 THEN P.PaidDate ELSE P.UnitCreatedDate END) >= @FromTime)
          AND (@ToNext IS NULL OR (CASE WHEN @ByDone = 1 THEN P.PaidDate ELSE P.UnitCreatedDate END) < @ToNext)
    ),
    Fa AS (
        SELECT F.TechUpgradeStatus, F.VerificationStatus
        FROM dbo.FinancialAssistance F
        WHERE EXISTS (SELECT 1 FROM #U U WHERE U.ZedId = F.ZedId)
          AND (@OwnOnly = 0 OR (@RoleId = '2' AND F.CertificationBodyUserId = @UserId) OR (@RoleId = '3' AND F.FinancialAssessorId = @UserId))
          AND (@FromTime IS NULL OR (CASE WHEN @ByDone = 1 THEN F.CreatedDate ELSE (SELECT MIN(U.CreatedDate) FROM #U U WHERE U.ZedId = F.ZedId) END) >= @FromTime)
          AND (@ToNext IS NULL OR (CASE WHEN @ByDone = 1 THEN F.CreatedDate ELSE (SELECT MIN(U.CreatedDate) FROM #U U WHERE U.ZedId = F.ZedId) END) < @ToNext)
    )
    SELECT
        (SELECT COUNT(DISTINCT ZedId) FROM Paid WHERE Level = 'Silver') AS SilverTotal,
        (SELECT COUNT(*) FROM Paid WHERE Level = 'Silver' AND MileStone = 1) AS SilverM1PaymentDone,
        (SELECT COUNT(*) FROM Stage WHERE rn = 1 AND Certification = 'Silver' AND CertificationStatus = 100 AND NcCount = 1) AS SilverCompleted,
        (SELECT COUNT(*) FROM Paid WHERE Level = 'Silver' AND MileStone = 2) AS SilverM2PaymentDone,
        (SELECT COUNT(*) FROM Stage WHERE rn = 1 AND Certification = 'Silver' AND CertificationStatus = 100 AND NcCount = 2) AS SilverPending,
        (SELECT COUNT(*) FROM Paid WHERE Level = 'Silver' AND MileStone = 3) AS SilverM3PaymentDone,
        (SELECT COUNT(*) FROM Stage WHERE rn = 1 AND Certification = 'Silver' AND ((CertificationStatus = 100 AND NcCount = 3) OR CertificationStatus = 16)) AS SaSilverCompleted,
        (SELECT COUNT(DISTINCT ZedId) FROM Paid WHERE Level = 'Gold') AS GoldTotal,
        (SELECT COUNT(*) FROM Paid WHERE Level = 'Gold' AND MileStone = 1) AS GoldM1PaymentDone,
        (SELECT COUNT(*) FROM Stage WHERE rn = 1 AND Certification = 'Gold' AND CertificationStatus = 100 AND NcCount = 1) AS GoldCompleted,
        (SELECT COUNT(*) FROM Paid WHERE Level = 'Gold' AND MileStone = 2) AS GoldM2PaymentDone,
        (SELECT COUNT(*) FROM Stage WHERE rn = 1 AND Certification = 'Gold' AND CertificationStatus = 100 AND NcCount = 2) AS GoldPending,
        (SELECT COUNT(*) FROM Paid WHERE Level = 'Gold' AND MileStone = 3) AS GoldM3PaymentDone,
        (SELECT COUNT(*) FROM Stage WHERE rn = 1 AND Certification = 'Gold' AND ((CertificationStatus = 100 AND NcCount = 3) OR CertificationStatus = 16)) AS SaGoldCompleted,
        (SELECT COUNT(*) FROM Fa WHERE TechUpgradeStatus NOT IN (0, 1, 7) AND ISNULL(VerificationStatus, 0) <> 5) AS FaTotal,
        (SELECT COUNT(*) FROM Fa WHERE TechUpgradeStatus = 16 AND VerificationStatus = 6) AS FaCompleted,
        (SELECT COUNT(*) FROM Fa WHERE TechUpgradeStatus IN (2, 3, 4, 5, 6, 8, 9, 10)) AS FaPending;

    -- 10: the year-wise trend.
    SELECT YEAR(EventDate) AS Year,
           SUM(CASE WHEN Kind = 'R' THEN 1 ELSE 0 END) AS Registered, SUM(CASE WHEN Kind = 'C' THEN 1 ELSE 0 END) AS Certified
    FROM #T
    GROUP BY YEAR(EventDate)
    ORDER BY Year;
END
GO
