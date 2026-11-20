-- Run on ZEDCS_V2_LIVE. Additive and safe to re-run.
--
-- 2026-11-20 (the user, approved design): incentive schemes the Admin defines (Admin -> Incentives -> Schemes) with a generic
-- applicant form ("Add more" items), graded per certification level (or per enterprise size), verified like the assessment
-- (agency -> assessor -> desktop checks with correction rounds -> agency QC -> MSME DFO pays by NEFT). Per the user's rule the
-- data goes into the existing tables as new columns (no V4 side table):
--
-- dbo.Incentives (the dashboard cards and the Admin's incentives; 0026, 0091):
--   SchemeCode              varchar(40)    a scheme row: its code (unique); NULL on the other rows
--   SchemeJson              nvarchar(max)  the scheme's definition (activation, grading, form, verification) as JSON
--   ActivatesAfter          varchar(300)   a built-in card's (and a scheme's copy of its) activation: level codes
--                                          comma-separated, or 'Registration', or 'Handholding'; NULL = the card's own rule
--   RecommendationRequired  bit            the Technology Upgradation card: 1 / NULL = after the consultant's
--                                          recommendation (Handholding, as today); 0 = the direct scheme below
--   DirectSchemeCode        varchar(40)    the Technology Upgradation card: the scheme applied for when 0
--
-- dbo.FinancialAssistance (the applications; a scheme row has CertificationType = SchemeCode so the Financial Assistance
-- procedures, which read Bronze / Silver / Gold, never see it, and NEFT lists it once approved, VerificationStatus 4):
--   SchemeCode        varchar(40)    the scheme (NULL: a Financial Assistance application)
--   SchemeLevel       varchar(50)    the level the claim is for (a level code, 'Registration' or 'Handholding')
--   SchemeCertNo      varchar(100)   the certificate the claim belongs to (a re-certification opens a new claim)
--   SchemeStatus      varchar(30)    Draft, Submitted, WithAgency, WithAssessor, Verifying, Correction, Qc, Approved, Paid,
--                                    Rejected, OnHold (VerificationStatus mirrors it: 1 new, 2 in progress, 3 QC, 4 approved,
--                                    5 rejected, 6 reimbursed)
--   FormAnswers       nvarchar(max)  the answers (JSON: sections -> items -> values)
--   FormChecks        nvarchar(max)  the assessor's checks per answer and document (JSON)
--   ClaimAmount       decimal(14,2)  the sum of the claim amounts
--   SharePercent      decimal(5,2)   the grade applied
--   MaxAmount         decimal(14,2)  the cap applied
--   ApprovedAmount    decimal(14,2)  the amount the agency approved (EligibleAmount keeps the computed one, as FA)
--   CorrectionRound   int            correction rounds asked so far
--   CorrectionDueOn   datetime       the date the open correction round must be answered by (then auto-rejected)
--   SubmittedOn, DecidedOn  datetime
--   HoldReason        varchar(500)   why the application is on hold (suspension / withdrawal); the Master Admin decides
--   AssessorAcceptedOn datetime      the assessor accepted the allotment
--
-- dbo.FinancialAssistancePhotos: a scheme document's Name is "{section}/{item}/{field}" (the file's place in the form).
--
-- dbo.Users (agencies and assessors, main):
--   SchemeVerification varchar(2000) the schemes the user verifies: "CODE:D" (desktop), "CODE:O" (onsite), comma-separated
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50105, '0105 runs on ZEDCS_V2_LIVE.', 1;
GO
IF COL_LENGTH('dbo.Incentives', 'SchemeCode') IS NULL ALTER TABLE dbo.Incentives ADD SchemeCode varchar(40) NULL;
IF COL_LENGTH('dbo.Incentives', 'SchemeJson') IS NULL ALTER TABLE dbo.Incentives ADD SchemeJson nvarchar(max) NULL;
IF COL_LENGTH('dbo.Incentives', 'ActivatesAfter') IS NULL ALTER TABLE dbo.Incentives ADD ActivatesAfter varchar(300) NULL;
IF COL_LENGTH('dbo.Incentives', 'RecommendationRequired') IS NULL ALTER TABLE dbo.Incentives ADD RecommendationRequired bit NULL;
IF COL_LENGTH('dbo.Incentives', 'DirectSchemeCode') IS NULL ALTER TABLE dbo.Incentives ADD DirectSchemeCode varchar(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Incentives_SchemeCode' AND object_id = OBJECT_ID(N'dbo.Incentives'))
    CREATE UNIQUE INDEX UX_Incentives_SchemeCode ON dbo.Incentives (SchemeCode) WHERE SchemeCode IS NOT NULL;
GO
IF COL_LENGTH('dbo.FinancialAssistance', 'SchemeCode') IS NULL ALTER TABLE dbo.FinancialAssistance ADD SchemeCode varchar(40) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'SchemeLevel') IS NULL ALTER TABLE dbo.FinancialAssistance ADD SchemeLevel varchar(50) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'SchemeCertNo') IS NULL ALTER TABLE dbo.FinancialAssistance ADD SchemeCertNo varchar(100) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'SchemeStatus') IS NULL ALTER TABLE dbo.FinancialAssistance ADD SchemeStatus varchar(30) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'FormAnswers') IS NULL ALTER TABLE dbo.FinancialAssistance ADD FormAnswers nvarchar(max) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'FormChecks') IS NULL ALTER TABLE dbo.FinancialAssistance ADD FormChecks nvarchar(max) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'ClaimAmount') IS NULL ALTER TABLE dbo.FinancialAssistance ADD ClaimAmount decimal(14,2) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'SharePercent') IS NULL ALTER TABLE dbo.FinancialAssistance ADD SharePercent decimal(5,2) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'MaxAmount') IS NULL ALTER TABLE dbo.FinancialAssistance ADD MaxAmount decimal(14,2) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'ApprovedAmount') IS NULL ALTER TABLE dbo.FinancialAssistance ADD ApprovedAmount decimal(14,2) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'CorrectionRound') IS NULL ALTER TABLE dbo.FinancialAssistance ADD CorrectionRound int NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'CorrectionDueOn') IS NULL ALTER TABLE dbo.FinancialAssistance ADD CorrectionDueOn datetime NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'SubmittedOn') IS NULL ALTER TABLE dbo.FinancialAssistance ADD SubmittedOn datetime NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'DecidedOn') IS NULL ALTER TABLE dbo.FinancialAssistance ADD DecidedOn datetime NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'HoldReason') IS NULL ALTER TABLE dbo.FinancialAssistance ADD HoldReason varchar(500) NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'AssessorAcceptedOn') IS NULL ALTER TABLE dbo.FinancialAssistance ADD AssessorAcceptedOn datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_FinancialAssistance_SchemeCode' AND object_id = OBJECT_ID(N'dbo.FinancialAssistance'))
    CREATE INDEX IX_FinancialAssistance_SchemeCode ON dbo.FinancialAssistance (SchemeCode, ZedId) INCLUDE (SchemeStatus, SchemeLevel, SchemeCertNo) WHERE SchemeCode IS NOT NULL;
GO
IF COL_LENGTH('dbo.Users', 'SchemeVerification') IS NULL ALTER TABLE dbo.Users ADD SchemeVerification varchar(2000) NULL;
GO
