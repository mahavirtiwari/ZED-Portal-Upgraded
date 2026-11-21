-- Run on ZED_CONSULTANT only. Safe to re-run (each column and the constraint are added once).
--
-- 2026-11-21 (the product owner's rule): the Consultant Organisation of handholding milestone 1.
--   * At the milestone 1 payment (web page and ZED MSME app) the unit answers "Did any Consultant Organisation assist you?"
--     Yes / No; with Yes it picks the organisation (an active one whose purchase order for the level is not used up).
--   * When the milestone 1 payment is recorded, the portal allots the case at once: Yes = to that organisation, No = by round
--     robin among the organisations the Master Admin could allot it to (active, site verification, the unit's states and NIC
--     sectors, its kind, PO not used up), through the Master Admin's own allotment (SP_ASSESSMENT_ALLOT_TO_AGENCY, its history
--     and mail). With no such organisation the case waits on Allot Consultancy as before and the ZED team is told. Milestones
--     2 and 3 keep following the organisation of the previous milestone (the payment procedures, unchanged).
-- No procedure is edited: the allotment runs in the portal after the legacy payment procedures.
--
-- New columns on the legacy tables (no new table):
--   dbo.PaymentGatewayTransactions  AssistedByCo bit NULL       the unit's answer, with the order (gateway web / app, and the
--                                   AssistedCoId varchar(50)    Rs 0 order of a 100% subsidy); the organisation's UserId
--                                                               (NULL for No, and for milestones 2 and 3 and older orders)
--   dbo.MsmePaymentInfo             AssistedByCo, AssistedCoId  the same answer for the zero payments recorded without an order
--                                                               (SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS: state subsidy rows)
--   dbo.MsmeCertifications          CoAllotType varchar(20)     how the milestone row got (or did not get) its organisation:
--                                                               'Chosen' (the unit's choice), 'RoundRobin', 'NoEligible' (waits
--                                                               for the Master Admin), 'Manual' (the Master Admin's Allot);
--                                                               NULL = before this rule, or milestones 2 and 3
--   dbo.MsmeCertifications_Moveback CoAllotType                (when it exists) kept in step: a legacy procedure copies
--                                                               MsmeCertifications there with INSERT ... SELECT *, so both
--                                                               tables keep the same columns in the same order (as 0098)
-- The round robin's order is kept in main's existing dbo.AgencyAllotmentHistory (AllotType 'HandholdingAuto', the unit's
-- choice 'HandholdingChosen'; CertificationType = the level), as OnsiteAllotment keeps 'SchemeOnsite' there: ZED_CONSULTANT
-- has no such table.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZED_CONSULTANT'
    THROW 50111, '0111 runs on ZED_CONSULTANT.', 1;
GO
IF COL_LENGTH('dbo.PaymentGatewayTransactions', 'AssistedByCo') IS NULL
    ALTER TABLE dbo.PaymentGatewayTransactions ADD AssistedByCo bit NULL;
GO
IF COL_LENGTH('dbo.PaymentGatewayTransactions', 'AssistedCoId') IS NULL
    ALTER TABLE dbo.PaymentGatewayTransactions ADD AssistedCoId varchar(50) NULL;
GO
IF COL_LENGTH('dbo.MsmePaymentInfo', 'AssistedByCo') IS NULL
    ALTER TABLE dbo.MsmePaymentInfo ADD AssistedByCo bit NULL;
GO
IF COL_LENGTH('dbo.MsmePaymentInfo', 'AssistedCoId') IS NULL
    ALTER TABLE dbo.MsmePaymentInfo ADD AssistedCoId varchar(50) NULL;
GO
IF COL_LENGTH('dbo.MsmeCertifications', 'CoAllotType') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD CoAllotType varchar(20) NULL;
GO
IF OBJECT_ID(N'dbo.MsmeCertifications_Moveback', N'U') IS NOT NULL AND COL_LENGTH('dbo.MsmeCertifications_Moveback', 'CoAllotType') IS NULL
    ALTER TABLE dbo.MsmeCertifications_Moveback ADD CoAllotType varchar(20) NULL;
GO
IF OBJECT_ID(N'dbo.CK_MsmeCertifications_CoAllotType', N'C') IS NULL
    ALTER TABLE dbo.MsmeCertifications WITH CHECK ADD CONSTRAINT CK_MsmeCertifications_CoAllotType
        CHECK (CoAllotType IS NULL OR CoAllotType IN ('Chosen', 'RoundRobin', 'NoEligible', 'Manual'));
GO
PRINT CONCAT(DB_NAME(), N': 0111 handholding milestone 1 allotment columns are in place.');
GO
