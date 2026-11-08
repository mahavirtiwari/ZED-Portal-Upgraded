-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and (2026-11-08, its staff's Documents page) ZED_SURVEILLANCE. Additive and safe to re-run.
-- Admin → Masters → Documents/Videos (Zed.Core/Content/DocumentAccess.cs): new columns of the existing dbo.MyDocuments:
--   Description      the line shown under the document's name;
--   VideoUrl         the address of a video (the document is then a link; DocumentPath stays empty);
--   AccessRoles      the account types that may open it (comma-separated keys: msme, masteradmin, agency, assessor,
--                    coordinator, ministry, superadmin, citizenfeedback, qc); NULL = the MSMEs only, as before V4;
--   AccessUpdatedBy / AccessUpdatedOn   who set them, when (UTC).
-- The old sites are not affected: SP_MASTER_INSERT_DOCUMENT inserts with a column list and the procedures read the table
-- by column name. The legacy procedures are not changed.
-- Earlier V4 builds kept these values in a separate table, dbo.V4DocumentAccess. When that table is still there, its
-- rows are copied into the new columns and the table is dropped (one transaction: all or nothing).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.MyDocuments', 'Description') IS NULL ALTER TABLE dbo.MyDocuments ADD Description nvarchar(300) NULL;
IF COL_LENGTH('dbo.MyDocuments', 'VideoUrl') IS NULL ALTER TABLE dbo.MyDocuments ADD VideoUrl nvarchar(1000) NULL;
IF COL_LENGTH('dbo.MyDocuments', 'AccessRoles') IS NULL ALTER TABLE dbo.MyDocuments ADD AccessRoles varchar(300) NULL;
IF COL_LENGTH('dbo.MyDocuments', 'AccessUpdatedBy') IS NULL ALTER TABLE dbo.MyDocuments ADD AccessUpdatedBy varchar(50) NULL;
IF COL_LENGTH('dbo.MyDocuments', 'AccessUpdatedOn') IS NULL ALTER TABLE dbo.MyDocuments ADD AccessUpdatedOn datetime2(0) NULL;
GO
IF OBJECT_ID('dbo.V4DocumentAccess', 'U') IS NOT NULL
BEGIN
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    EXEC (N'UPDATE d SET Description = a.Description, VideoUrl = a.VideoUrl, AccessRoles = a.Roles,
                 AccessUpdatedBy = a.UpdatedBy, AccessUpdatedOn = a.UpdatedOn
          FROM dbo.MyDocuments d JOIN dbo.V4DocumentAccess a ON a.DocumentId = d.Id
          WHERE d.AccessRoles IS NULL;');
    DROP TABLE dbo.V4DocumentAccess;
    COMMIT;
END
GO
