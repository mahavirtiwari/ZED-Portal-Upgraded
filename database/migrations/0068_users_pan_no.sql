-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE. Safe to re-run.
--
-- Professional verification (2026-11-13; Administration -> Settings -> Professional Verification): when an agency (a
-- Consultant Organisation) adds a certified professional as an assessor (consultant), the PAN of the professional is asked
-- for (verification off, or another portal's API) and kept on the user. New column of the legacy table:
--   dbo.Users.PanNo   varchar(10) NULL   PAN in capitals (ABCDE1234F), written after SP_INSERT_USER
-- The setting itself is a row of dbo.V4Settings (ProfessionalVerification.Mode: Off, the default, TrainingPortal or Api).
-- Existing users keep NULL.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50068, '0068 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
IF COL_LENGTH('dbo.Users', 'PanNo') IS NULL ALTER TABLE dbo.Users ADD PanNo varchar(10) NULL;
GO
