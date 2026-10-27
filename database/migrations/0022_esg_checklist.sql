-- New in V4 (not part of the legacy schema). Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE (the systems whose apps fill in
-- the ESG checklist). Additive and safe to re-run: one new table.
-- Admin → Questionnaire → ESG Checklist (Zed.Core/Forms/EsgChecklist.cs): the Admin's version of the ESG checklist the
-- apps get from GetEsgChecklist (the old App_Data/EnvironmentalChecklist.json): the two sections (ESG, Social / OHS),
-- their questions, options and the follow-up question shown on Yes or No, as one JSON document. No row: the standard
-- checklist. The answers keep their question texts (SP_APP_*_INSERT_ESG_CHECKLIST), so a change does not alter answers
-- already given; a question keeps its code (Id) when edited, and a new one gets the next free code.
-- The V4 logins need SELECT, INSERT, UPDATE and DELETE on it (zed_v4_app has them; the mobile hosts read it).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4EsgChecklist', 'U') IS NULL
CREATE TABLE dbo.V4EsgChecklist
(
    ChecklistKey  varchar(50)    NOT NULL CONSTRAINT PK_V4EsgChecklist PRIMARY KEY,
    Revision      int            NOT NULL CONSTRAINT DF_V4EsgChecklist_Revision DEFAULT 1,
    ChecklistJson nvarchar(max)  NOT NULL,
    UpdatedBy     varchar(50)    NULL,
    UpdatedOn     datetime2(0)   NOT NULL CONSTRAINT DF_V4EsgChecklist_UpdatedOn DEFAULT SYSUTCDATETIME()
);
GO
