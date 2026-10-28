-- Run on ZEDCS_V2_LIVE. Additive and safe to re-run.
-- Admin → Masters → Subsidy Regions (Zed.Portal/Features/Staff/Masters/SpecialRegionsController.cs): the regions whose
-- MSMEs get the additional subsidy of the ZED scheme, as new columns of the existing tables, one per region:
--   dbo.Districts  SubsidyAspirational, SubsidyLwe, SubsidyHimalayan, SubsidyIsland, SubsidyNer   (a district entry)
--   dbo.States     the same five columns                                                         (a whole state)
--   each: NULL = not in that region's list, 0 = listed but switched off, 1 = listed and switched on;
--   SubsidyUpdatedBy / SubsidyUpdatedOn on both tables: who changed the row's regions last, when (UTC).
-- The payment procedures keep reading Districts.IsAspirationalDt: V4 sets it to 1 for the districts that an enabled
-- entry covers (their own column, or their state's) and to 0 for the others whenever the Admin changes the regions.
-- The old sites are not affected: nothing inserts into Districts or States without a column list, and the legacy
-- procedures are not changed.
-- First run: earlier V4 builds kept the regions in a separate table, dbo.V4SpecialRegions; when it is there its entries
-- are copied into the columns and the table is dropped. Otherwise today's regions are seeded: the aspirational
-- districts as flagged in Districts (switched on); Himalayan: Jammu and Kashmir, Ladakh, Himachal Pradesh, Uttarakhand;
-- islands: Andaman and Nicobar Islands, Lakshadweep; NER: the eight North Eastern states (these switched off until the
-- Admin enables them). LWE: none - the Ministry of Home Affairs informed the states on 8 April 2026 that no district is
-- classified as LWE-affected any more; the Admin adds districts if needed. States are matched by their LGD code.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
DECLARE @FirstRun bit = CASE WHEN COL_LENGTH('dbo.Districts', 'SubsidyAspirational') IS NULL THEN 1 ELSE 0 END;
EXEC sys.sp_set_session_context @key = N'zed_0024_first_run', @value = @FirstRun;

IF COL_LENGTH('dbo.Districts', 'SubsidyAspirational') IS NULL ALTER TABLE dbo.Districts ADD SubsidyAspirational bit NULL;
IF COL_LENGTH('dbo.Districts', 'SubsidyLwe') IS NULL ALTER TABLE dbo.Districts ADD SubsidyLwe bit NULL;
IF COL_LENGTH('dbo.Districts', 'SubsidyHimalayan') IS NULL ALTER TABLE dbo.Districts ADD SubsidyHimalayan bit NULL;
IF COL_LENGTH('dbo.Districts', 'SubsidyIsland') IS NULL ALTER TABLE dbo.Districts ADD SubsidyIsland bit NULL;
IF COL_LENGTH('dbo.Districts', 'SubsidyNer') IS NULL ALTER TABLE dbo.Districts ADD SubsidyNer bit NULL;
IF COL_LENGTH('dbo.Districts', 'SubsidyUpdatedBy') IS NULL ALTER TABLE dbo.Districts ADD SubsidyUpdatedBy varchar(50) NULL;
IF COL_LENGTH('dbo.Districts', 'SubsidyUpdatedOn') IS NULL ALTER TABLE dbo.Districts ADD SubsidyUpdatedOn datetime2(0) NULL;

IF COL_LENGTH('dbo.States', 'SubsidyAspirational') IS NULL ALTER TABLE dbo.States ADD SubsidyAspirational bit NULL;
IF COL_LENGTH('dbo.States', 'SubsidyLwe') IS NULL ALTER TABLE dbo.States ADD SubsidyLwe bit NULL;
IF COL_LENGTH('dbo.States', 'SubsidyHimalayan') IS NULL ALTER TABLE dbo.States ADD SubsidyHimalayan bit NULL;
IF COL_LENGTH('dbo.States', 'SubsidyIsland') IS NULL ALTER TABLE dbo.States ADD SubsidyIsland bit NULL;
IF COL_LENGTH('dbo.States', 'SubsidyNer') IS NULL ALTER TABLE dbo.States ADD SubsidyNer bit NULL;
IF COL_LENGTH('dbo.States', 'SubsidyUpdatedBy') IS NULL ALTER TABLE dbo.States ADD SubsidyUpdatedBy varchar(50) NULL;
IF COL_LENGTH('dbo.States', 'SubsidyUpdatedOn') IS NULL ALTER TABLE dbo.States ADD SubsidyUpdatedOn datetime2(0) NULL;
GO
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.V4SpecialRegions', 'U') IS NOT NULL
BEGIN
    -- Move the entries of the earlier separate table into the columns, then drop it (all or nothing).
    BEGIN TRANSACTION;
    EXEC (N'
    UPDATE d SET
        SubsidyAspirational = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''ASPIRATIONAL'' AND r.DistrictCode <> '''' AND r.StateCode = LTRIM(RTRIM(d.StateCode)) AND r.DistrictCode = LTRIM(RTRIM(d.DistrictCode))), d.SubsidyAspirational),
        SubsidyLwe          = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''LWE''          AND r.DistrictCode <> '''' AND r.StateCode = LTRIM(RTRIM(d.StateCode)) AND r.DistrictCode = LTRIM(RTRIM(d.DistrictCode))), d.SubsidyLwe),
        SubsidyHimalayan    = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''HIMALAYAN''    AND r.DistrictCode <> '''' AND r.StateCode = LTRIM(RTRIM(d.StateCode)) AND r.DistrictCode = LTRIM(RTRIM(d.DistrictCode))), d.SubsidyHimalayan),
        SubsidyIsland       = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''ISLAND''       AND r.DistrictCode <> '''' AND r.StateCode = LTRIM(RTRIM(d.StateCode)) AND r.DistrictCode = LTRIM(RTRIM(d.DistrictCode))), d.SubsidyIsland),
        SubsidyNer          = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''NER''          AND r.DistrictCode <> '''' AND r.StateCode = LTRIM(RTRIM(d.StateCode)) AND r.DistrictCode = LTRIM(RTRIM(d.DistrictCode))), d.SubsidyNer),
        SubsidyUpdatedBy    = COALESCE((SELECT TOP 1 r.UpdatedBy FROM dbo.V4SpecialRegions r WHERE r.DistrictCode <> '''' AND r.StateCode = LTRIM(RTRIM(d.StateCode)) AND r.DistrictCode = LTRIM(RTRIM(d.DistrictCode)) ORDER BY r.UpdatedOn DESC), d.SubsidyUpdatedBy),
        SubsidyUpdatedOn    = COALESCE((SELECT MAX(r.UpdatedOn) FROM dbo.V4SpecialRegions r WHERE r.DistrictCode <> '''' AND r.StateCode = LTRIM(RTRIM(d.StateCode)) AND r.DistrictCode = LTRIM(RTRIM(d.DistrictCode))), d.SubsidyUpdatedOn)
    FROM dbo.Districts d
    WHERE EXISTS (SELECT 1 FROM dbo.V4SpecialRegions r WHERE r.DistrictCode <> '''' AND r.StateCode = LTRIM(RTRIM(d.StateCode)) AND r.DistrictCode = LTRIM(RTRIM(d.DistrictCode)));

    UPDATE s SET
        SubsidyAspirational = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''ASPIRATIONAL'' AND r.DistrictCode = '''' AND r.StateCode = LTRIM(RTRIM(s.StateCode))), s.SubsidyAspirational),
        SubsidyLwe          = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''LWE''          AND r.DistrictCode = '''' AND r.StateCode = LTRIM(RTRIM(s.StateCode))), s.SubsidyLwe),
        SubsidyHimalayan    = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''HIMALAYAN''    AND r.DistrictCode = '''' AND r.StateCode = LTRIM(RTRIM(s.StateCode))), s.SubsidyHimalayan),
        SubsidyIsland       = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''ISLAND''       AND r.DistrictCode = '''' AND r.StateCode = LTRIM(RTRIM(s.StateCode))), s.SubsidyIsland),
        SubsidyNer          = COALESCE((SELECT TOP 1 r.Enabled FROM dbo.V4SpecialRegions r WHERE r.Category = ''NER''          AND r.DistrictCode = '''' AND r.StateCode = LTRIM(RTRIM(s.StateCode))), s.SubsidyNer),
        SubsidyUpdatedBy    = COALESCE((SELECT TOP 1 r.UpdatedBy FROM dbo.V4SpecialRegions r WHERE r.DistrictCode = '''' AND r.StateCode = LTRIM(RTRIM(s.StateCode)) ORDER BY r.UpdatedOn DESC), s.SubsidyUpdatedBy),
        SubsidyUpdatedOn    = COALESCE((SELECT MAX(r.UpdatedOn) FROM dbo.V4SpecialRegions r WHERE r.DistrictCode = '''' AND r.StateCode = LTRIM(RTRIM(s.StateCode))), s.SubsidyUpdatedOn)
    FROM dbo.States s
    WHERE EXISTS (SELECT 1 FROM dbo.V4SpecialRegions r WHERE r.DistrictCode = '''' AND r.StateCode = LTRIM(RTRIM(s.StateCode)));');
    DROP TABLE dbo.V4SpecialRegions;
    COMMIT;
END
ELSE IF CAST(SESSION_CONTEXT(N'zed_0024_first_run') AS bit) = 1
BEGIN
    -- A new installation: today's regions (see the header).
    BEGIN TRANSACTION;
    UPDATE dbo.Districts SET SubsidyAspirational = 1, SubsidyUpdatedBy = 'migration-0024', SubsidyUpdatedOn = SYSUTCDATETIME()
    WHERE IsAspirationalDt = 1 AND StateCode IS NOT NULL AND DistrictCode IS NOT NULL;
    UPDATE dbo.States SET SubsidyHimalayan = 0, SubsidyUpdatedBy = 'migration-0024', SubsidyUpdatedOn = SYSUTCDATETIME()
    WHERE LTRIM(RTRIM(StateCode)) IN ('1', '37', '2', '5');
    UPDATE dbo.States SET SubsidyIsland = 0, SubsidyUpdatedBy = 'migration-0024', SubsidyUpdatedOn = SYSUTCDATETIME()
    WHERE LTRIM(RTRIM(StateCode)) IN ('35', '31');
    UPDATE dbo.States SET SubsidyNer = 0, SubsidyUpdatedBy = 'migration-0024', SubsidyUpdatedOn = SYSUTCDATETIME()
    WHERE LTRIM(RTRIM(StateCode)) IN ('12', '18', '14', '17', '15', '13', '11', '16');
    COMMIT;
END
GO
