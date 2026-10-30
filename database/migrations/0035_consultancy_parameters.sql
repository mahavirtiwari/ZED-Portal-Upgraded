-- Run on ZEDCS_V2_LIVE only (the handholding questionnaire is copied from main's parameters). Additive and safe to re-run.
-- One Admin, Questionnaire → Parameters (Zed.Portal/Features/Staff/Masters/StaffMastersController.cs): whether a parameter
-- is used in consultancy (handholding), as Sections.SurveMandatories says whether it is assessed again in surveillance.
-- dbo.Sections.InConsultancy: NULL or 'Yes' = used (every parameter, as before), 'No' = not used.
-- A handholding milestone payment still copies every parameter of the level into ZED_CONSULTANT (main's
-- SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS, ZED_CONSULTANT's SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS[_WITH_INFO]; not
-- changed); right after it V4 removes the parameters marked 'No' from that milestone's copy
-- (Zed.Portal/Features/Payments/Consultancy/ConsultancyParameters.cs). Until a parameter is set to 'No' nothing changes.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Sections', 'InConsultancy') IS NULL
    ALTER TABLE dbo.Sections ADD InConsultancy varchar(3) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Sections_InConsultancy' AND parent_object_id = OBJECT_ID('dbo.Sections'))
    ALTER TABLE dbo.Sections ADD CONSTRAINT CK_Sections_InConsultancy CHECK (InConsultancy IN ('Yes', 'No'));
GO
