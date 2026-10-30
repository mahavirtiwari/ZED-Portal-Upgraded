-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE (each has its own questionnaire tables). Additive and safe to re-run.
-- Administration → Questionnaire → Requirements (Zed.Portal/Features/Staff/Questionnaire/QuestionnaireController.cs), V4
-- layout: a requirement has a purpose and its benefits, and its points are Yes / No checkpoints; each checkpoint has the
-- evidence the unit shows when the answer is Yes (mandatory or not, with an optional sample copy the Admin uploads) and
-- the actions needed when the answer is No or Partial. Kept in new columns of the existing tables:
--   dbo.Requirements.Purpose, .Benefits     up to 500 characters each
--   dbo.Options.ActionsNeeded               the checkpoint's actions, one per line (each up to 100 characters)
--   dbo.Evidences.OptionCode                the checkpoint (Options.OptionCode) the evidence belongs to; NULL = the whole
--                                           requirement (every evidence added before V4)
--   dbo.Evidences.SampleFile                the sample copy's file name (Uploads/EvidenceSamples/), NULL = none
-- The old sites are not affected: their procedures insert with column lists and read by column name. The legacy
-- procedures are not changed; V4 sets the columns with its own UPDATEs after SP_MASTER_INSERT_REQUIREMENT /
-- SP_MASTER_INSERT_EVIDENCES. The MSMEs' copies (MsmeRequirements, MsmeEvidences) are not changed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Requirements', 'Purpose') IS NULL
    ALTER TABLE dbo.Requirements ADD Purpose nvarchar(500) NULL;
GO
IF COL_LENGTH('dbo.Requirements', 'Benefits') IS NULL
    ALTER TABLE dbo.Requirements ADD Benefits nvarchar(500) NULL;
GO
IF COL_LENGTH('dbo.Options', 'ActionsNeeded') IS NULL
    ALTER TABLE dbo.Options ADD ActionsNeeded nvarchar(4000) NULL;
GO
IF COL_LENGTH('dbo.Evidences', 'OptionCode') IS NULL
    ALTER TABLE dbo.Evidences ADD OptionCode varchar(50) NULL;
GO
IF COL_LENGTH('dbo.Evidences', 'SampleFile') IS NULL
    ALTER TABLE dbo.Evidences ADD SampleFile varchar(200) NULL;
GO
