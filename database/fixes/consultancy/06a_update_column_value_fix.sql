-- database\fixes\consultancy\06a_update_column_value_fix.sql  (ZED_CONSULTANT)
-- SECURITY-FINDINGS #86 (C2, concrete form of #12): SP_CONSULTANCY_UPDATE_COLUMN_VALUE - option A, FIX IN PLACE.
-- =====================================================================================================================
-- REVIEW BEFORE RUNNING ON PRODUCTION. THE LIVE DEFINITION MAY DIFFER FROM THE LOCAL COPY THIS SCRIPT WAS BUILT AND
-- TESTED AGAINST: DIFF FIRST. Script the live procedure out (Script As > CREATE To > File: that is the undo) and compare
-- it with the "before" summary below. Run as it is (PREVIEW: the new definition only compiles), then set
-- @Mode = 'APPLY' and run again.
-- =====================================================================================================================
-- Before (local ZED_CONSULTANT): @Id varchar(50) was appended unquoted to dynamic SQL
--     UPDATE QUOTENAME(@TableName) SET QUOTENAME(@ColumnName) = '<value>' WHERE Id = <@Id as text>
-- so any table and column could be changed (Users.Password / RoleId, AssessmentFee, MsmeCertifications...) and @Id
-- allowed stacked statements. Old caller: /Consultancy/Assessment/UpdateColumnData (anonymous, block it, see
-- docs\LIVE-HARDENING.md). V4 does not call this procedure (it has its own allow-listed edit endpoints).
--
-- After:
--   * @Id bigint (MsmeRequirements.Id is bigint). A non-numeric id is a conversion error, as any bad call should be.
--   * Only the cells the milestone review page edits (Frontend/Assessment/SaDetails.cshtml, rows' TableName from
--     SP_ASSESSMENT_SA_DETAILS):
--       MsmeRequirements: BaselineRemarks, EstimatedTimeInDays, HActionPlanRemarks, Intervention, InterventionRemarks,
--                         ProgressReviewRemarks, ProgressReviewRemarks2
--       MsmeRequirementBullets: BulletPoints, and the soft delete (@ColumnName = 'Delete')
--       TrainingInfo: Remarks
--     Anything else raises "This field cannot be edited." and changes nothing.
--   * The value is passed as a parameter (no quoting in dynamic SQL); table and column names come from the allow-list.
--   * @UserId must be an active Consultant/Expert (RoleId 3), Consultant Organisation (2) or MasterAdmin (7) of this
--     database. The old action passes the signed-in user from its session, so an anonymous call (no session) is
--     refused even while the old action is still reachable.
--   * Same result as before: the MsmeRequirementBullets row with that Id.
-- What breaks: edits by other roles (none on the page), and any caller that relied on editing other tables/columns.
-- Not checked (old behaviour kept): that the row belongs to a unit allotted to @UserId and is in an editable status.
-- Idempotent (CREATE OR ALTER). Skipped when the procedure does not exist.
-- Alternative: 06b drops the procedure (once the old consultancy milestone edit is blocked or retired).
USE [ZED_CONSULTANT];
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
DECLARE @Mode varchar(10) = 'PREVIEW';   -- PREVIEW: compile only. APPLY: alter the procedure.
IF OBJECT_ID('dbo.SP_CONSULTANCY_UPDATE_COLUMN_VALUE', 'P') IS NULL
BEGIN
    PRINT 'dbo.SP_CONSULTANCY_UPDATE_COLUMN_VALUE not found in this database; skipped.';
    SET NOEXEC ON;
END
ELSE IF @Mode <> 'APPLY'
BEGIN
    PRINT 'PREVIEW: the new definition below is compiled but not created. Set @Mode = ''APPLY'' to alter it.';
    SET NOEXEC ON;
END
GO
CREATE OR ALTER PROC [dbo].[SP_CONSULTANCY_UPDATE_COLUMN_VALUE]
(
    @Id bigint = NULL,
    @TableName varchar(200) = NULL,
    @ColumnName varchar(200) = NULL,
    @ColumnValue varchar(2000) = NULL,
    @UserId varchar(50) = NULL
)
AS
BEGIN
    -- V4 security fix (SECURITY-FINDINGS #86): typed id, allow-listed cells, parameterised value, signed-in user.
    SET NOCOUNT ON;

    IF @Id IS NULL
    BEGIN
        RAISERROR('Invalid details.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM Users WHERE UserId = @UserId AND RoleId IN (2, 3, 7) AND IsActive = 1)
    BEGIN
        RAISERROR('You are not allowed to edit this field.', 16, 1);
        RETURN;
    END

    IF @TableName = 'MsmeRequirementBullets' AND @ColumnName = 'Delete'
    BEGIN
        UPDATE MsmeRequirementBullets
        SET ZedId = CONCAT(ZedId, 'DELETED'), RequirementId = CONCAT(RequirementId, 'DELETED')
        WHERE Id = @Id;
    END
    ELSE IF (@TableName = 'MsmeRequirements' AND @ColumnName IN ('BaselineRemarks', 'EstimatedTimeInDays', 'HActionPlanRemarks',
                 'Intervention', 'InterventionRemarks', 'ProgressReviewRemarks', 'ProgressReviewRemarks2'))
         OR (@TableName = 'MsmeRequirementBullets' AND @ColumnName = 'BulletPoints')
         OR (@TableName = 'TrainingInfo' AND @ColumnName = 'Remarks')
    BEGIN
        DECLARE @sql nvarchar(max) = CONCAT(N'UPDATE dbo.', QUOTENAME(@TableName), N' SET ', QUOTENAME(@ColumnName),
                                            N' = @Value WHERE Id = @RowId;');
        EXEC sys.sp_executesql @sql, N'@Value varchar(2000), @RowId bigint', @Value = @ColumnValue, @RowId = @Id;
    END
    ELSE
    BEGIN
        RAISERROR('This field cannot be edited.', 16, 1);
        RETURN;
    END

    SELECT * FROM MsmeRequirementBullets WHERE Id = @Id;
END
GO
SET NOEXEC OFF;
GO
