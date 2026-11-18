-- 2026-11-18 (approved design "Expenditure monitoring"): what the portal pays the assessment agencies (per case) and the
-- consultant organisations (per handholding milestone), their purchase orders, and their monthly invoices.
-- Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE). Additive and safe to re-run.
--
-- Columns on the legacy tables (new fields about existing records):
--   ZEDCS_V2_LIVE dbo.MsmeCertifications (one row per unit and level: one assessment case), set once the case counts:
--     ExpCountedOn  when it counted (the CertificationStatusDate of the certification or of the rejection after assessment)
--     ExpCaseKind   Completed / Rejected;  ExpRate  the rate frozen on the case (the rate set in force on the date it counted)
--     ExpAgencyId   the agency paid (CertificationBodyUserId then)
--   ZED_SURVEILLANCE dbo.MsmeCertifications (one row per surveillance visit): the same four columns, ExpCaseKind 'Surveillance'.
--   ZED_CONSULTANT dbo.MsmeCertifications keeps ONE row per unit and level whose NcCount is the current milestone (the row
--     moves on to the next milestone), so each milestone needs its own columns: ExpM{n}CountedOn, ExpM{n}Rate, ExpM{n}OrgId
--     for n = 1..3 (milestones may become fewer, never more; a fourth would need one more migration). The same columns are
--     added to dbo.MsmeCertifications_Moveback when it exists: a legacy procedure copies the row there with
--     INSERT ... SELECT *, which needs both tables to keep the same columns in the same order.
--
-- New tables (genuinely new entities; plain names):
--   dbo.ExpenditureRates (ZEDCS_V2_LIVE): the rate sets of Admin → Fees → Expenditure rates, each with its date of effect
--     (future dates allowed), one row per payee type (Agency / Consultant), date of effect and level (the levels are the
--     Admin's, so they cannot be columns; the milestone rates are Milestone1Rate..Milestone3Rate, as many as the level has).
--     A case is priced with the set in force on the date it counted and keeps it; the history of each set (who changed it,
--     when) stays: an edit marks the rows it replaces SupersededOn and adds new ones. The sets and their history cannot live
--     in columns of the level table, hence the table. A set is read-only once an approved invoice includes a case priced
--     with it (checked by the portal).
--   dbo.PurchaseOrders / dbo.PurchaseOrderChanges (ZEDCS_V2_LIVE: agencies; ZED_CONSULTANT: consultant organisations): the
--     POs per agency (organisation) and level, and their history (added, edited, reopened with extra cases or a new PO).
--   dbo.ExpenditureInvoices (ZEDCS_V2_LIVE, ZED_CONSULTANT): one invoice per agency (organisation) and month, the portal's
--     figures for that month when it was submitted, the master admin's review, and ErpExport (Pending once approved; the
--     ERP API comes later).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50098, '0098 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO

-- ---------------------------------------------------------------- the frozen rate on the case
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE') AND COL_LENGTH('dbo.MsmeCertifications', 'ExpCountedOn') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD
        ExpCountedOn datetime       NULL,
        ExpCaseKind  varchar(20)    NULL,
        ExpRate      decimal(12, 2) NULL,
        ExpAgencyId  varchar(50)    NULL;
