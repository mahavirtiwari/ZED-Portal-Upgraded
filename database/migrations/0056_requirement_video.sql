-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE (the questionnaires the Admin edits, as 0034). Safe to re-run.
--
-- A video tutorial for each requirement (2026-11-07, at the Admin's request): the link the Admin adds on the
-- Questionnaire → Requirements page (Staff/Questionnaire/QuestionnaireController.Checklist.cs). A new column of the
-- legacy table, next to 0034's Purpose and Benefits:
--   dbo.Requirements.VideoUrl   an http(s) address, up to 500 characters; NULL = no video
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE')
    THROW 50056, '0056 runs on ZEDCS_V2_LIVE and ZED_SURVEILLANCE.', 1;
GO
IF COL_LENGTH('dbo.Requirements', 'VideoUrl') IS NULL
    ALTER TABLE dbo.Requirements ADD VideoUrl nvarchar(500) NULL;
GO
