/*
  LOCAL USE ONLY. Objects that ZED_SURVEILLANCE procedures use but that exist only in another database
  (database/README.md, "missing objects"). Without them the V4 MobileApi fails locally after the data is saved.

  dbo.CheckListReport: SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST pivots the ESG answers into it; the definition is
  the one in database/schema/01_ZEDCS_V2_LIVE.sql. Run with sqlcmd -f 65001 (the column names are UTF-8).
*/
SET NOCOUNT ON;
IF DB_NAME() <> 'ZED_SURVEILLANCE'
BEGIN
    RAISERROR('Run only on a local development ZED_SURVEILLANCE database.', 16, 1);
    RETURN;
END
IF OBJECT_ID('dbo.CheckListReport', 'U') IS NULL
BEGIN
CREATE TABLE [dbo].[CheckListReport](
	[ZedId] [varchar](50) NULL,
	[Certification] [varchar](50) NULL,
	[SubmissionDate] [date] NULL,
	[1. Are you registered under the Factories Act, 1948?] [varchar](5000) NULL,
	[2. Is Consent to Establish (COE) and Consent to Operate (COO) applicable to you?] [varchar](5000) NULL,
	[If yes, have you acquired the Certificate?] [varchar](5000) NULL,
	[If No, what Environmental management measures have been taken?] [varchar](5000) NULL,
	[3. Does the unit generate solid waste? (e.g sludge, oils, waste chemicals)] [varchar](5000) NULL,
	[If yes, have you applied for Solid Waste Management Authorization?] [varchar](5000) NULL,
	[4. Does the unit operations involve handling of hazardous/ dangerous chemicals?] [varchar](5000) NULL,
	[If yes, have your applied for Hazardous Waste Management Authorization?] [varchar](5000) NULL,
	[5. Does the unit operations produce  E waste?] [varchar](5000) NULL,
	[If yes, do you have Authorised agency for E-waste management and handling?] [varchar](5000) NULL,
	[6. Does the unit operations produce  Plastic waste?] [varchar](5000) NULL,
	[If yes,  do you have any EPR authorisation agency for waste management / recycle?] [varchar](5000) NULL,
	[1. Has the unit/project caused or will cause any health hazard to employees?] [varchar](5000) NULL,
	[If yes, specify likely occupational hazards.] [varchar](5000) NULL,
	[2. Has the unit/project comply with Fire Safety rules and Regulations?] [varchar](5000) NULL,
	[If yes, specify potential source of fire hazard and mitigation measures.] [varchar](5000) NULL,
	[3. Do you comply with the State’s Minimum Wage regulation?] [varchar](5000) NULL,
	[4. Do you abide by Child Labour (Prohibition & Regulation) Act?] [varchar](5000) NULL,
	[5. Do you have safe drinking water arrangements?] [varchar](5000) NULL,
	[If No, the reasons] [varchar](5000) NULL,
	[6. Do you have First Aid kits?] [varchar](5000) NULL,
	[7. Is there a separate toilet for women workers?] [varchar](5000) NULL,
	[8. Are there any arrangements for disposal of sanitary pads?] [varchar](5000) NULL
);
END
