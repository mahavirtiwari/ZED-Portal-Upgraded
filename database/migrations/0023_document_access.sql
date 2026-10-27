-- New in V4 (not part of the legacy schema). Run on ZEDCS_V2_LIVE and ZED_CONSULTANT (the systems whose Admin manages
-- My Documents). Additive and safe to re-run: one new table.
-- Admin → Masters → Documents/Videos (Zed.Core/Content/DocumentAccess.cs): for a row of dbo.MyDocuments, its
-- description, the address of a video (the document is then a link; MyDocuments.DocumentPath stays empty) and the
-- account types that may open it (comma-separated keys: msme, masteradmin, agency, assessor, coordinator, ministry,
-- superadmin, citizenfeedback, qc). A document without a row goes to the MSMEs only, as before V4.
-- The V4 logins need SELECT, INSERT, UPDATE and DELETE on it (zed_v4_app has them; the mobile hosts read it).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4DocumentAccess', 'U') IS NULL
CREATE TABLE dbo.V4DocumentAccess
(
    DocumentId   bigint          NOT NULL CONSTRAINT PK_V4DocumentAccess PRIMARY KEY,
    Description  nvarchar(300)   NULL,
    VideoUrl     nvarchar(1000)  NULL,
    Roles        varchar(300)    NOT NULL,
    UpdatedBy    varchar(50)     NULL,
    UpdatedOn    datetime2(0)    NOT NULL CONSTRAINT DF_V4DocumentAccess_UpdatedOn DEFAULT SYSUTCDATETIME()
);
GO
