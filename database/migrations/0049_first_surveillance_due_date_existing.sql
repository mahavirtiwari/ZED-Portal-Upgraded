-- Run on ZEDCS_V2_LIVE only, after 0048. Runs once: an extended property on dbo.MsmeCertifications
-- (V4_0049_FirstSurveDueDate) records that it ran, and later runs change nothing (the date stays as set then, even if
-- Admin changes the level's setting afterwards).
--
-- The first surveillance due date of certificates issued before 0048, recalculated from their level's setting (Admin ->
-- Certification Levels, FirstSurveillanceMonths, through 0048's dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS) counted from the
-- certification date, so the date the MSME, the verification page and the staff lists show agrees with the V4
-- surveillance schedule (Silver / Gold were given 12 months, the schedule counts 15; Bronze 450 days, the schedule 18
-- months). Only certificates whose first surveillance has not started:
--   certified (Bronze status 6, the site levels 16) with a certification date, phase ACTIVE (or none), the current
--   record (not a renamed _D / _R / _S copy), the first round not opened (EnableSurveillance1 not set: no notice yet) and
--   no surveillance record of the level in ZED_SURVEILLANCE; the level has surveillance on (else nothing changes).
-- Every change is written to dbo.MsmeHistory (StatusType 'V4FirstSurveDueDate': the old and the new date), which is also
-- the undo. One transaction.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50049, '0049 runs on ZEDCS_V2_LIVE only.', 1;
IF OBJECT_ID(N'dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS') IS NULL
    THROW 50049, 'Run 0048 first.', 1;
GO
IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID(N'dbo.MsmeCertifications') AND minor_id = 0
           AND name = N'V4_0049_FirstSurveDueDate')
BEGIN
    PRINT 'First surveillance due dates: already recalculated (0049 ran before).';
    RETURN;
END

BEGIN TRANSACTION;

DECLARE @Changed TABLE (Id int PRIMARY KEY, ZedId varchar(50), Certification varchar(50), OldDue datetime NULL, NewDue datetime);
UPDATE C SET FirstSurveDueDate = X.NewDue
OUTPUT inserted.Id, inserted.ZedId, inserted.Certification, deleted.FirstSurveDueDate, inserted.FirstSurveDueDate INTO @Changed
FROM dbo.MsmeCertifications C
CROSS APPLY (SELECT DATEADD(MONTH, dbo.FN_V4_FIRST_SURVEILLANCE_MONTHS(C.Certification), C.CertificationStatusDate) AS NewDue) X
WHERE C.CertificationStatusDate IS NOT NULL
  AND ((C.Certification = 'Bronze' AND C.CertificationStatus = 6) OR (C.Certification <> 'Bronze' AND C.CertificationStatus = 16))
  AND ISNULL(C.CertificationPhase, 'ACTIVE') = 'ACTIVE'
  AND C.ZedId NOT LIKE '%[_]%'
  AND ISNULL(C.EnableSurveillance1, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.dbo.MsmeCertifications S
                  WHERE (S.ZedId = C.ZedId OR S.ZedId LIKE C.ZedId + '[_]%') AND S.Certification = C.Certification)
  AND X.NewDue IS NOT NULL
  AND (C.FirstSurveDueDate IS NULL OR CAST(C.FirstSurveDueDate AS date) <> CAST(X.NewDue AS date));

INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
SELECT ZedId,
       CONCAT('First surveillance due date set to ', FORMAT(NewDue, 'MMMM d, yyyy'), ' from the level setting (was ',
              ISNULL(FORMAT(OldDue, 'MMMM d, yyyy'), 'not set'), ')'),
       GETDATE(), Certification, 'V4FirstSurveDueDate'
FROM @Changed;

EXEC sys.sp_addextendedproperty @name = N'V4_0049_FirstSurveDueDate', @value = N'First surveillance due dates recalculated (migration 0049)',
    @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'MsmeCertifications';

COMMIT;

DECLARE @n int = (SELECT COUNT(*) FROM @Changed);
PRINT CONCAT('First surveillance due dates recalculated: ', @n, ' certificate(s).');
SELECT Certification, COUNT(*) AS Certificates FROM @Changed GROUP BY Certification ORDER BY Certification;
GO
