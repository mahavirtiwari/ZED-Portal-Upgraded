-- Run on ZED_SURVEILLANCE. Additive and safe to re-run.
-- 2026-11-14 (stored procedure audit): two legacy objects that the surveillance procedures and V4 code reach but that
-- ZED_SURVEILLANCE never had (they exist in ZEDCS_V2_LIVE, same schema):
--   dbo.ZedDailyAttendance + dbo.SP_APP_SA_INSERT_DAILY_ATTENDANCE
--       the assessor app's punch-in / punch-out (Zed.Main.MobileApi SAController.SubmitAttendance, [PortalSystems(Main,
--       Surveillance)]): on the surveillance deployment every punch failed. Needed for the onsite surveillance visits
--       (migration 0075). The procedure is the main one without its FinancialAssistance lookup (no such table here).
--   dbo.CheckListReport
--       written by SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST after it saves EsgCheckList (no transaction): the insert failed
--       with Msg 208, so the surveillance app showed an error on every valid ESG checklist submit although the answers were
--       saved. The legacy table, as in ZEDCS_V2_LIVE, so the procedure is not changed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.ZedDailyAttendance', N'U') IS NULL
    CREATE TABLE dbo.ZedDailyAttendance(
        Id int IDENTITY(1,1) NOT NULL,
        ZedId varchar(50) NULL,
        Certification varchar(50) NULL,
        ConsultantId varchar(50) NULL,
        [Timestamp] varchar(50) NULL,
        Latitude varchar(100) NULL,
        Longitude varchar(100) NULL,
        MileStoneNo int NULL,
        CreatedDate datetime NULL,
        RefId varchar(50) NULL,
        PhotoId varchar(200) NULL,
        PhotoPath varchar(2000) NULL,
        AttendanceType varchar(50) NULL,
        Comments varchar(max) NULL,
        FinancialAssistanceId int NULL,
        AttendCertId int NULL
    );
GO
CREATE OR ALTER PROCEDURE dbo.SP_APP_SA_INSERT_DAILY_ATTENDANCE
    @RefId varchar(50) = NULL,
    @ZedId varchar(200) = NULL,
    @AssessorId varchar(200) = NULL,
    @CertificationType varchar(200) = NULL,
    @PhotoId varchar(2000) = NULL,
    @TimeStamp varchar(2000) = NULL,
    @Latitude varchar(200) = NULL,
    @Longitude varchar(200) = NULL,
    @PhotoPath varchar(2000) = NULL,
    @AttendanceType varchar(50) = NULL,
    @Comments varchar(max) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NcCount int = NULL;
    SELECT @NcCount = NcCount FROM dbo.MsmeCertifications
    WHERE ZedId = @ZedId AND Certification = @CertificationType AND SiteAssessorId IS NOT NULL AND SaCertificateNo IS NULL;

    INSERT INTO dbo.ZedDailyAttendance (RefId, ZedId, Certification, ConsultantId, PhotoId, PhotoPath, [Timestamp], Latitude, Longitude,
        AttendanceType, Comments, CreatedDate, MileStoneNo, FinancialAssistanceId)
    VALUES (@RefId, @ZedId, @CertificationType, @AssessorId, @PhotoId, @PhotoPath, @TimeStamp, @Latitude, @Longitude,
        @AttendanceType, @Comments, GETDATE(), @NcCount, NULL);

    SELECT 1 AS Status, CONCAT(@AttendanceType, ' ATTENDANCE SUBMITTED SUCCESSFULLY') AS Message;
END;
GO
IF OBJECT_ID(N'dbo.CheckListReport', N'U') IS NULL
CREATE TABLE dbo.CheckListReport(
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
    ) ON [PRIMARY];
GO
PRINT '0076: attendance and ESG checklist report ready on ' + DB_NAME() + '.';
GO
