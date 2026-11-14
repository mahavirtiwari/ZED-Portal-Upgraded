-- Run on ZEDCS_V2_LIVE (after 0072). Safe to re-run (CREATE OR ALTER).
-- 2026-11-14 (Remote only / Onsite only, approved): a level whose flow has no desktop step goes from the MSME's final submit
-- straight to the site assessment. The legacy procedures are not changed; the portal calls dbo.SP_V4_SKIP_DESKTOP right
-- after the agency is set (web and app final submit after the automatic or the applicant's allotment, and the Master
-- Admin's Allot). It puts the unit in the state a completed and approved desktop verification leaves for a site level:
--   MsmeCertifications.CertificationStatus = 6 (waiting for the agency's SA allotment), CertificationStatusDate = now,
-- with no desktop record (DesktopAssessorId, DesktopAccepted and DesktopVerificationDate stay NULL), and writes the history
-- row 'DesktopSkipped'. Every parameter is assessed at the site (no desktop exemptions). Only when the level's flow is
-- 'Remote' or 'Onsite' (dbo.SectionTypes.AssessmentFlow) and the unit has just been submitted (status 2, no NC, an agency,
-- no desktop assessor). The SA allotment needs an agency with site verification: when the agency set has none, the agency
-- is taken off so that the Master Admin allots one that has (the Master Admin's list shows status 2 without an agency).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_SKIP_DESKTOP
    @ZedId varchar(50),
    @Certification varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @flow varchar(20) = (SELECT TOP 1 AssessmentFlow FROM dbo.SectionTypes WHERE SectionType = @Certification AND IsCertificationLevel = 1);
    IF ISNULL(@flow, '') NOT IN ('Remote', 'Onsite') OR @Certification = 'Bronze'
    BEGIN
        SELECT CAST(0 AS bit) AS Skipped, 'The level has a desktop step.' AS Reason;
        RETURN;
    END;

    DECLARE @agency varchar(50) = (
        SELECT TOP 1 CertificationBodyUserId FROM dbo.MsmeCertifications
        WHERE ZedId = @ZedId AND Certification = @Certification AND CertificationStatus = 2 AND ISNULL(NcCount, 0) = 0
          AND NULLIF(CertificationBodyUserId, '') IS NOT NULL AND NULLIF(DesktopAssessorId, '') IS NULL);
    IF @agency IS NULL
    BEGIN
        SELECT CAST(0 AS bit) AS Skipped, 'Not a just-submitted unit with an agency.' AS Reason;
        RETURN;
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE UserId = @agency AND RoleId = 2 AND ISNULL(SiteVerification, 0) = 1)
    BEGIN
        UPDATE dbo.MsmeCertifications SET CertificationBodyUserId = NULL
        WHERE ZedId = @ZedId AND Certification = @Certification AND CertificationStatus = 2 AND CertificationBodyUserId = @agency;
        INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
        VALUES (@ZedId, CONCAT('Agency ', @agency, ' has no site verification: to be allotted by the Master Admin'), GETDATE(), @Certification, 'AgencyNeeded');
        SELECT CAST(0 AS bit) AS Skipped, 'The agency has no site verification.' AS Reason;
        RETURN;
    END;

    UPDATE dbo.MsmeCertifications SET CertificationStatus = 6, CertificationStatusDate = GETDATE()
    WHERE ZedId = @ZedId AND Certification = @Certification AND CertificationStatus = 2 AND CertificationBodyUserId = @agency;
    INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
    VALUES (@ZedId, CONCAT(CASE @flow WHEN 'Remote' THEN 'Remote' ELSE 'Onsite' END, ' assessment without a desktop step, from ', FORMAT(GETDATE(), 'MMMM d, yyyy')),
            GETDATE(), @Certification, 'DesktopSkipped');
    SELECT CAST(1 AS bit) AS Skipped, NULL AS Reason;
END;
GO
PRINT '0074: SP_V4_SKIP_DESKTOP ready on ' + DB_NAME() + '.';
GO
