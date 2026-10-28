-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (each has its own dbo.Sectors). Additive and safe to re-run.
-- Admin → Masters → Sectors (Zed.Portal/Features/Staff/Masters/StaffMastersController.cs): whether a NIC sector is a
-- Manufacturing or a Services sector, in a new column of the existing table: dbo.Sectors.SectorType ('Manufacturing',
-- 'Services', or NULL = not set yet). The old sites are not affected: their procedures insert into Sectors with a column
-- list (SP_MASTER_INSERT_SECTOR) and read it by column name (SELECT * in SP_MASTER_GET_SECTORS ...). The legacy
-- procedures are not changed; V4 sets the column with its own UPDATE after inserting or renaming a sector.
-- Seed, only for rows still NULL: the NIC 2008 rule - divisions 10 to 33 (Section C) are Manufacturing, the others
-- Services; the Admin changes any of them on the page. A sector added on the old site stays NULL ("Not set").
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Sectors', 'SectorType') IS NULL
    ALTER TABLE dbo.Sectors ADD SectorType varchar(20) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Sectors_SectorType' AND parent_object_id = OBJECT_ID('dbo.Sectors'))
    ALTER TABLE dbo.Sectors ADD CONSTRAINT CK_Sectors_SectorType CHECK (SectorType IN ('Manufacturing', 'Services'));
GO
UPDATE dbo.Sectors
SET SectorType = CASE WHEN TRY_CAST(LTRIM(RTRIM(SectorCode)) AS int) BETWEEN 10 AND 33 THEN 'Manufacturing' ELSE 'Services' END
WHERE SectorType IS NULL AND NULLIF(LTRIM(RTRIM(SectorCode)), '') IS NOT NULL;
GO
