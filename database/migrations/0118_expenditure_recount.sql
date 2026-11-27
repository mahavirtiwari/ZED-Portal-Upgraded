-- database\migrations\0118_expenditure_recount.sql  (ZEDCS_V2_LIVE only; after 0098). Data only, safe to re-run.
--
-- 2026-11-27 (the owner: "reset un-invoiced ones"): until today's fix (ExpenditureSweep.MainCertified, commit a8b3daa6) the
-- expenditure sweep counted a case at status 6 as 'Completed' in every flow, but a Desktop + Onsite / Remote case is at 6 after its
-- desktop quality check and an Onsite / Remote only case right after its allotment, before the visit. Those counts froze the rate
-- and the agency at that moment and used its purchase order's cases too early.
--
-- This un-counts the cases counted 'Completed' that are not certified (16, or 6 with its desktop certificate or a certified phase)
-- and whose month is NOT in a submitted or approved monthly invoice of that agency: ExpCountedOn, ExpCaseKind, ExpAgencyId and
-- ExpRate back to NULL, so the sweep counts them again, correctly, when they are certified or rejected (with the agency and rate
-- of that day). The ones already in an invoice are left as they are: Expenditure → "Counted before the visit" lists them for the
-- Master Admin to settle (api/staff/expenditure/review).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50118, '0118 runs on ZEDCS_V2_LIVE.', 1;
IF COL_LENGTH('dbo.MsmeCertifications', 'ExpCountedOn') IS NULL OR OBJECT_ID(N'dbo.ExpenditureInvoices', N'U') IS NULL
    THROW 50118, 'Run 0098 first.', 1;
GO
DECLARE @reset int;
UPDATE C SET ExpCountedOn = NULL, ExpCaseKind = NULL, ExpAgencyId = NULL, ExpRate = NULL
FROM dbo.MsmeCertifications C
WHERE C.ExpCaseKind = 'Completed'
  AND NOT (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (NULLIF(LTRIM(RTRIM(C.DaCertificateNo)), '') IS NOT NULL
           OR ISNULL(C.CertificationPhase, 'PENDING') NOT IN ('PENDING', 'REJECTED'))))
  AND NOT EXISTS (SELECT 1 FROM dbo.ExpenditureInvoices I
                  WHERE I.PartyId = C.ExpAgencyId AND I.InvoiceMonth = DATEFROMPARTS(YEAR(C.ExpCountedOn), MONTH(C.ExpCountedOn), 1)
                    AND I.Status IN ('Submitted', 'Approved'));
SET @reset = @@ROWCOUNT;
DECLARE @kept int = (SELECT COUNT(*) FROM dbo.MsmeCertifications C
    WHERE C.ExpCaseKind = 'Completed'
      AND NOT (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (NULLIF(LTRIM(RTRIM(C.DaCertificateNo)), '') IS NOT NULL
               OR ISNULL(C.CertificationPhase, 'PENDING') NOT IN ('PENDING', 'REJECTED')))));
PRINT CONCAT(N'0118: ', @reset, N' case(s) un-counted (they count again when certified or rejected); ', @kept,
    N' counted before the visit and already invoiced, left for the Master Admin (Expenditure, Counted before the visit).');

DECLARE @note nvarchar(200) = CONCAT(N'Run ', CONVERT(nvarchar(19), SYSDATETIME(), 120), N': ', @reset, N' un-counted, ', @kept, N' invoiced kept');
IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0 AND major_id = OBJECT_ID(N'dbo.MsmeCertifications') AND name = N'V4_0118_ExpenditureRecount')
    EXEC sys.sp_updateextendedproperty @name = N'V4_0118_ExpenditureRecount', @value = @note, @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'MsmeCertifications';
ELSE
    EXEC sys.sp_addextendedproperty @name = N'V4_0118_ExpenditureRecount', @value = @note, @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'MsmeCertifications';
GO
