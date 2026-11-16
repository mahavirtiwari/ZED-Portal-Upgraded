-- 2026-11-16 (approved): the ZED team's quality observations on an assessment (Master Admin and its operation admins),
-- the assessment agency's replies, close / reopen, and their full time history for analysis and ranking.
-- Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE). Additive and safe to re-run: columns on
-- the legacy dbo.AssessorComments (no new table). Rows of this feature:
--   AssessmentType 'QualityObs'  one observation; AssessorRemarks = its text, CertificationStatusDate = when raised,
--                                QoStatus = Open / Responded / Closed (the current state)
--   AssessmentType 'QualityEvt'  one step of its history (QoParentId = the observation's Id): QoStatus = Raised / Responded /
--                                Closed / Reopened, AssessorRemarks = the reply or note, CertificationStatusDate = when
-- NcCount stays NULL on these rows, so the legacy procedures (which read AssessorComments by NcCount = n, and delete a
-- round's rows by NcCount) never see or remove them; the round is kept in QoRound.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.AssessorComments', 'QoStatus') IS NULL
    ALTER TABLE dbo.AssessorComments ADD
        QoStatus      varchar(12)    NULL,   -- observation: Open / Responded / Closed; history step: Raised / Responded / Closed / Reopened
        QoParentId    int            NULL,   -- history step: the observation's Id
        QoRound       int            NULL,   -- NC round when raised (0 = first assessment)
        QoStage       varchar(30)    NULL,   -- Desktop / Site / NC / Certified / Milestone n, when raised
        QoRefType     varchar(30)    NULL,   -- Overall / Requirement / Product / Photo / Meeting / Attendance
        QoRefId       varchar(100)   NULL,   -- the requirement / product / photo row id
        QoRefLabel    nvarchar(300)  NULL,   -- what it is about, as shown ("3.2 Process control")
        QoCategory    varchar(60)    NULL,
        QoSeverity    varchar(10)    NULL,   -- Minor / Major / Critical
        QoAbout       varchar(20)    NULL,   -- Desktop / Lead / Co / Agency
        QoAboutUserId varchar(50)    NULL,   -- the assessor (or agency) it is about
        QoAgencyId    varchar(50)    NULL,   -- the assessment agency (MsmeCertifications.CertificationBodyUserId) when raised
        QoBy          varchar(50)    NULL,   -- who raised it / took the step (the sub-user's own ID for an operation admin)
        QoByName      nvarchar(150)  NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AssessorComments_Quality' AND object_id = OBJECT_ID('dbo.AssessorComments'))
    CREATE INDEX IX_AssessorComments_Quality ON dbo.AssessorComments (AssessmentType, QoAgencyId, QoStatus) INCLUDE (ZedId, Certification, QoParentId);
GO
