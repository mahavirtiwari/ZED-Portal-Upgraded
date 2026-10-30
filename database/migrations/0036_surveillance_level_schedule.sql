-- Run on ZED_SURVEILLANCE only. Additive and safe to re-run.
-- One Admin (V4): Administration → Certification Levels is managed on the main portal, and a change saved there is saved
-- on the surveillance portal's copy of the levels too, through its own API (Zed.Portal/Features/CertLevels/
-- CertificationLevelsController.cs). That save writes the surveillance schedule columns that migration 0032 added to
-- ZEDCS_V2_LIVE.dbo.SectionTypes only, so on ZED_SURVEILLANCE it failed ("apply migrations 0028, 0032"). The same seven
-- columns here (the schedule itself is run from main, SP_V4_LEVEL_SURVEILLANCE_SCHEDULE); nothing reads them yet on this
-- database except the levels page.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.SectionTypes', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceCount') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceCount int NULL;
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceIntervalMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceIntervalMonths int NULL;
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceNoticeMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceNoticeMonths int NULL;
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceReminders') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceReminders int NULL;
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceReminderEveryMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceReminderEveryMonths int NULL;
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceSuspendAfterMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceSuspendAfterMonths int NULL;
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceWithdrawAfterDays') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceWithdrawAfterDays int NULL;
END
GO
