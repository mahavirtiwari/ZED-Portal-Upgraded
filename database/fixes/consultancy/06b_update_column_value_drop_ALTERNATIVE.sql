-- database\fixes\consultancy\06b_update_column_value_drop_ALTERNATIVE.sql  (ZED_CONSULTANT)
-- SECURITY-FINDINGS #86 (C2): SP_CONSULTANCY_UPDATE_COLUMN_VALUE - option B, DROP IT. Use 06a OR this, not both.
-- =====================================================================================================================
-- REVIEW BEFORE RUNNING ON PRODUCTION. THE LIVE DATABASE MAY DIFFER FROM THE LOCAL COPY THIS SCRIPT WAS TESTED
-- AGAINST: DIFF FIRST. Script the procedure out before dropping it (Script As > CREATE To > File): that is the undo.
-- =====================================================================================================================
-- When: V4 does not call this procedure (checked: no reference in backend\src), and only the old consultancy action
-- /Consultancy/Assessment/UpdateColumnData does. Drop it once that action is blocked (docs\LIVE-HARDENING.md, rule
-- C-ASSESSMENT) or the old consultancy site is retired.
-- What breaks: the "EDIT" / delete-bullet buttons of the old consultancy milestone review page (Assessment/SaDetails)
-- return an error; consultants and COs edit the milestone entries in V4 instead.
-- The script refuses to drop it while another module of this database still references it.
-- Idempotent: does nothing when the procedure is already gone.
USE [ZED_CONSULTANT];
GO
SET NOCOUNT ON;
DECLARE @Mode varchar(10) = 'PREVIEW';   -- PREVIEW: report only. APPLY: drop the procedure.
IF OBJECT_ID('dbo.SP_CONSULTANCY_UPDATE_COLUMN_VALUE', 'P') IS NULL
    PRINT 'dbo.SP_CONSULTANCY_UPDATE_COLUMN_VALUE does not exist: nothing to do.';
ELSE IF EXISTS (SELECT 1 FROM sys.sql_modules
                WHERE object_id <> OBJECT_ID('dbo.SP_CONSULTANCY_UPDATE_COLUMN_VALUE')
                  AND definition LIKE '%SP_CONSULTANCY_UPDATE_COLUMN_VALUE%')
    RAISERROR('Another module references SP_CONSULTANCY_UPDATE_COLUMN_VALUE; not dropped. Check it first.', 16, 1);
ELSE IF @Mode <> 'APPLY'
    PRINT 'PREVIEW: dbo.SP_CONSULTANCY_UPDATE_COLUMN_VALUE would be dropped. Set @Mode = ''APPLY'' to drop it.';
ELSE
BEGIN
    DROP PROCEDURE dbo.SP_CONSULTANCY_UPDATE_COLUMN_VALUE;
    PRINT 'dbo.SP_CONSULTANCY_UPDATE_COLUMN_VALUE dropped.';
END
GO
