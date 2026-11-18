-- 2026-11-18 (the user, Expenditure: "Before uploading any invoices, assessment agency has to provide their GSTIN number, PAN
-- number, and also upload the same. This should be for one time only and cannot be updated."): the agency's (consultant
-- organisation's) tax details for its invoices, given once on its Expenditure page.
-- Run on ZEDCS_V2_LIVE (assessment agencies) and ZED_CONSULTANT (consultant organisations), after 0098. Additive and safe
-- to re-run.
--
-- Columns on the legacy dbo.Users (new fields about an existing record: the agency / organisation is its RoleId 2 row):
--   TaxGstin        the GSTIN (15 characters, format, state code and check digit checked by the portal)
--   TaxPan          the PAN (10 characters; the portal checks it is characters 3-12 of the GSTIN)
--   TaxGstFile      the GST registration certificate (PDF / JPG / PNG), relative to the portal's storage root
--                   (Uploads/ExpenditureTax/{agency}/...)
--   TaxPanFile      the PAN card, likewise
--   TaxSubmittedOn  when they were submitted (UTC); TaxSubmittedBy  who submitted them (the agency's sign-in or its sub-user)
-- Once TaxSubmittedOn is set the details are locked: the portal writes them only WHERE TaxSubmittedOn IS NULL and has no
-- edit screen or API (a correction is not part of this change). CK_Users_TaxDetails keeps a submitted row complete.
-- The legacy procedures and the old sites never read or write these columns (their inserts into dbo.Users name their
-- columns; the existing AgencyGstNumber of the agency form is left as it is and only pre-fills the page's GSTIN).
-- The portal logins already have SELECT and UPDATE on dbo.Users (zed_v4_app: db_datareader + db_datawriter).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT')
    THROW 50100, '0100 runs on ZEDCS_V2_LIVE and ZED_CONSULTANT.', 1;
GO
IF COL_LENGTH('dbo.Users', 'TaxGstin') IS NULL
    ALTER TABLE dbo.Users ADD
        TaxGstin       varchar(15)  NULL,
        TaxPan         varchar(10)  NULL,
        TaxGstFile     varchar(300) NULL,
        TaxPanFile     varchar(300) NULL,
        TaxSubmittedOn datetime2(0) NULL,
        TaxSubmittedBy varchar(100) NULL;
GO
IF COL_LENGTH('dbo.Users', 'TaxGstin') IS NOT NULL AND OBJECT_ID('dbo.CK_Users_TaxDetails', 'C') IS NULL
    EXEC (N'ALTER TABLE dbo.Users WITH CHECK ADD CONSTRAINT CK_Users_TaxDetails CHECK (TaxSubmittedOn IS NULL OR
            (LEN(TaxGstin) = 15 AND LEN(TaxPan) = 10 AND TaxGstFile IS NOT NULL AND TaxPanFile IS NOT NULL AND TaxSubmittedBy IS NOT NULL));');
GO