GO
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE')
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MsmeCertifications_Expenditure' AND object_id = OBJECT_ID('dbo.MsmeCertifications'))
    EXEC (N'CREATE INDEX IX_MsmeCertifications_Expenditure ON dbo.MsmeCertifications (ExpAgencyId, ExpCountedOn)
            INCLUDE (ZedId, Certification, ExpCaseKind, ExpRate);');
GO
IF DB_NAME() = N'ZED_CONSULTANT' AND COL_LENGTH('dbo.MsmeCertifications', 'ExpM1CountedOn') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD
        ExpM1CountedOn datetime NULL, ExpM1Rate decimal(12, 2) NULL, ExpM1OrgId varchar(50) NULL,
        ExpM2CountedOn datetime NULL, ExpM2Rate decimal(12, 2) NULL, ExpM2OrgId varchar(50) NULL,
        ExpM3CountedOn datetime NULL, ExpM3Rate decimal(12, 2) NULL, ExpM3OrgId varchar(50) NULL;
GO
IF DB_NAME() = N'ZED_CONSULTANT' AND OBJECT_ID(N'dbo.MsmeCertifications_Moveback', N'U') IS NOT NULL
   AND COL_LENGTH('dbo.MsmeCertifications_Moveback', 'ExpM1CountedOn') IS NULL
    ALTER TABLE dbo.MsmeCertifications_Moveback ADD
        ExpM1CountedOn datetime NULL, ExpM1Rate decimal(12, 2) NULL, ExpM1OrgId varchar(50) NULL,
        ExpM2CountedOn datetime NULL, ExpM2Rate decimal(12, 2) NULL, ExpM2OrgId varchar(50) NULL,
        ExpM3CountedOn datetime NULL, ExpM3Rate decimal(12, 2) NULL, ExpM3OrgId varchar(50) NULL;
GO

-- ---------------------------------------------------------------- rate sets (main)
IF DB_NAME() = N'ZEDCS_V2_LIVE' AND OBJECT_ID(N'dbo.ExpenditureRates', N'U') IS NULL
    CREATE TABLE dbo.ExpenditureRates
    (
        Id               int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ExpenditureRates PRIMARY KEY,
        Kind             varchar(20)    NOT NULL,                 -- Agency / Consultant (the payee type)
        EffectiveFrom    date           NOT NULL,                 -- the set's date of effect
        Level            varchar(50)    NOT NULL,                 -- SectionTypes.SectionType (Bronze, Silver, Gold, ZEDX, ...)
        RateCompleted    decimal(12, 2) NULL,                     -- Agency: per completed case, before GST
        RateRejected     decimal(12, 2) NULL,                     -- Agency: per case rejected after the last assessment step
        RateSurveillance decimal(12, 2) NULL,                     -- Agency: per surveillance visit
        Milestone1Rate   decimal(12, 2) NULL,                     -- Consultant: per accepted milestone
        Milestone2Rate   decimal(12, 2) NULL,
        Milestone3Rate   decimal(12, 2) NULL,
        GstPercent       decimal(5, 2)  NOT NULL,                 -- added on invoices
        SavedBy          varchar(100)   NULL,
        SavedByName      nvarchar(150)  NULL,
        SavedOn          datetime2(0)   NOT NULL CONSTRAINT DF_ExpenditureRates_SavedOn DEFAULT (SYSUTCDATETIME()),
        SupersededOn     datetime2(0)   NULL,                     -- replaced by a later edit of the same set (history)
        CONSTRAINT CK_ExpenditureRates_Kind CHECK (Kind IN ('Agency', 'Consultant'))
    );
GO
IF DB_NAME() = N'ZEDCS_V2_LIVE'
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ExpenditureRates_Current' AND object_id = OBJECT_ID('dbo.ExpenditureRates'))
    EXEC (N'CREATE UNIQUE INDEX UX_ExpenditureRates_Current ON dbo.ExpenditureRates (Kind, EffectiveFrom, Level) WHERE SupersededOn IS NULL;');
GO

-- ---------------------------------------------------------------- purchase orders (main: agencies; Consultancy: organisations)
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT') AND OBJECT_ID(N'dbo.PurchaseOrders', N'U') IS NULL
    CREATE TABLE dbo.PurchaseOrders
    (
        Id        int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PurchaseOrders PRIMARY KEY,
        PartyId   varchar(50)   NOT NULL,                         -- the agency's / organisation's Users.UserId
        Level     varchar(50)   NOT NULL,
        PoNumber  nvarchar(100) NOT NULL,
        PoDate    date          NOT NULL,
        Cases     int           NOT NULL,                         -- cases in the PO, amendments included
        CreatedBy varchar(100)  NULL,
        CreatedOn datetime2(0)  NOT NULL CONSTRAINT DF_PurchaseOrders_CreatedOn DEFAULT (SYSUTCDATETIME()),
        UpdatedBy varchar(100)  NULL,
        UpdatedOn datetime2(0)  NULL,
        CONSTRAINT CK_PurchaseOrders_Cases CHECK (Cases >= 0)
    );
GO
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT')
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseOrders_Party' AND object_id = OBJECT_ID('dbo.PurchaseOrders'))
    EXEC (N'CREATE INDEX IX_PurchaseOrders_Party ON dbo.PurchaseOrders (PartyId, Level, PoDate);');
GO
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT') AND OBJECT_ID(N'dbo.PurchaseOrderChanges', N'U') IS NULL
    CREATE TABLE dbo.PurchaseOrderChanges
    (
        Id              int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PurchaseOrderChanges PRIMARY KEY,
        PurchaseOrderId int            NOT NULL,
        PartyId         varchar(50)    NOT NULL,
        Level           varchar(50)    NOT NULL,
        ChangeType      varchar(20)    NOT NULL,                  -- Added / Edited / Amended (extra cases) / NewPo (reopen)
        Reason          nvarchar(1000) NULL,
        CasesBefore     int            NULL,
        CasesAfter      int            NULL,
        Details         nvarchar(500)  NULL,                      -- e.g. the PO number and date as they were
        ChangedBy       varchar(100)   NULL,                      -- an operation admin's own ID
        ChangedByName   nvarchar(150)  NULL,
        ChangedOn       datetime2(0)   NOT NULL CONSTRAINT DF_PurchaseOrderChanges_ChangedOn DEFAULT (SYSUTCDATETIME())
    );
GO
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT')
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseOrderChanges_Party' AND object_id = OBJECT_ID('dbo.PurchaseOrderChanges'))
    EXEC (N'CREATE INDEX IX_PurchaseOrderChanges_Party ON dbo.PurchaseOrderChanges (PartyId, Level, ChangedOn);');
GO

-- ---------------------------------------------------------------- monthly invoices (main: agencies; Consultancy: organisations)
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT') AND OBJECT_ID(N'dbo.ExpenditureInvoices', N'U') IS NULL
    CREATE TABLE dbo.ExpenditureInvoices
    (
        Id                 int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ExpenditureInvoices PRIMARY KEY,
        PartyId            varchar(50)    NOT NULL,
        InvoiceMonth       date           NOT NULL,               -- the month's first day
        InvoiceNo          nvarchar(60)   NOT NULL,
        InvoiceDate        date           NOT NULL,
        InvoiceAmount      decimal(14, 2) NOT NULL,               -- as on the invoice, GST included
        FilePath           nvarchar(400)  NOT NULL,               -- under Portal:StorageRoot, chosen by the server
        PortalCompleted    int            NOT NULL CONSTRAINT DF_ExpenditureInvoices_PC DEFAULT (0),
        PortalRejected     int            NOT NULL CONSTRAINT DF_ExpenditureInvoices_PR DEFAULT (0),
        PortalSurveillance int            NOT NULL CONSTRAINT DF_ExpenditureInvoices_PS DEFAULT (0),
        PortalMilestones   int            NOT NULL CONSTRAINT DF_ExpenditureInvoices_PM DEFAULT (0),
        PortalAmount       decimal(14, 2) NOT NULL,               -- the month's cases at their frozen rates, before GST
        GstPercent         decimal(5, 2)  NOT NULL,
        PortalTotal        decimal(14, 2) NOT NULL,               -- PortalAmount + GST
        Status             varchar(20)    NOT NULL,               -- Submitted / Approved / Returned
        Remarks            nvarchar(2000) NULL,                   -- the master admin's (required to return)
        SubmittedBy        varchar(100)   NULL,
        SubmittedOn        datetime2(0)   NOT NULL,
        ReviewedBy         varchar(100)   NULL,
        ReviewedByName     nvarchar(150)  NULL,
        ReviewedOn         datetime2(0)   NULL,
        ErpExport          varchar(20)    NULL,                   -- Pending once approved; Sent / Failed when the ERP API comes
        ErpExportedOn      datetime2(0)   NULL,
        ErpReference       nvarchar(100)  NULL,
        CONSTRAINT CK_ExpenditureInvoices_Status CHECK (Status IN ('Submitted', 'Approved', 'Returned'))
    );
GO
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT')
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ExpenditureInvoices_Month' AND object_id = OBJECT_ID('dbo.ExpenditureInvoices'))
    EXEC (N'CREATE UNIQUE INDEX UX_ExpenditureInvoices_Month ON dbo.ExpenditureInvoices (PartyId, InvoiceMonth);');
GO

-- ---------------------------------------------------------------- the marker of the run (every database)
IF OBJECT_ID(N'dbo.MsmeCertifications', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
                   AND major_id = OBJECT_ID(N'dbo.MsmeCertifications') AND name = N'V4_0098_Expenditure')
    EXEC sys.sp_addextendedproperty @name = N'V4_0098_Expenditure', @value = N'2026-11-18: expenditure monitoring (rates, POs, invoices)',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'MsmeCertifications';
GO
