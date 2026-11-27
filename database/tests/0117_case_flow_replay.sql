-- database\tests\0117_case_flow_replay.sql: replay of migration 0117 (each case keeps its flow) on a local ZEDV4CHK_ZEDCS_V2_LIVE copy.
-- Every scenario runs in a transaction that is rolled back: nothing stays in the database. Needs the seed units ZEDMSME998101/102
-- (Bronze) and ZEDMSME998201 (Silver) and the seed agency AGENCYX / assessors DAX1, SAX1 (mobile/tools/dev-seed). Prints one PASS / FAIL line per check
-- (results are printed, not stored: a rollback would remove stored ones).
SET NOCOUNT ON;
SET XACT_ABORT OFF;
GO
CREATE OR ALTER PROCEDURE #CHECK @Scenario varchar(10), @Step varchar(200), @Expected varchar(100), @Actual varchar(100)
AS PRINT CONCAT(CASE WHEN @Expected = ISNULL(@Actual, 'NULL') THEN 'PASS' ELSE 'FAIL' END, '  ', @Scenario, '  ', @Step, ': expected ', @Expected, ', got ', ISNULL(@Actual, 'NULL'));
GO

-- ---------------------------------------------------------------------------------------------------------------------------------
-- A. A Desktop only Bronze case with an open desktop NC (status 4); the Admin switches Bronze to Desktop + Onsite.
--    The case stays Desktop only: the NC round is answered, the desktop assessor's final submit raises the next NC for a "No",
--    else goes to the agency's check (5), and the agency's final submit certifies it at the desktop (6 with its number).
-- ---------------------------------------------------------------------------------------------------------------------------------
BEGIN TRAN;
DECLARE @z varchar(50) = 'ZEDMSME998101', @s varchar(100);
UPDATE dbo.MsmeCertifications SET CertificationStatus = 4, NcCount = 1, NcStatus = 1, Nc1Status = 1, Nc2Status = 0, DaCertificateNo = NULL,
    CertificationPhase = NULL, AssessmentFlow = 'Desktop', CertificationBodyUserId = 'AGENCYX', DesktopAssessorId = 'DAX1', DesktopAccepted = 1
