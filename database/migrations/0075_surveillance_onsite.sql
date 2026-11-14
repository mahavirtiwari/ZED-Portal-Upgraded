-- Run on ZED_SURVEILLANCE (after 0072). Additive and safe to re-run.
-- 2026-11-14 (Onsite surveillance, approved): a level whose surveillance's Mode of assessment is Onsite
-- (dbo.SectionTypes.SurveillanceMode) is surveilled by an onsite visit, as an onsite assessment on the parameters the
-- surveillance copied (Sections.SurveMandatories), instead of the meeting-link (remote) surveillance. Kept in:
--   dbo.MsmeCertifications.AssessmentVisit   'Onsite' for a unit allotted for an onsite visit; NULL = the meeting-link flow
--   dbo.SP_V4_SURVEILLANCE_ACCEPT_ONSITE      the agency's allotment of an onsite visit (the legacy
--                                             SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA, which the meeting-link flow keeps using,
--                                             is not changed)
-- The procedure sets the assessors, the date, ModeOfAssessment 'Onsite Assessment' (what the lists and the assessor app
-- read), no meeting link, DesktopAccepted = 1 and status 9 with every section to the lead (the assessor app opens a unit
-- at 9; status 8 would mix with the paid units waiting for an agency), and clears old meetings WITHOUT pre-inserting any:
-- the lead records the opening and closing meetings in the assessor app, which ends at status 13; the lead then reviews
-- and final-submits on the web as for a main onsite assessment.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.MsmeCertifications', 'AssessmentVisit') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD AssessmentVisit varchar(10) NULL;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_SURVEILLANCE_ACCEPT_ONSITE
    @ZedId varchar(50),
    @Certification varchar(50),
    @SiteAssessorId varchar(100),
    @CoAssessorId varchar(100) = NULL,
    @AssessmentDate varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.MsmeSections SET AssessorId = @SiteAssessorId WHERE ZedId = @ZedId AND SectionType = @Certification;

    UPDATE dbo.MsmeCertifications
    SET SiteAssessorId = @SiteAssessorId, CoAssessorId = @CoAssessorId, AssessmentDate = @AssessmentDate,
        ModeOfAssessment = 'Onsite Assessment', MeetingLink = NULL, AssessmentVisit = 'Onsite',
        CertificationStatus = 9, DesktopAccepted = 1
    WHERE ZedId = @ZedId AND Certification = @Certification;

    DELETE FROM dbo.Meetings WHERE ZedId = @ZedId AND CertificationType = @Certification;
    DELETE FROM dbo.MeetingParticipants WHERE ZedId = @ZedId AND CertificationType = @Certification;

    INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
    VALUES (@ZedId, CONCAT('Scheduled on  ', @AssessmentDate), GETDATE(), @Certification, 'ScheduledOn');
    INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType)
    VALUES (@ZedId, CONCAT('Onsite surveillance for ', @Certification, ' allotted to ', @SiteAssessorId,
            CASE WHEN NULLIF(@CoAssessorId, '') IS NULL THEN '' ELSE CONCAT(' and ', @CoAssessorId) END), GETDATE(), @Certification, NULL);
END;
GO
PRINT '0075: onsite surveillance ready on ' + DB_NAME() + '.';
GO
