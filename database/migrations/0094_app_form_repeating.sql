-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (each has its own dbo.V4AppFormFields, 0017). Additive and
-- safe to re-run.
-- 2026-11-16 (the user, approved): Admin → App Forms → a field of the Admin's own can be "Repeating entries" ("Add more",
-- as the standard Products), with columns of every own type and photo. The columns are rows of the same table, keyed
-- {field}/{column} (as the standard columns' changes already are). A new column of the existing table:
--   dbo.V4AppFormFields.MaxItems int   repeating entries: most entries; a photo column: most photos; NULL = the default
-- The answers stay in dbo.V4AppFormValues.Value (a JSON list of entries; a photo is its photo id, the file uploaded as the
-- apps' Basic Information photos are).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.V4AppFormFields', 'MaxItems') IS NULL
    ALTER TABLE dbo.V4AppFormFields ADD MaxItems int NULL;
GO