WHERE ZedId = @z AND Certification = 'Bronze';
UPDATE dbo.SectionTypes SET AssessmentFlow = 'DesktopOnsite', AssessmentMode = 'Site' WHERE SectionType = 'Bronze' AND IsCertificationLevel = 1;
SET @s = CAST(dbo.FN_V4_LEVEL_DESKTOP('Bronze') AS varchar);        EXEC #CHECK 'A', 'level Bronze is no longer desktop only', '0', @s;
SET @s = CAST(dbo.FN_V4_CASE_DESKTOP(@z, 'Bronze') AS varchar);     EXEC #CHECK 'A', 'the case is still desktop only', '1', @s;
SET @s = dbo.FN_V4_CASE_FLOW(@z, 'Bronze');                         EXEC #CHECK 'A', 'case flow', 'Desktop', @s;
-- The MSME answers NC 1.
EXEC dbo.SP_APP_MSME_FINAL_SUBMIT @ZedId = @z, @RefId = 'R', @CertificationType = 'Bronze';
SET @s = (SELECT CONCAT(CertificationStatus, '/', Nc1Status) FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Bronze');
EXEC #CHECK 'A', 'NC 1 answered (status/Nc1Status)', '4/2', @s;
-- A requirement still "No" in round 1: the desktop assessor's final submit raises NC 2 (the case's desktop NCs).
INSERT dbo.MsmeRequirements (ZedId, SectionType, Conformance, NcCount) VALUES (@z, 'Bronze', 'No', 1);
EXEC dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT @ZedId = @z, @CertificationType = 'Bronze', @AssessorRemarks = 'replay';
SET @s = (SELECT CONCAT(CertificationStatus, '/', NcCount) FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Bronze');
EXEC #CHECK 'A', 'a "No" raises desktop NC 2 (status/NcCount)', '4/2', @s;
-- NC 2 answered and closed: on to the agency (5), then certified at the desktop.
UPDATE dbo.MsmeRequirements SET Conformance = 'Yes' WHERE ZedId = @z AND SectionType = 'Bronze';
EXEC dbo.SP_APP_MSME_FINAL_SUBMIT @ZedId = @z, @RefId = 'R', @CertificationType = 'Bronze';
EXEC dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT @ZedId = @z, @CertificationType = 'Bronze', @AssessorRemarks = 'replay';
SET @s = (SELECT CAST(CertificationStatus AS varchar) FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Bronze');
EXEC #CHECK 'A', 'desktop assessor final submit: agency check', '5', @s;
EXEC dbo.SP_V4_DA_FINAL_SUBMIT @UserId = 'AGENCYX', @ZedId = @z, @CertificationType = 'Bronze', @QrCodeSeqNo = 'RPL';
SET @s = (SELECT CONCAT(CertificationStatus, '/', CASE WHEN DaCertificateNo IS NULL THEN 'no number' ELSE 'number' END, '/', CertificationPhase)
          FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Bronze');
EXEC #CHECK 'A', 'agency final submit: certified at the desktop', '6/number/ACTIVE', @s;
ROLLBACK;
GO

-- A0. The same case without a flow of its own (as before 0117): it follows the level and goes on to a visit. Shows what 0117 prevents.
BEGIN TRAN;
DECLARE @z varchar(50) = 'ZEDMSME998101', @s varchar(100);
UPDATE dbo.MsmeCertifications SET CertificationStatus = 5, NcCount = 1, DaCertificateNo = NULL, CertificationPhase = NULL, AssessmentFlow = NULL,
    CertificationBodyUserId = 'AGENCYX', DesktopAssessorId = 'DAX1', DesktopAccepted = 1
WHERE ZedId = @z AND Certification = 'Bronze';
UPDATE dbo.SectionTypes SET AssessmentFlow = 'DesktopOnsite', AssessmentMode = 'Site' WHERE SectionType = 'Bronze' AND IsCertificationLevel = 1;
EXEC dbo.SP_V4_DA_FINAL_SUBMIT @UserId = 'AGENCYX', @ZedId = @z, @CertificationType = 'Bronze', @QrCodeSeqNo = 'RPL';
SET @s = (SELECT CONCAT(CertificationStatus, '/', CASE WHEN DaCertificateNo IS NULL THEN 'no number' ELSE 'number' END)
          FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Bronze');
EXEC #CHECK 'A0', 'no case flow: follows the level (visit)', '6/no number', @s;
ROLLBACK;
GO

-- ---------------------------------------------------------------------------------------------------------------------------------
-- B. A Desktop + Onsite Silver case in desktop assessment (status 3); the Admin switches Silver to Desktop only.
--    The case keeps Desktop + Onsite: no desktop NC for a "No" (5), the agency's final submit sends it to the visit (6, no number),
--    the agency allots the onsite assessor (8), and a send-back from the onsite stage stays in the visit track.
-- ---------------------------------------------------------------------------------------------------------------------------------
BEGIN TRAN;
DECLARE @z varchar(50) = 'ZEDMSME998201', @s varchar(100);
UPDATE dbo.MsmeCertifications SET CertificationStatus = 3, NcCount = 0, NcStatus = 0, Nc1Status = 0, DaCertificateNo = NULL, SaCertificateNo = NULL,
    CertificationPhase = NULL, AssessmentFlow = 'DesktopOnsite', CertificationBodyUserId = 'AGENCYX', DesktopAssessorId = 'DAX1', DesktopAccepted = 1,
    SiteAssessorId = NULL, CoAssessorId = NULL
WHERE ZedId = @z AND Certification = 'Silver';
UPDATE dbo.SectionTypes SET AssessmentFlow = 'Desktop', AssessmentMode = 'Desktop' WHERE SectionType = 'Silver' AND IsCertificationLevel = 1;
SET @s = CAST(dbo.FN_V4_LEVEL_DESKTOP('Silver') AS varchar);        EXEC #CHECK 'B', 'level Silver is now desktop only', '1', @s;
SET @s = CAST(dbo.FN_V4_CASE_DESKTOP(@z, 'Silver') AS varchar);     EXEC #CHECK 'B', 'the case keeps its visit', '0', @s;
INSERT dbo.MsmeRequirements (ZedId, SectionType, Conformance, NcCount) VALUES (@z, 'Silver', 'No', 0);
EXEC dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT @ZedId = @z, @CertificationType = 'Silver', @AssessorRemarks = 'replay';
SET @s = (SELECT CONCAT(CertificationStatus, '/', NcCount) FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Silver');
EXEC #CHECK 'B', 'no desktop NC in a combined flow (status/NcCount)', '5/0', @s;
EXEC dbo.SP_V4_DA_FINAL_SUBMIT @UserId = 'AGENCYX', @ZedId = @z, @CertificationType = 'Silver', @QrCodeSeqNo = 'RPL';
SET @s = (SELECT CONCAT(CertificationStatus, '/', CASE WHEN DaCertificateNo IS NULL THEN 'no number' ELSE 'number' END)
          FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Silver');
EXEC #CHECK 'B', 'agency final submit: waits for the onsite assessor', '6/no number', @s;
EXEC dbo.SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA @ZedId = @z, @Certification = 'Silver', @SiteAssessorId = 'SAX1', @AssessmentDate = '2026-12-10',
    @ModeOfAssessment = 'Onsite Assessment', @CoAssessorId = NULL;
SET @s = (SELECT CAST(CertificationStatus AS varchar) FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Silver');
EXEC #CHECK 'B', 'onsite assessor allotted', '8', @s;
-- Send back from the onsite quality check (15) goes back to the onsite assessor (13), not to the desktop track (3).
UPDATE dbo.MsmeCertifications SET CertificationStatus = 15 WHERE ZedId = @z AND Certification = 'Silver';
EXEC dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR @UserId = 'AGENCYX', @RoleId = '2', @ZedId = @z, @CertificationType = 'Silver', @SendBackRemarks = 'replay';
SET @s = (SELECT CAST(CertificationStatus AS varchar) FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Silver');
EXEC #CHECK 'B', 'send back from 15 stays in the visit track', '13', @s;
ROLLBACK;
GO

-- ---------------------------------------------------------------------------------------------------------------------------------
-- C. The final submit takes the level's flow at that moment; Onsite only skips the desktop step by the case's flow.
-- ---------------------------------------------------------------------------------------------------------------------------------
BEGIN TRAN;
DECLARE @z varchar(50) = 'ZEDMSME998102', @s varchar(100);
UPDATE dbo.MsmeCertifications SET CertificationStatus = 1, NcCount = 0, DaCertificateNo = NULL, CertificationPhase = NULL, AssessmentFlow = NULL,
    CertificationBodyUserId = NULL, DesktopAssessorId = NULL
WHERE ZedId = @z AND Certification = 'Bronze';
UPDATE dbo.SectionTypes SET AssessmentFlow = 'Onsite', AssessmentMode = 'Site' WHERE SectionType = 'Bronze' AND IsCertificationLevel = 1;
EXEC dbo.SP_APP_MSME_FINAL_SUBMIT @ZedId = @z, @RefId = 'R', @CertificationType = 'Bronze';
SET @s = (SELECT CONCAT(CertificationStatus, '/', AssessmentFlow) FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Bronze');
EXEC #CHECK 'C', 'final submit takes the level''s flow', '2/Onsite', @s;
-- The Admin switches Bronze back to Desktop only before the agency is in: the case still skips the desktop step.
UPDATE dbo.SectionTypes SET AssessmentFlow = 'Desktop', AssessmentMode = 'Desktop' WHERE SectionType = 'Bronze' AND IsCertificationLevel = 1;
UPDATE dbo.MsmeCertifications SET CertificationBodyUserId = 'AGENCYX', DesktopAssessorId = NULL WHERE ZedId = @z AND Certification = 'Bronze';
DECLARE @skip TABLE (Skipped bit, Reason varchar(200));
INSERT @skip EXEC dbo.SP_V4_SKIP_DESKTOP @ZedId = @z, @Certification = 'Bronze';
SET @s = (SELECT CONCAT(CertificationStatus, '/', AssessmentFlow) FROM dbo.MsmeCertifications WHERE ZedId = @z AND Certification = 'Bronze');
EXEC #CHECK 'C', 'Onsite only case skips the desktop step', '6/Onsite', @s;
SET @s = CAST(dbo.FN_V4_AGENCY_ELIGIBLE('DAX1', @z, 'Bronze') AS varchar);   -- an assessor, not an agency: never eligible
EXEC #CHECK 'C', 'non-agency never eligible', '0', @s;
ROLLBACK;
GO

DROP PROCEDURE #CHECK;
