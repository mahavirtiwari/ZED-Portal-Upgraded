-- Cleaned copy of the SSMS schema export of ZED_CENTER_AUDIT_V2 (schema only), referenced by ZED procedures.
-- Source: ZED PENDING ITEMS/ZED ITEMS/zed training context.sql (exported 2026-10-21)
-- Changes: UTF-16 LE -> UTF-8 (BOM); quoted values in comments -> <redacted>; hard-coded master
--   passwords -> #REMOVED-HARDCODED-PASSWORD#; Twilio literals -> REDACTED; CREATE USER ... WITHOUT LOGIN.
-- Nothing else modified. Applied by database/setup.ps1.
USE [ZED_CENTER_AUDIT_V2]
GO
/****** Object:  UserDefinedTableType [dbo].[DynamicQuestion]    Script Date: 10/21/2026 11:44:33 AM ******/
CREATE TYPE [dbo].[DynamicQuestion] AS TABLE(
	[QuestionCode] [varchar](50) NULL,
	[QuestionText] [varchar](1000) NULL,
	[AnswerType] [varchar](50) NULL,
	[AnswerCode] [varchar](500) NULL,
	[AnswerText] [varchar](6000) NULL,
	[AnswerOther] [varchar](2000) NULL
)
GO
/****** Object:  UserDefinedFunction [dbo].[SplitString]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE FUNCTION [dbo].[SplitString] 
(	 
	@String NVARCHAR(4000),
    @Delimiter NCHAR(1)
)
RETURNS TABLE 
AS
RETURN 
(
	WITH Split(stpos,endpos)
    AS(
        SELECT 0 AS stpos, CHARINDEX(@Delimiter,@String) AS endpos
        UNION ALL
        SELECT endpos+1, CHARINDEX(@Delimiter,@String,endpos+1)
            FROM Split
            WHERE endpos > 0
    )
    SELECT 'Id' = ROW_NUMBER() OVER (ORDER BY (SELECT 1)),
        'Data' = SUBSTRING(@String,stpos,COALESCE(NULLIF(endpos,0),LEN(@String)+1)-stpos)
    FROM Split
)
GO
/****** Object:  Table [dbo].[AgencySMEs]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[AgencySMEs](
	[Agency] [varchar](100) NULL,
	[SmeId] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[AgencyTrainers]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[AgencyTrainers](
	[Agency] [varchar](100) NULL,
	[TrainerId] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Attendance]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Attendance](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchAttendanceId] [bigint] NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [varchar](50) NULL,
	[IsPresent] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[BatchAttendance]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[BatchAttendance](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[CreatedDate] [date] NULL,
	[CreatedTime] [time](7) NULL,
	[InTimeOrOutTime] [varchar](50) NULL,
	[RefId] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Batches]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Batches](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](100) NULL,
	[BatchNo] [varchar](50) NULL,
	[StartDate] [datetime] NULL,
	[EndDate] [datetime] NULL,
	[QpCode] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL,
	[VenueName] [varchar](100) NULL,
	[Status] [varchar](2) NULL,
	[Address] [varchar](2000) NULL,
	[City] [varchar](100) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](100) NULL,
	[Zip] [varchar](10) NULL,
	[Email] [varchar](100) NULL,
	[MobileNo] [varchar](15) NULL,
	[PhoneNo] [varchar](15) NULL,
	[CenterManager] [varchar](100) NULL,
	[Constituency] [varchar](100) NULL,
	[Landmark] [varchar](200) NULL,
	[ApprovedDate] [datetime] NULL,
	[UpdatedDate] [datetime] NULL,
	[UpdatedBy] [varchar](50) NULL,
	[Coordinator] [varchar](100) NULL,
	[VenueLat] [varchar](50) NULL,
	[VenueLong] [varchar](50) NULL,
	[ProgramType] [varchar](50) NULL,
	[AcceptedDate] [datetime] NULL,
	[ForwardToZedDate] [datetime] NULL,
	[NotAcceptedDate] [datetime] NULL,
	[NotAcceptedComments] [nvarchar](2000) NULL,
	[RejectedDate] [datetime] NULL,
	[RejectedComments] [nvarchar](2000) NULL,
	[SubmittedDate] [datetime] NULL,
	[SubmittedBy] [varchar](100) NULL,
	[PostponeDate] [datetime] NULL,
	[PostponeComments] [nvarchar](2000) NULL,
	[LeadTrainer] [varchar](50) NULL,
	[CoTrainers] [varchar](100) NULL,
	[SMEs] [varchar](100) NULL,
	[ProgrammeSchedule] [varchar](1000) NULL,
	[FinalApprovalDate] [datetime] NULL,
	[ExamStartTime] [varchar](50) NULL,
	[ExamEndTime] [varchar](50) NULL,
	[OrganisingPartner] [varchar](200) NULL,
	[Phase] [smallint] NULL,
	[NoOfCandidates] [smallint] NULL,
	[WebLink] [varchar](5000) NULL,
	[IsRegistrationsClosed] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[CandidateAttendance]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[CandidateAttendance](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [varchar](50) NULL,
	[Year] [int] NULL,
	[Month] [int] NULL,
	[Day1] [bit] NULL,
	[Day2] [bit] NULL,
	[Day3] [bit] NULL,
	[Day4] [bit] NULL,
	[Day5] [bit] NULL,
	[Day6] [bit] NULL,
	[Day7] [bit] NULL,
	[Day8] [bit] NULL,
	[Day9] [bit] NULL,
	[Day10] [bit] NULL,
	[Day11] [bit] NULL,
	[Day12] [bit] NULL,
	[Day13] [bit] NULL,
	[Day14] [bit] NULL,
	[Day15] [bit] NULL,
	[Day16] [bit] NULL,
	[Day17] [bit] NULL,
	[Day18] [bit] NULL,
	[Day19] [bit] NULL,
	[Day20] [bit] NULL,
	[Day21] [bit] NULL,
	[Day22] [bit] NULL,
	[Day23] [bit] NULL,
	[Day24] [bit] NULL,
	[Day25] [bit] NULL,
	[Day26] [bit] NULL,
	[Day27] [bit] NULL,
	[Day28] [bit] NULL,
	[Day29] [bit] NULL,
	[Day30] [bit] NULL,
	[Day31] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[CandidateAttendanceOut]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[CandidateAttendanceOut](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [varchar](50) NULL,
	[Year] [int] NULL,
	[Month] [int] NULL,
	[Day1] [bit] NULL,
	[Day2] [bit] NULL,
	[Day3] [bit] NULL,
	[Day4] [bit] NULL,
	[Day5] [bit] NULL,
	[Day6] [bit] NULL,
	[Day7] [bit] NULL,
	[Day8] [bit] NULL,
	[Day9] [bit] NULL,
	[Day10] [bit] NULL,
	[Day11] [bit] NULL,
	[Day12] [bit] NULL,
	[Day13] [bit] NULL,
	[Day14] [bit] NULL,
	[Day15] [bit] NULL,
	[Day16] [bit] NULL,
	[Day17] [bit] NULL,
	[Day18] [bit] NULL,
	[Day19] [bit] NULL,
	[Day20] [bit] NULL,
	[Day21] [bit] NULL,
	[Day22] [bit] NULL,
	[Day23] [bit] NULL,
	[Day24] [bit] NULL,
	[Day25] [bit] NULL,
	[Day26] [bit] NULL,
	[Day27] [bit] NULL,
	[Day28] [bit] NULL,
	[Day29] [bit] NULL,
	[Day30] [bit] NULL,
	[Day31] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Candidates]    Script Date: 10/21/2026 11:44:33 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Candidates](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [varchar](50) NULL,
	[FirstName] [varchar](100) NULL,
	[LastName] [varchar](100) NULL,
	[UAMEM1EM2SSINo] [varchar](50) NULL,
	[MobileNo] [varchar](50) NULL,
	[EmailId] [varchar](150) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](100) NULL,
	[Address] [varchar](2000) NULL,
	[PinCode] [varchar](50) NULL,
	[OrganizationName] [varchar](100) NULL,
	[Sector] [varchar](50) NULL,
	[AdhaarNo] [varchar](50) NULL,
	[IsPhotoUploaded] [bit] NULL,
	[Rating1] [int] NULL,
	[Rating2] [int] NULL,
	[Rating3] [int] NULL,
	[Rating4] [int] NULL,
	[Rating5] [int] NULL,
	[Rating6] [int] NULL,
	[Suggestions] [varchar](max) NULL,
	[ThreeComments] [varchar](max) NULL,
	[ZEDTAC] [varchar](50) NULL,
	[TrainingType] [varchar](50) NULL,
	[ResultStatus] [varchar](50) NULL,
	[W] [decimal](18, 2) NULL,
	[M] [decimal](18, 2) NULL,
	[P] [decimal](18, 2) NULL,
	[TotalMarksW] [int] NULL,
	[TotalMarks] [decimal](18, 2) NULL,
	[QciMarks] [decimal](18, 2) NULL,
	[NoOfAttempts] [int] NULL,
	[RegistrationId] [varchar](50) NULL,
	[TestMarks] [decimal](18, 2) NULL,
	[AttendanceMarks] [decimal](18, 2) NULL,
	[ParticipationMarks] [decimal](18, 2) NULL,
	[pScoreSubmitted] [bit] NULL,
	[mScoreSubmitted] [bit] NULL,
	[SocialCategory] [varchar](100) NULL,
	[SpecialCategory] [varchar](100) NULL,
	[TypeOfMSME] [varchar](100) NULL,
	[FeedbackRefId] [varchar](50) NULL,
	[Designation] [varchar](50) NULL,
	[mRecommendation] [bit] NULL,
	[pRecommendation] [bit] NULL,
	[TacRefId] [varchar](50) NULL,
	[TacStartTime] [varchar](50) NULL,
	[TacEndTime] [varchar](50) NULL,
	[VideoPath] [varchar](500) NULL,
	[PreCourseAttemptsCount] [int] NULL,
	[IsMovedToObservant] [bit] NULL,
	[CertificateIssuedOn] [datetime] NULL,
	[RegdTraingThroughLinkOn] [datetime] NULL,
	[IsActive] [bit] NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[CenterInfo]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[CenterInfo](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NOT NULL,
	[CenterName] [varchar](100) NULL,
	[AuditorId] [varchar](50) NULL,
	[AuditorName] [varchar](100) NULL,
	[CreatedDate] [datetime] NULL,
	[UpdatedDate] [datetime] NULL,
	[UpdatedBy] [varchar](50) NULL,
	[Status] [char](1) NULL,
	[ComputerDetail] [bit] NULL,
	[PrinterDetail] [bit] NULL,
	[BiometAttend] [bit] NULL,
	[OfficeArea] [bit] NULL,
	[MisExecutives] [bit] NULL,
	[WaterFacility] [bit] NULL,
	[ToiletFaclity] [bit] NULL,
	[FirstAidKit] [bit] NULL,
	[BrandingBoard] [bit] NULL,
	[Internet] [bit] NULL,
	[FireSafity] [bit] NULL,
	[PowerBackup] [varchar](200) NULL,
	[Remarks] [varchar](max) NULL,
	[Address] [varchar](200) NULL,
	[City] [varchar](50) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](50) NULL,
	[Zip] [varchar](10) NULL,
	[Email] [varchar](50) NULL,
	[MobileNo] [varchar](15) NULL,
	[PhoneNo] [varchar](15) NULL,
	[CenterManager] [varchar](50) NULL,
	[CenterType] [varchar](50) NULL,
	[Rating] [int] NULL,
	[CarpetArea] [int] NULL,
	[IdType] [varchar](200) NULL,
	[IdNumber] [varchar](200) NULL,
	[IdPhoto] [nvarchar](max) NULL,
	[Lattitude] [varchar](200) NULL,
	[Longitude] [varchar](200) NULL,
	[AuditorRating] [int] NULL,
	[ProjectName] [varchar](200) NULL,
	[BusinessType] [varchar](200) NULL,
	[AuditStartTime] [varchar](50) NULL,
	[AuditEndTime] [varchar](50) NULL,
	[CenterOwnership] [varchar](50) NULL,
	[CctvInstalled] [bit] NULL,
	[NoOfToilets] [int] NULL,
	[CenterProximity] [varchar](50) NULL,
	[OJTCompanyName] [varchar](200) NULL,
	[AuditorMobileNo] [varchar](50) NULL,
	[TrainingCenterFloor] [int] NULL,
	[TrainingProviderName] [varchar](200) NULL,
	[MajorLandmark] [varchar](200) NULL,
	[FranchisePartner] [varchar](200) NULL,
	[MobilityOfCenter] [varchar](50) NULL,
	[SelfFunded] [bit] NULL,
	[NSDC] [bit] NULL,
	[STAR] [bit] NULL,
	[MoRD] [bit] NULL,
	[StateGovtFundedSchemes] [bit] NULL,
	[CentralGovtSchemes] [bit] NULL,
	[NumberOfFloors] [int] NULL,
	[CenterRemarks] [varchar](2000) NULL,
	[CenterLocated] [varchar](50) NULL,
	[DeletedDate] [datetime] NULL,
	[DeletedBy] [varchar](50) NULL,
	[ApprovedOrRejectedDate] [datetime] NULL,
	[SelfFunded2] [bit] NULL,
	[NSDC2] [bit] NULL,
	[PMKVY2] [bit] NULL,
	[MoRD2] [bit] NULL,
	[StateGovtFundedSchemes2] [bit] NULL,
	[CentralGovtSchemes2] [bit] NULL,
	[TrainingProgramsCurrentlyRunning] [bit] NULL,
	[Constituency] [varchar](100) NULL,
	[RefId] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[CenterJobRoles]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[CenterJobRoles](
	[CenterId] [varchar](50) NULL,
	[QPID] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[CenterMonitoring]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[CenterMonitoring](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[NosId] [varchar](50) NULL,
	[PcId] [varchar](50) NULL,
	[TrainerId] [varchar](50) NULL,
	[Lattitude] [varchar](50) NULL,
	[Longitude] [varchar](50) NULL,
	[MonitorPhoto] [nvarchar](max) NULL,
	[CreatedDate] [datetime] NULL,
	[Comments] [varchar](8000) NULL,
	[RefId] [varchar](50) NULL,
	[SmeId] [varchar](50) NULL,
	[ObserverId] [varchar](50) NULL,
	[ObservantId] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ClassRoomInfra]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ClassRoomInfra](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NOT NULL,
	[ComputerDetail] [bit] NULL,
	[Speakers] [bit] NULL,
	[Projector] [bit] NULL,
	[WhiteBoard] [bit] NULL,
	[LocationPointer] [varchar](100) NULL,
	[TraineeFurniture] [bit] NULL,
	[TrainersPodium] [bit] NULL,
	[FirstAidKit] [bit] NULL,
	[AreaInSqft] [int] NULL,
	[Capacity] [int] NULL,
	[Visibility] [bit] NULL,
	[Ventilation] [bit] NULL,
	[ClassRoomId] [varchar](50) NOT NULL,
	[NoOfLights] [int] NULL,
	[NoOfFans] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[CONSTITUENCIES]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[CONSTITUENCIES](
	[State] [nvarchar](255) NULL,
	[Constituency] [nvarchar](255) NULL,
	[TP name] [nvarchar](255) NULL,
	[Job role] [nvarchar](255) NULL,
	[projected numbers till march] [nvarchar](255) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Coupons]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Coupons](
	[UserId] [varchar](100) NULL,
	[Coupons] [int] NULL,
	[CreatedDate] [datetime] NULL,
	[Comment] [varchar](200) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[DISTRICTS]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[DISTRICTS](
	[districtID] [int] NOT NULL,
	[districtname] [varchar](200) NULL,
	[stateid] [int] NOT NULL,
	[isactive] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Duplicates]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Duplicates](
	[BatchNo] [varchar](50) NULL,
	[ParticipantsIds] [varchar](1000) NULL,
	[createddate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[EMails]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[EMails](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[email] [varchar](50) NOT NULL,
	[name] [varchar](50) NULL,
	[isActive] [char](1) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Employers]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Employers](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[EmployerName] [varchar](200) NULL,
	[EmployerWebsite] [varchar](200) NULL,
	[EmployerState] [varchar](100) NULL,
	[EmployerDistrict] [varchar](100) NULL,
	[EmployerPincode] [varchar](50) NULL,
	[EmployerCity] [varchar](100) NULL,
	[EmployerAddress] [varchar](1000) NULL,
	[EmployerEmail] [varchar](200) NULL,
	[EmployerContactNo] [varchar](50) NULL,
	[HrName] [varchar](200) NULL,
	[HrEmail] [varchar](200) NULL,
	[HrMobile] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL,
	[UpdatedDate] [datetime] NULL,
	[CreatedBy] [varchar](50) NULL,
	[UpdatedBy] [varchar](50) NULL,
	[PhotoPath] [nvarchar](max) NULL,
	[CapturedTime] [varchar](50) NULL,
	[PhotoName] [varchar](100) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[importnewbatch1307]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[importnewbatch1307](
	[S#No] [float] NULL,
	[Name] [nvarchar](255) NULL,
	[Email] [nvarchar](255) NULL,
	[Mobile No# ] [float] NULL,
	[F5] [nvarchar](255) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[JobRoles]    Script Date: 10/21/2026 11:44:34 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[JobRoles](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[QpCode] [varchar](50) NULL,
	[QpName] [varchar](100) NULL,
	[IsActive] [bit] NULL,
	[CreatedDate] [datetime] NULL,
	[ProgramCode] [varchar](50) NULL,
	[SNo] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[KaushalMela]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[KaushalMela](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NULL,
	[ChiefGuestName] [varchar](100) NULL,
	[ChiefGuestDesignation] [varchar](100) NULL,
	[IsSelfConducted] [bit] NULL,
	[PartnerDetails] [varchar](200) NULL,
	[VenueAddress] [varchar](200) NULL,
	[VenueCity] [varchar](50) NULL,
	[VenueDistrict] [varchar](50) NULL,
	[VenueState] [varchar](50) NULL,
	[VenuePinCode] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL,
	[Status] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[LabInfra]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[LabInfra](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[LabId] [varchar](50) NOT NULL,
	[toolsAccessories] [bit] NULL,
	[labArea] [bit] NULL,
	[protAcessories] [bit] NULL,
	[consumables] [bit] NULL,
	[firstAidKit] [bit] NULL,
	[roofing] [bit] NULL,
	[flooring] [varchar](100) NULL,
	[boards] [varchar](200) NULL,
	[CenterId] [varchar](50) NOT NULL,
	[NoOfLights] [int] NULL,
	[NoOfFans] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[LgDistricts]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[LgDistricts](
	[State Code] [float] NULL,
	[State Name] [nvarchar](255) NULL,
	[District Code] [float] NULL,
	[District Name] [nvarchar](255) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[MonitoringPhotos]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[MonitoringPhotos](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[MonitoringId] [bigint] NULL,
	[AttendanceId] [bigint] NULL,
	[MpScoreId] [bigint] NULL,
	[PhotoPath] [nvarchar](max) NULL,
	[CapturedTime] [varchar](50) NULL,
	[Name] [varchar](100) NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[MScores]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[MScores](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [varchar](50) NULL,
	[SubHeading] [varchar](200) NULL,
	[Question] [varchar](200) NULL,
	[Rating] [int] NULL,
	[CreatedDate] [datetime] NULL,
	[ObservantId] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[NosDetails]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[NosDetails](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[QpCode] [varchar](50) NULL,
	[NosCode] [varchar](50) NULL,
	[NosName] [varchar](150) NULL,
	[IsActive] [bit] NULL,
	[CreatedDate] [datetime] NULL,
	[SNo] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ObservantInformation]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ObservantInformation](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](100) NULL,
	[ObservantId] [int] NOT NULL,
	[ObservantName] [varchar](200) NULL,
	[FirstName] [varchar](200) NULL,
	[LastName] [varchar](200) NULL,
	[EmailId] [varchar](200) NULL,
	[MobileNo] [varchar](50) NULL,
	[AadhaarNo] [varchar](50) NULL,
	[ZedTacId] [varchar](50) NULL,
	[W] [varchar](50) NULL,
	[M] [varchar](50) NULL,
	[P] [varchar](50) NULL,
	[RegistrationId] [varchar](50) NULL,
	[TrainingType] [varchar](50) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL,
	[IsActive] [bit] NULL,
	[QpCode] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[ObservantBatchNo] [varchar](50) NULL,
	[ObservantWScore] [varchar](50) NULL,
	[ScheduledDate] [date] NULL,
	[ScheduledTime] [varchar](50) NULL,
	[Topic] [varchar](500) NULL,
	[mScoreSubmitted] [bit] NULL,
	[Observer] [varchar](500) NULL,
	[ObserverEmail] [varchar](500) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Observers]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Observers](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](100) NOT NULL,
	[ObserverId] [int] NOT NULL,
	[ObserverName] [varchar](200) NULL,
	[AdhaarNo] [varchar](50) NULL,
	[EMailId] [varchar](100) NULL,
	[ContactNo] [varchar](50) NULL,
	[RefId] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[OrganisingPartners]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[OrganisingPartners](
	[Agency] [varchar](50) NULL,
	[OrganisingPartner] [varchar](200) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[OTP]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[OTP](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CandidateId] [varchar](50) NULL,
	[MobileNo] [varchar](50) NULL,
	[OTP] [varchar](50) NULL,
	[Response] [varchar](500) NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ParticipatingEmployers]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ParticipatingEmployers](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NULL,
	[PlacementMelaId] [bigint] NULL,
	[KaushalMelaId] [bigint] NULL,
	[EmployerName] [varchar](200) NULL,
	[EmployerRepresentative] [varchar](200) NULL,
	[EmpRepDesignation] [varchar](200) NULL,
	[EmpRepMobile] [varchar](50) NULL,
	[EmpRepEmail] [varchar](200) NULL,
	[MelaType] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Pass]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Pass](
	[SNo] [float] NULL,
	[ZEDID] [nvarchar](255) NULL,
	[Name] [nvarchar](255) NULL,
	[TrainingType] [nvarchar](255) NULL,
	[W] [nvarchar](255) NULL,
	[M] [nvarchar](255) NULL,
	[P] [nvarchar](255) NULL,
	[STATUS] [nvarchar](255) NULL,
	[ZEDTAC] [nvarchar](255) NULL,
	[EMAILID] [nvarchar](255) NULL,
	[MOBILENO] [float] NULL,
	[Mobile] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[PcDetails]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[PcDetails](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[QpCode] [varchar](50) NULL,
	[NosCode] [varchar](50) NULL,
	[PcCode] [varchar](50) NULL,
	[PcName] [varchar](250) NULL,
	[IsActive] [bit] NULL,
	[CreatedDate] [datetime] NULL,
	[SNo] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Phase1Candidates]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Phase1Candidates](
	[QpCode] [varchar](50) NULL,
	[QpName] [varchar](100) NULL,
	[Id] [bigint] NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [varchar](50) NULL,
	[FirstName] [varchar](100) NULL,
	[LastName] [varchar](100) NULL,
	[UAMEM1EM2SSINo] [varchar](50) NULL,
	[MobileNo] [varchar](50) NULL,
	[EmailId] [varchar](150) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](100) NULL,
	[Address] [varchar](2000) NULL,
	[PinCode] [varchar](50) NULL,
	[OrganizationName] [varchar](100) NULL,
	[Sector] [varchar](50) NULL,
	[AdhaarNo] [varchar](50) NULL,
	[IsPhotoUploaded] [bit] NULL,
	[Rating1] [int] NULL,
	[Rating2] [int] NULL,
	[Rating3] [int] NULL,
	[Rating4] [int] NULL,
	[Rating5] [int] NULL,
	[Rating6] [int] NULL,
	[Suggestions] [varchar](max) NULL,
	[ThreeComments] [varchar](max) NULL,
	[ZEDTAC] [varchar](50) NULL,
	[TrainingType] [varchar](50) NULL,
	[ResultStatus] [varchar](50) NULL,
	[W] [decimal](18, 2) NULL,
	[M] [decimal](18, 2) NULL,
	[P] [decimal](18, 2) NULL,
	[TotalMarksW] [decimal](18, 2) NULL,
	[QciMarks] [decimal](18, 2) NULL,
	[NoOfAttempts] [int] NULL,
	[RegistrationId] [varchar](50) NULL,
	[TestMarks] [decimal](18, 2) NULL,
	[AttendanceMarks] [decimal](18, 2) NULL,
	[ParticipationMarks] [decimal](18, 2) NULL,
	[pScoreSubmitted] [bit] NULL,
	[mScoreSubmitted] [bit] NULL,
	[SocialCategory] [varchar](100) NULL,
	[SpecialCategory] [varchar](100) NULL,
	[TypeOfMSME] [varchar](100) NULL,
	[FeedbackRefId] [varchar](50) NULL,
	[Designation] [varchar](50) NULL,
	[mRecommendation] [bit] NULL,
	[pRecommendation] [bit] NULL,
	[TacRefId] [varchar](50) NULL,
	[TacStartTime] [varchar](50) NULL,
	[TacEndTime] [varchar](50) NULL,
	[VideoPath] [varchar](500) NULL,
	[PreCourseAttemptsCount] [int] NULL,
	[IsMovedToObservant] [bit] NULL,
	[CertificateIssuedOn] [datetime] NULL,
	[VenueName] [varchar](100) NULL,
	[StartDate] [varchar](30) NULL,
	[EndDate] [varchar](30) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Photos]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Photos](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[CenterID] [varchar](100) NULL,
	[ClassRoomId] [varchar](50) NULL,
	[LabId] [varchar](50) NULL,
	[HostelId] [varchar](50) NULL,
	[Photo] [nvarchar](max) NULL,
	[AdminInfraId] [varchar](50) NULL,
	[CapturedTime] [varchar](50) NULL,
	[Name] [varchar](100) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[PlacementMela]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[PlacementMela](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NULL,
	[ChiefGuestName] [varchar](100) NULL,
	[ChiefGuestDesignation] [varchar](100) NULL,
	[IsSelfConducted] [bit] NULL,
	[PartnerDetails] [varchar](200) NULL,
	[VenueAddress] [varchar](200) NULL,
	[VenueCity] [varchar](100) NULL,
	[VenueDistrict] [varchar](50) NULL,
	[VenueState] [varchar](50) NULL,
	[VenuePinCode] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL,
	[Status] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[PlacementMonitoringPhotos]    Script Date: 10/21/2026 11:44:35 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[PlacementMonitoringPhotos](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[EmployerId] [bigint] NULL,
	[ParticipatingEmployerId] [bigint] NULL,
	[StudentJobDetailsId] [bigint] NULL,
	[KaushalMelaId] [bigint] NULL,
	[PlacementMelaId] [bigint] NULL,
	[PhotoPath] [nvarchar](max) NULL,
	[CapturedTime] [varchar](50) NULL,
	[Name] [varchar](100) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ProgramTypes]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ProgramTypes](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[ProgramTypeCode] [varchar](50) NULL,
	[ProgramType] [varchar](200) NULL,
	[CreatedDate] [datetime] NULL,
	[CreatedBy] [bigint] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Registrations]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Registrations](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Agency] [varchar](50) NULL,
	[RefId] [varchar](100) NULL,
	[Name] [varchar](100) NULL,
	[ContactNumber] [varchar](50) NULL,
	[Email] [varchar](100) NULL,
	[DOB] [varchar](50) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](50) NULL,
	[TotalIndustrialExp] [varchar](50) NULL,
	[SelectedLocation] [varchar](50) NULL,
	[ScheduledLocation] [varchar](50) NULL,
	[ApplyingFor] [varchar](50) NULL,
	[data] [nvarchar](max) NULL,
	[CreatedDate] [datetime] NULL,
	[Status] [varchar](50) NULL,
	[StatusUpdatedDate] [datetime] NULL,
	[Preference1] [varchar](100) NULL,
	[Preference2] [varchar](100) NULL,
	[Preference3] [varchar](100) NULL,
	[Preference4] [varchar](100) NULL,
	[Preference5] [varchar](100) NULL,
	[OtherPreferenceState] [varchar](100) NULL,
	[OtherPreferenceDistrict] [varchar](100) NULL,
	[OldId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[IsDisabledUpdate] [bit] NULL,
	[City] [varchar](100) NULL,
	[AadhaarNo] [varchar](100) NULL,
	[SpokenLanguagePrimary] [varchar](100) NULL,
	[WrittenLanguagePrimary] [varchar](100) NULL,
	[NominatedThrough] [varchar](100) NULL,
	[AssociatedWith] [varchar](100) NULL,
	[CBIBCRAName] [varchar](200) NULL,
	[CoordinatorName] [varchar](200) NULL,
	[CoordinatorEmail] [varchar](100) NULL,
	[CoordinatorPhone] [varchar](100) NULL,
	[AreaOfKnowledgeOrExpertise] [varchar](1000) NULL,
	[ZedDisciplines] [varchar](1000) NULL,
	[ZedDisciplinesIndustry] [varchar](1000) NULL,
	[SectorsIndustry] [varchar](1000) NULL,
	[ExperienceInMasterTraining] [varchar](100) NULL,
	[ZedDisciplinesMT] [varchar](1000) NULL,
	[SectorMT] [varchar](1000) NULL,
	[ExperienceInAssessment] [varchar](100) NULL,
	[NoOfAssessmentsDone] [varchar](1000) NULL,
	[ZedDisciplinesAT] [varchar](1000) NULL,
	[SectorAT] [varchar](1000) NULL,
	[ExperienceInConsultancy] [varchar](100) NULL,
	[NoOfConsultanciesGiven] [varchar](1000) NULL,
	[ZedDisciplinesCT] [varchar](1000) NULL,
	[SectorCT] [varchar](1000) NULL,
	[SummaryOfSkillSets] [varchar](500) NULL,
	[RejectedComments] [varchar](5000) NULL,
	[ProgrammeId] [varchar](50) NULL,
	[ActuallyAppliedFor] [varchar](100) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Registrations_Deleted]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Registrations_Deleted](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Agency] [varchar](50) NULL,
	[RefId] [varchar](100) NULL,
	[Name] [varchar](100) NULL,
	[ContactNumber] [varchar](50) NULL,
	[Email] [varchar](100) NULL,
	[DOB] [varchar](50) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](50) NULL,
	[TotalIndustrialExp] [varchar](50) NULL,
	[SelectedLocation] [varchar](50) NULL,
	[ScheduledLocation] [varchar](50) NULL,
	[ApplyingFor] [varchar](50) NULL,
	[data] [nvarchar](max) NULL,
	[CreatedDate] [datetime] NULL,
	[Status] [varchar](50) NULL,
	[StatusUpdatedDate] [datetime] NULL,
	[Preference1] [varchar](100) NULL,
	[Preference2] [varchar](100) NULL,
	[Preference3] [varchar](100) NULL,
	[Preference4] [varchar](100) NULL,
	[Preference5] [varchar](100) NULL,
	[OtherPreferenceState] [varchar](100) NULL,
	[OtherPreferenceDistrict] [varchar](100) NULL,
	[OldId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[IsDisabledUpdate] [bit] NULL,
	[City] [varchar](100) NULL,
	[AadhaarNo] [varchar](100) NULL,
	[SpokenLanguagePrimary] [varchar](100) NULL,
	[WrittenLanguagePrimary] [varchar](100) NULL,
	[NominatedThrough] [varchar](100) NULL,
	[AssociatedWith] [varchar](100) NULL,
	[CBIBCRAName] [varchar](200) NULL,
	[CoordinatorName] [varchar](200) NULL,
	[CoordinatorEmail] [varchar](100) NULL,
	[CoordinatorPhone] [varchar](100) NULL,
	[AreaOfKnowledgeOrExpertise] [varchar](1000) NULL,
	[ZedDisciplines] [varchar](1000) NULL,
	[ZedDisciplinesIndustry] [varchar](1000) NULL,
	[SectorsIndustry] [varchar](1000) NULL,
	[ExperienceInMasterTraining] [varchar](100) NULL,
	[ZedDisciplinesMT] [varchar](1000) NULL,
	[SectorMT] [varchar](1000) NULL,
	[ExperienceInAssessment] [varchar](100) NULL,
	[NoOfAssessmentsDone] [varchar](1000) NULL,
	[ZedDisciplinesAT] [varchar](1000) NULL,
	[SectorAT] [varchar](1000) NULL,
	[ExperienceInConsultancy] [varchar](100) NULL,
	[NoOfConsultanciesGiven] [varchar](1000) NULL,
	[ZedDisciplinesCT] [varchar](1000) NULL,
	[SectorCT] [varchar](1000) NULL,
	[SummaryOfSkillSets] [varchar](500) NULL,
	[RejectedComments] [varchar](1000) NULL,
	[ProgrammeId] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Registrations_old]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Registrations_old](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Agency] [varchar](50) NULL,
	[RefId] [varchar](100) NULL,
	[Name] [varchar](100) NULL,
	[ContactNumber] [varchar](50) NULL,
	[Email] [varchar](100) NULL,
	[DOB] [varchar](50) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](50) NULL,
	[TotalIndustrialExp] [varchar](50) NULL,
	[SelectedLocation] [varchar](50) NULL,
	[ScheduledLocation] [varchar](50) NULL,
	[ApplyingFor] [varchar](50) NULL,
	[data] [nvarchar](max) NULL,
	[CreatedDate] [datetime] NULL,
	[Status] [varchar](50) NULL,
	[StatusUpdatedDate] [datetime] NULL,
	[Preference1] [varchar](100) NULL,
	[Preference2] [varchar](100) NULL,
	[Preference3] [varchar](100) NULL,
	[Preference4] [varchar](100) NULL,
	[Preference5] [varchar](100) NULL,
	[OtherPreferenceState] [varchar](100) NULL,
	[OtherPreferenceDistrict] [varchar](100) NULL,
	[OldId] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[RegistrationsPhase1]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[RegistrationsPhase1](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Agency] [varchar](50) NULL,
	[RefId] [varchar](100) NULL,
	[Name] [varchar](100) NULL,
	[ContactNumber] [varchar](50) NULL,
	[Email] [varchar](100) NULL,
	[DOB] [varchar](50) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](50) NULL,
	[TotalIndustrialExp] [varchar](50) NULL,
	[SelectedLocation] [varchar](50) NULL,
	[ScheduledLocation] [varchar](50) NULL,
	[ApplyingFor] [varchar](50) NULL,
	[data] [nvarchar](max) NULL,
	[CreatedDate] [datetime] NULL,
	[Status] [varchar](50) NULL,
	[StatusUpdatedDate] [datetime] NULL,
	[Preference1] [varchar](100) NULL,
	[Preference2] [varchar](100) NULL,
	[Preference3] [varchar](100) NULL,
	[Preference4] [varchar](100) NULL,
	[Preference5] [varchar](100) NULL,
	[OtherPreferenceState] [varchar](100) NULL,
	[OtherPreferenceDistrict] [varchar](100) NULL,
	[OldId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[IsDisabledUpdate] [bit] NULL,
	[City] [varchar](100) NULL,
	[AadhaarNo] [varchar](100) NULL,
	[SpokenLanguagePrimary] [varchar](100) NULL,
	[WrittenLanguagePrimary] [varchar](100) NULL,
	[NominatedThrough] [varchar](100) NULL,
	[AssociatedWith] [varchar](100) NULL,
	[CBIBCRAName] [varchar](200) NULL,
	[CoordinatorName] [varchar](200) NULL,
	[CoordinatorEmail] [varchar](100) NULL,
	[CoordinatorPhone] [varchar](100) NULL,
	[AreaOfKnowledgeOrExpertise] [varchar](1000) NULL,
	[ZedDisciplines] [varchar](1000) NULL,
	[ZedDisciplinesIndustry] [varchar](1000) NULL,
	[SectorsIndustry] [varchar](1000) NULL,
	[ExperienceInMasterTraining] [varchar](100) NULL,
	[ZedDisciplinesMT] [varchar](1000) NULL,
	[SectorMT] [varchar](1000) NULL,
	[ExperienceInAssessment] [varchar](100) NULL,
	[NoOfAssessmentsDone] [varchar](1000) NULL,
	[ZedDisciplinesAT] [varchar](1000) NULL,
	[SectorAT] [varchar](1000) NULL,
	[ExperienceInConsultancy] [varchar](100) NULL,
	[NoOfConsultanciesGiven] [varchar](1000) NULL,
	[ZedDisciplinesCT] [varchar](1000) NULL,
	[SectorCT] [varchar](1000) NULL,
	[SummaryOfSkillSets] [varchar](500) NULL,
	[RejectedComments] [varchar](1000) NULL,
	[ProgrammeId] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[RegistrationsPhase1copy]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[RegistrationsPhase1copy](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Agency] [varchar](50) NULL,
	[RefId] [varchar](100) NULL,
	[Name] [varchar](100) NULL,
	[ContactNumber] [varchar](50) NULL,
	[Email] [varchar](100) NULL,
	[DOB] [varchar](50) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](50) NULL,
	[TotalIndustrialExp] [varchar](50) NULL,
	[SelectedLocation] [varchar](50) NULL,
	[ScheduledLocation] [varchar](50) NULL,
	[ApplyingFor] [varchar](50) NULL,
	[data] [nvarchar](max) NULL,
	[CreatedDate] [datetime] NULL,
	[Status] [varchar](50) NULL,
	[StatusUpdatedDate] [datetime] NULL,
	[Preference1] [varchar](100) NULL,
	[Preference2] [varchar](100) NULL,
	[Preference3] [varchar](100) NULL,
	[Preference4] [varchar](100) NULL,
	[Preference5] [varchar](100) NULL,
	[OtherPreferenceState] [varchar](100) NULL,
	[OtherPreferenceDistrict] [varchar](100) NULL,
	[OldId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[IsDisabledUpdate] [bit] NULL,
	[City] [varchar](100) NULL,
	[AadhaarNo] [varchar](100) NULL,
	[SpokenLanguagePrimary] [varchar](100) NULL,
	[WrittenLanguagePrimary] [varchar](100) NULL,
	[NominatedThrough] [varchar](100) NULL,
	[AssociatedWith] [varchar](100) NULL,
	[CBIBCRAName] [varchar](200) NULL,
	[CoordinatorName] [varchar](200) NULL,
	[CoordinatorEmail] [varchar](100) NULL,
	[CoordinatorPhone] [varchar](100) NULL,
	[AreaOfKnowledgeOrExpertise] [varchar](1000) NULL,
	[ZedDisciplines] [varchar](1000) NULL,
	[ZedDisciplinesIndustry] [varchar](1000) NULL,
	[SectorsIndustry] [varchar](1000) NULL,
	[ExperienceInMasterTraining] [varchar](100) NULL,
	[ZedDisciplinesMT] [varchar](1000) NULL,
	[SectorMT] [varchar](1000) NULL,
	[ExperienceInAssessment] [varchar](100) NULL,
	[NoOfAssessmentsDone] [varchar](1000) NULL,
	[ZedDisciplinesAT] [varchar](1000) NULL,
	[SectorAT] [varchar](1000) NULL,
	[ExperienceInConsultancy] [varchar](100) NULL,
	[NoOfConsultanciesGiven] [varchar](1000) NULL,
	[ZedDisciplinesCT] [varchar](1000) NULL,
	[SectorCT] [varchar](1000) NULL,
	[SummaryOfSkillSets] [varchar](500) NULL,
	[RejectedComments] [varchar](1000) NULL,
	[ProgrammeId] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Remarks]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Remarks](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Remark] [varchar](100) NULL,
	[IsActive] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Roles]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Roles](
	[RoleId] [int] IDENTITY(1,1) NOT NULL,
	[Role] [varchar](50) NULL,
	[IsActive] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ScheduledLocations]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ScheduledLocations](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[ProgramType] [varchar](50) NULL,
	[Location] [varchar](200) NULL,
	[StartDate] [date] NULL,
	[EndDate] [date] NULL,
	[CreatedBy] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL,
	[IsDisabled] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ssqlinjection]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ssqlinjection](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[data] [varchar](8000) NULL,
PRIMARY KEY CLUSTERED 
(
	[id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[STATES]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[STATES](
	[StateID] [int] NOT NULL,
	[StateName] [varchar](200) NULL,
	[Isactive] [bit] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[StudentFeedbacks]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[StudentFeedbacks](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [varchar](50) NULL,
	[QuestionId] [varchar](50) NULL,
	[QuestionText] [varchar](200) NULL,
	[AnswerId] [int] NULL,
	[CreatedDate] [datetime] NULL,
	[CreatedBy] [varchar](50) NULL,
	[zedId] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[StudentJobDetails]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[StudentJobDetails](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](50) NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [varchar](50) NULL,
	[JobDescription] [varchar](1000) NULL,
	[DateOfJoining] [date] NULL,
	[CtcAnum] [varchar](50) NULL,
	[JobDesignation] [varchar](200) NULL,
	[EmployerName] [varchar](200) NULL,
	[CreatedDate] [datetime] NULL,
	[CreatedBy] [varchar](50) NULL,
	[Status] [int] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[TacObservantsFeedback]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[TacObservantsFeedback](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[UserId] [varchar](100) NULL,
	[ObservantId] [varchar](50) NULL,
	[ObservantName] [varchar](200) NULL,
	[AbilityToExplainZEDConcepts] [int] NULL,
	[PresentationSkills] [int] NULL,
	[AbleToResolveQueries] [int] NULL,
	[SupportingThroughCaseStudies] [int] NULL,
	[RecommendAsAFaculty] [int] NULL,
	[ReceivedFeedback] [bit] NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[TacQuestionPaper]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[TacQuestionPaper](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[UserId] [varchar](100) NULL,
	[Section] [varchar](50) NULL,
	[Question] [varchar](500) NULL,
	[Answer] [varchar](50) NULL,
	[SelectedAnswer] [varchar](50) NULL,
	[Difficulty] [varchar](50) NULL,
	[TrainingType] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[TacStudentFeedback]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[TacStudentFeedback](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[UserId] [varchar](100) NULL,
	[OverallProgrammeDelivery] [int] NULL,
	[ContentAndInformationProvided] [int] NULL,
	[ExercisedAndCaseStudiesHelp] [int] NULL,
	[SessionsStructure] [int] NULL,
	[PaceOfTheProgram] [int] NULL,
	[TimelyConductOfTests] [int] NULL,
	[TrainingMaterialUsefulness] [int] NULL,
	[HowConfidentToTakeAssignmentsUnderZED] [int] NULL,
	[TopThreeImprovementAreas] [varchar](500) NULL,
	[LikeToTakeThisTrainingAgain] [varchar](50) NULL,
	[OvelallVenueArrangements] [int] NULL,
	[AvAndInternetSupport] [int] NULL,
	[RefreshmentsAndFoodQuality] [int] NULL,
	[PowerBackup] [int] NULL,
	[EventCoordinationAndTimeManagement] [int] NULL,
	[OtherSuggestionsOnVenue] [varchar](500) NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[TacTrainersFeedback]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[TacTrainersFeedback](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[UserId] [varchar](100) NULL,
	[TrainerId] [varchar](50) NULL,
	[TrainerName] [varchar](200) NULL,
	[TrainersKnowledge] [int] NULL,
	[ConfidenceLevel] [int] NULL,
	[PresentationSkills] [int] NULL,
	[TrainersInteration] [int] NULL,
	[AbleToResolveQueries] [int] NULL,
	[OpenToIdeas] [int] NULL,
	[AbleToShareExamples] [int] NULL,
	[TimeManagement] [int] NULL,
	[TimelyArrival] [int] NULL,
	[StressHandling] [int] NULL,
	[EngagementLevelAndPositiveRapport] [int] NULL,
	[ReceivedFeedback] [bit] NULL,
	[OtherSuggestions] [varchar](5000) NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[TrainerInformation]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[TrainerInformation](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[CenterId] [varchar](100) NOT NULL,
	[TrainerId] [int] NOT NULL,
	[TrainerName] [varchar](200) NULL,
	[TrainerEngagement] [varchar](50) NULL,
	[ExperienceInYears] [int] NULL,
	[Qualification] [varchar](50) NULL,
	[EMailId] [varchar](100) NULL,
	[ContactNo] [varchar](50) NULL,
	[StudentCoursewareAvail] [bit] NULL,
	[TTTCertificationDone] [bit] NULL,
	[TrainerHandbookAvail] [bit] NULL,
	[RefId] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL,
	[AdhaarNo] [varchar](50) NULL,
	[TrainerType] [varchar](50) NULL,
	[RegId] [int] NULL,
	[IsActive] [bit] NULL,
	[Resume] [varchar](500) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[UserJobRoles]    Script Date: 10/21/2026 11:44:36 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[UserJobRoles](
	[UserId] [varchar](50) NULL,
	[QPID] [varchar](50) NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Users]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Users](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[UserID] [varchar](50) NULL,
	[Password] [varchar](50) NULL,
	[DisplayName] [varchar](200) NULL,
	[RoleId] [int] NULL,
	[IsActive] [bit] NULL,
	[FirstName] [varchar](100) NULL,
	[MiddleName] [varchar](100) NULL,
	[LastName] [varchar](100) NULL,
	[FatherName] [varchar](100) NULL,
	[DOB] [date] NULL,
	[email] [varchar](100) NULL,
	[phoneno] [varchar](15) NULL,
	[BatchId] [int] NULL,
	[CreatedBy] [varchar](100) NULL,
	[CreatedDate] [date] NULL,
	[CreatedTime] [time](7) NULL,
	[MyDateTime] [datetime] NULL,
	[address] [varchar](200) NULL,
	[location] [varchar](200) NULL,
	[StateID] [int] NULL,
	[DistrictId] [int] NULL,
	[PinCode] [varchar](6) NULL,
	[Coupons] [int] NULL,
	[SpocName] [varchar](100) NULL,
	[ProgrammeType] [varchar](50) NULL,
	[AdhaarNo] [varchar](50) NULL,
	[PanNo] [varchar](50) NULL,
	[UpdatedBy] [varchar](100) NULL,
	[UpdatedDate] [datetime] NULL,
	[OrganizationName] [varchar](100) NULL,
	[CandidateId] [varchar](50) NULL,
	[BatchNumber] [varchar](50) NULL,
	[GstNo] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedFacultyOrSME]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedFacultyOrSME](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Agency] [varchar](50) NULL,
	[RefId] [varchar](100) NULL,
	[Name] [varchar](100) NULL,
	[ContactNumber] [varchar](50) NULL,
	[Email] [varchar](100) NULL,
	[DOB] [varchar](50) NULL,
	[State] [varchar](50) NULL,
	[District] [varchar](50) NULL,
	[TotalIndustrialExp] [varchar](50) NULL,
	[SelectedLocation] [varchar](50) NULL,
	[ScheduledLocation] [varchar](50) NULL,
	[ApplyingFor] [varchar](50) NULL,
	[data] [nvarchar](max) NULL,
	[CreatedDate] [datetime] NULL,
	[Status] [varchar](50) NULL,
	[StatusUpdatedDate] [datetime] NULL,
	[Preference1] [varchar](100) NULL,
	[Preference2] [varchar](100) NULL,
	[Preference3] [varchar](100) NULL,
	[Preference4] [varchar](100) NULL,
	[Preference5] [varchar](100) NULL,
	[OtherPreferenceState] [varchar](100) NULL,
	[OtherPreferenceDistrict] [varchar](100) NULL,
	[OldId] [varchar](50) NULL,
	[Comments] [varchar](500) NULL,
	[Agencies] [varchar](2000) NULL,
	[NatureOfAssociation] [varchar](100) NULL,
	[TrainingOrganization] [varchar](100) NULL,
	[AadhaarNo] [varchar](50) NULL,
	[RefIdApp] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTac]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTac](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[UserId] [varchar](200) NULL,
	[JsonData] [varchar](max) NULL,
	[CreatedDate] [datetime] NULL,
	[BatchNo] [varchar](50) NULL,
	[StartTime] [varchar](50) NULL,
	[EndTime] [varchar](50) NULL,
	[TotalMarks] [int] NULL,
	[MarksObtained] [int] NULL,
	[ExamType] [varchar](50) NULL,
	[PreCourseAttemptsCount] [int] NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacOptions]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacOptions](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[SectionCode] [varchar](50) NULL,
	[QuestionCode] [varchar](50) NULL,
	[OptionCode] [varchar](50) NULL,
	[OptionName] [varchar](1000) NULL,
	[OptionNameOfAssamese] [nvarchar](4000) NULL,
	[OptionNameOfHindi] [nvarchar](4000) NULL,
	[OptionNameOfOdia] [nvarchar](4000) NULL,
	[OptionNameOfKannada] [nvarchar](4000) NULL,
	[NewOrderNo] [int] NULL,
	[OptionNameOfTelugu] [nvarchar](4000) NULL,
	[QuestionnaireName] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacOptions_13082026]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacOptions_13082026](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[SectionCode] [varchar](50) NULL,
	[QuestionCode] [varchar](50) NULL,
	[OptionCode] [varchar](50) NULL,
	[OptionName] [varchar](1000) NULL,
	[OptionNameOfAssamese] [nvarchar](4000) NULL,
	[OptionNameOfHindi] [nvarchar](4000) NULL,
	[OptionNameOfOdia] [nvarchar](4000) NULL,
	[OptionNameOfKannada] [nvarchar](4000) NULL,
	[NewOrderNo] [int] NULL,
	[OptionNameOfTelugu] [nvarchar](4000) NULL,
	[QuestionnaireName] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacOptionsV1]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacOptionsV1](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[SectionCode] [varchar](50) NULL,
	[QuestionCode] [varchar](50) NULL,
	[OptionCode] [varchar](50) NULL,
	[OptionName] [varchar](1000) NULL,
	[OptionNameOfAssamese] [nvarchar](4000) NULL,
	[OptionNameOfHindi] [nvarchar](4000) NULL,
	[OptionNameOfOdia] [nvarchar](4000) NULL,
	[OptionNameOfKannada] [nvarchar](4000) NULL,
	[NewOrderNo] [int] NULL,
	[OptionNameOfTelugu] [nvarchar](4000) NULL,
	[QuestionnaireName] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacOptionsV2_09082023]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacOptionsV2_09082023](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[SectionCode] [varchar](50) NULL,
	[QuestionCode] [varchar](50) NULL,
	[OptionCode] [varchar](50) NULL,
	[OptionName] [varchar](1000) NULL,
	[OptionNameOfAssamese] [nvarchar](4000) NULL,
	[OptionNameOfHindi] [nvarchar](4000) NULL,
	[OptionNameOfOdia] [nvarchar](4000) NULL,
	[OptionNameOfKannada] [nvarchar](4000) NULL,
	[NewOrderNo] [int] NULL,
	[OptionNameOfTelugu] [nvarchar](4000) NULL,
	[QuestionnaireName] [varchar](50) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacPracticalScore]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacPracticalScore](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [int] NULL,
	[CreatedDate] [datetime] NULL,
	[Attendance] [decimal](18, 2) NULL,
	[ClassParticipation] [decimal](18, 2) NULL,
	[CommunicationSkills] [decimal](18, 2) NULL,
	[AssessmentSkills] [decimal](18, 2) NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacQuestions]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacQuestions](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[SectionCode] [varchar](50) NULL,
	[SectionName] [varchar](50) NULL,
	[OrderNo] [bigint] NULL,
	[QuestionCode] [varchar](50) NULL,
	[QuestionName] [varchar](2000) NULL,
	[CorrectAnswer] [varchar](50) NULL,
	[MaximumMarks] [int] NULL,
	[AnswerType] [varchar](50) NULL,
	[VisibilityRule] [varchar](200) NULL,
	[HelpText] [varchar](500) NULL,
	[QuestionNameOfAssamese] [nvarchar](max) NULL,
	[QuestionNameOfHindi] [nvarchar](max) NULL,
	[QuestionNameOfOdia] [nvarchar](max) NULL,
	[QuestionNameOfKannada] [nvarchar](max) NULL,
	[NewOrderNo] [int] NULL,
	[QuestionNameOfTelugu] [nvarchar](max) NULL,
	[Sno] [varchar](10) NULL,
	[QuestionniareCategory] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacQuestions_13082026]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacQuestions_13082026](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[SectionCode] [varchar](50) NULL,
	[SectionName] [varchar](50) NULL,
	[OrderNo] [bigint] NULL,
	[QuestionCode] [varchar](50) NULL,
	[QuestionName] [varchar](2000) NULL,
	[CorrectAnswer] [varchar](50) NULL,
	[MaximumMarks] [int] NULL,
	[AnswerType] [varchar](50) NULL,
	[VisibilityRule] [varchar](200) NULL,
	[HelpText] [varchar](500) NULL,
	[QuestionNameOfAssamese] [nvarchar](max) NULL,
	[QuestionNameOfHindi] [nvarchar](max) NULL,
	[QuestionNameOfOdia] [nvarchar](max) NULL,
	[QuestionNameOfKannada] [nvarchar](max) NULL,
	[NewOrderNo] [int] NULL,
	[QuestionNameOfTelugu] [nvarchar](max) NULL,
	[Sno] [varchar](10) NULL,
	[QuestionniareCategory] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacQuestionsV1]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacQuestionsV1](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[SectionCode] [varchar](50) NULL,
	[SectionName] [varchar](50) NULL,
	[OrderNo] [bigint] NULL,
	[QuestionCode] [varchar](50) NULL,
	[QuestionName] [varchar](2000) NULL,
	[CorrectAnswer] [varchar](50) NULL,
	[MaximumMarks] [int] NULL,
	[AnswerType] [varchar](50) NULL,
	[VisibilityRule] [varchar](200) NULL,
	[HelpText] [varchar](500) NULL,
	[QuestionNameOfAssamese] [nvarchar](max) NULL,
	[QuestionNameOfHindi] [nvarchar](max) NULL,
	[QuestionNameOfOdia] [nvarchar](max) NULL,
	[QuestionNameOfKannada] [nvarchar](max) NULL,
	[NewOrderNo] [int] NULL,
	[QuestionNameOfTelugu] [nvarchar](max) NULL,
	[Sno] [varchar](10) NULL,
	[QuestionniareCategory] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacQuestionsV2_09082023]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacQuestionsV2_09082023](
	[Id] [bigint] IDENTITY(1,1) NOT NULL,
	[SectionCode] [varchar](50) NULL,
	[SectionName] [varchar](50) NULL,
	[OrderNo] [bigint] NULL,
	[QuestionCode] [varchar](50) NULL,
	[QuestionName] [varchar](2000) NULL,
	[CorrectAnswer] [varchar](50) NULL,
	[MaximumMarks] [int] NULL,
	[AnswerType] [varchar](50) NULL,
	[VisibilityRule] [varchar](200) NULL,
	[HelpText] [varchar](500) NULL,
	[QuestionNameOfAssamese] [nvarchar](max) NULL,
	[QuestionNameOfHindi] [nvarchar](max) NULL,
	[QuestionNameOfOdia] [nvarchar](max) NULL,
	[QuestionNameOfKannada] [nvarchar](max) NULL,
	[NewOrderNo] [int] NULL,
	[QuestionNameOfTelugu] [nvarchar](max) NULL,
	[Sno] [varchar](10) NULL,
	[QuestionniareCategory] [varchar](50) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacSelfAssessmentQuestions]    Script Date: 10/21/2026 11:44:37 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacSelfAssessmentQuestions](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[AssessmentId] [varchar](50) NULL,
	[CandidateId] [int] NULL,
	[SectionCode] [varchar](50) NULL,
	[SectionText] [varchar](1000) NULL,
	[QuestionCode] [varchar](50) NULL,
	[QuestionText] [varchar](1000) NULL,
	[AnswerType] [varchar](50) NULL,
	[AnswerCode] [varchar](500) NULL,
	[AnswerText] [varchar](6000) NULL,
	[AnswerOther] [varchar](2000) NULL,
	[CreatedDate] [datetime] NULL
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ZedTacSelfAssessments]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ZedTacSelfAssessments](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[BatchNo] [varchar](50) NULL,
	[CandidateId] [int] NULL,
	[CreatedDate] [datetime] NULL,
	[FinalSubmitDate] [datetime] NULL,
	[Status] [int] NULL
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[BatchAttendance] ADD  CONSTRAINT [DF_BatchAttendance_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[BatchAttendance] ADD  CONSTRAINT [DF_BatchAttendance_CreatedTime]  DEFAULT (getdate()) FOR [CreatedTime]
GO
ALTER TABLE [dbo].[Batches] ADD  CONSTRAINT [DF_Batches_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[Batches] ADD  CONSTRAINT [DF_Batches_Status]  DEFAULT ('0') FOR [Status]
GO
ALTER TABLE [dbo].[Batches] ADD  CONSTRAINT [DF__Batches__IsRegis__6F4A8121]  DEFAULT ((0)) FOR [IsRegistrationsClosed]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_IsPhotoUploaded]  DEFAULT ((0)) FOR [IsPhotoUploaded]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_Rating1]  DEFAULT ((0)) FOR [Rating1]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_Rating2]  DEFAULT ((0)) FOR [Rating2]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_Rating3]  DEFAULT ((0)) FOR [Rating3]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_Rating4]  DEFAULT ((0)) FOR [Rating4]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_Rating5]  DEFAULT ((0)) FOR [Rating5]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_Rating6]  DEFAULT ((0)) FOR [Rating6]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_IsSubmittedPScore]  DEFAULT ((0)) FOR [pScoreSubmitted]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_IsSubmittedMScore]  DEFAULT ((0)) FOR [mScoreSubmitted]
GO
ALTER TABLE [dbo].[Candidates] ADD  CONSTRAINT [DF_Candidates_RegdTraingThroughLinkOn]  DEFAULT (getdate()) FOR [RegdTraingThroughLinkOn]
GO
ALTER TABLE [dbo].[Candidates] ADD  DEFAULT ((0)) FOR [IsActive]
GO
ALTER TABLE [dbo].[CenterInfo] ADD  CONSTRAINT [DF_CenterInfo_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[CenterJobRoles] ADD  CONSTRAINT [DF_CenterJobRoles_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[CenterMonitoring] ADD  CONSTRAINT [DF_CenterMonitoring_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[Coupons] ADD  CONSTRAINT [DF_Coupons_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[Duplicates] ADD  CONSTRAINT [DF_Duplicates_createddate]  DEFAULT (getdate()) FOR [createddate]
GO
ALTER TABLE [dbo].[Employers] ADD  CONSTRAINT [DF_Employers_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[JobRoles] ADD  CONSTRAINT [DF_JobRoles_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[JobRoles] ADD  CONSTRAINT [DF_JobRoles_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[KaushalMela] ADD  CONSTRAINT [DF_KaushalMela_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[KaushalMela] ADD  CONSTRAINT [DF_KaushalMela_Status]  DEFAULT ((0)) FOR [Status]
GO
ALTER TABLE [dbo].[MonitoringPhotos] ADD  CONSTRAINT [DF_MonitoringPhotos_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[MScores] ADD  CONSTRAINT [DF_MScores_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[NosDetails] ADD  CONSTRAINT [DF_NosDetails_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[NosDetails] ADD  CONSTRAINT [DF_NosDetails_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[ObservantInformation] ADD  CONSTRAINT [DF_ObservantInformation_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[ObservantInformation] ADD  CONSTRAINT [DF_ObservantInformation_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[Observers] ADD  CONSTRAINT [DF_Observer_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[OTP] ADD  CONSTRAINT [DF_OTP_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[PcDetails] ADD  CONSTRAINT [DF_PcDetails_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[PcDetails] ADD  CONSTRAINT [DF_PcDetails_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[PlacementMela] ADD  CONSTRAINT [DF_PlacementMela_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[PlacementMela] ADD  CONSTRAINT [DF_PlacementMela_Status]  DEFAULT ((0)) FOR [Status]
GO
ALTER TABLE [dbo].[ProgramTypes] ADD  CONSTRAINT [DF_ProgramTypes_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[Registrations] ADD  CONSTRAINT [DF_Registrations_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[Registrations] ADD  CONSTRAINT [DF_Registrations_Status]  DEFAULT ('NEW') FOR [Status]
GO
ALTER TABLE [dbo].[RegistrationsPhase1] ADD  CONSTRAINT [DF_RegistrationsPhase1_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[RegistrationsPhase1] ADD  CONSTRAINT [DF_RegistrationsPhase1_Status]  DEFAULT ('NEW') FOR [Status]
GO
ALTER TABLE [dbo].[ScheduledLocations] ADD  CONSTRAINT [DF_ScheduledLocations_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[StudentFeedbacks] ADD  CONSTRAINT [DF_StudentFeedbacks_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[StudentJobDetails] ADD  CONSTRAINT [DF_StudentsPlacements_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[StudentJobDetails] ADD  CONSTRAINT [DF_StudentsPlacements_Status]  DEFAULT ((0)) FOR [Status]
GO
ALTER TABLE [dbo].[TacObservantsFeedback] ADD  CONSTRAINT [DF_TacObservantsFeedback_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[TacStudentFeedback] ADD  CONSTRAINT [DF_TacStudentFeedback_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[TacTrainersFeedback] ADD  CONSTRAINT [DF_TacTrainersFeedback_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[TrainerInformation] ADD  CONSTRAINT [DF_TrainerInformation_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[TrainerInformation] ADD  CONSTRAINT [DF_TrainerInformation_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[UserJobRoles] ADD  CONSTRAINT [DF_UserJobRoles_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[Users] ADD  CONSTRAINT [DF_Users_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[Users] ADD  CONSTRAINT [DF_Users_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[ZedFacultyOrSME] ADD  CONSTRAINT [DF_ZedFacultyOrSME_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[ZedFacultyOrSME] ADD  CONSTRAINT [DF_ZedFacultyOrSME_Status]  DEFAULT ('NEW') FOR [Status]
GO
ALTER TABLE [dbo].[ZedTac] ADD  CONSTRAINT [DF_ZedTac_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[ZedTacPracticalScore] ADD  CONSTRAINT [DF_ZedTacPracticalScore_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[ZedTacSelfAssessments] ADD  CONSTRAINT [DF_SelfAssessments_CreatedDate]  DEFAULT (getdate()) FOR [CreatedDate]
GO
ALTER TABLE [dbo].[ZedTacSelfAssessments] ADD  CONSTRAINT [DF__SelfAsses__Statu__571DF1D5]  DEFAULT ((0)) FOR [Status]
GO
/****** Object:  StoredProcedure [dbo].[SP_BATCH_FINAL_APPROVAL]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_BATCH_FINAL_APPROVAL]
(
	 @BatchNo varchar(50)
)
AS
BEGIN
	UPDATE Batches SET Status=1,FinalApprovalDate=GetDate() WHERE BatchNo=@BatchNo
	--UPDATE Batches SET FinalApprovalDate=GetDate() WHERE BatchNo=@BatchNo

	insert into Candidates (BatchNo, FirstName, MobileNo, EmailId, State, District, AdhaarNo, RegistrationId)
	select BatchNo, Name, ContactNumber, Email, State, District, AadhaarNo, Id from registrations where batchno=@BatchNo

	update Candidates SET CandidateId=Id where batchno=@BatchNo

	insert into Users (UserID, Password, DisplayName, RoleId, IsActive, FirstName, Email, PhoneNo, BatchNumber, AdhaarNo, CandidateId)
	select EmailId, LOWER(SUBSTRING(CONVERT(varchar(40), NEWID()),0,5)) Password, FirstName DisplayName, 7 AS RoleId, 1 AS IsActive, FirstName, EmailId, MobileNo, BatchNo, AdhaarNo, Id
	from Candidates where batchno=@BatchNo

	UPDATE Registrations SET Status='FINALAPPROVED' WHERE BatchNo=@BatchNo

	select UserID, Password, FirstName from Users where batchNumber=@BatchNo
END
GO
/****** Object:  StoredProcedure [dbo].[SP_BATCH_LAST_MINUTE_UPLOAD]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_BATCH_LAST_MINUTE_UPLOAD] --'<redacted>', NULL
(
	 @BatchNo varchar(50),
	 @Participants varchar(500) = NULL
)
AS
BEGIN
	INSERT INTO Duplicates (BatchNo,ParticipantsIds) VALUES (@BatchNo, @Participants)

	insert into Candidates (BatchNo, FirstName, MobileNo, EmailId, State, District, AdhaarNo, RegistrationId)
	select BatchNo, Name, ContactNumber, Email, State, District, AadhaarNo, Id from registrations 
	where batchno=@BatchNo and Id not in (select RegistrationId from Candidates where BatchNo=@BatchNo)

	update Candidates SET CandidateId=Id where batchno=@BatchNo

	insert into Users (UserID, Password, DisplayName, RoleId, IsActive, FirstName, Email, PhoneNo, BatchNumber, AdhaarNo, CandidateId)
	select EmailId, LOWER(SUBSTRING(CONVERT(varchar(40), NEWID()),0,5)) Password, FirstName DisplayName, 7 AS RoleId, 1 AS IsActive, FirstName, EmailId, MobileNo, BatchNo, AdhaarNo, Id
	from Candidates where batchno=@BatchNo and Id not in (select CandidateId from Users where BatchNumber=@BatchNo)

	UPDATE Registrations SET Status='FINALAPPROVED' WHERE BatchNo=@BatchNo

	--select UserID, Password, FirstName from Users where batchNumber=@BatchNo
	select UserID, Password, FirstName from Users where batchNumber=@BatchNo AND CandidateId IN 
	(
		select Id from Candidates where batchno=@BatchNo and RegistrationId in (SELECT Data FROM SplitString(@Participants, ','))
	)
END
GO
/****** Object:  StoredProcedure [dbo].[SP_EXPORT_AWS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_EXPORT_AWS]
(
	@Type varchar(100) = NULL,
	@State varchar(100) = NULL,
	@Agency varchar(100) = NULL
)
AS
BEGIN
	IF @Type IS NULL
		SET @Type = 'ZEDAP' 
	select StateName, FirstName AS AgencyName, Count(*) AS Programmes, SUM(NoOfCandidates) Participants, SUM(NoOfCandidates)/Count(*) AS AverageParticipants from 
	(
		SELECT B.BatchNo, U.UserID, U.FirstName, S.StateId, S.StateName, isnull(CC.NoOfCandidates,0) NoOfCandidates
		FROM Batches B
		INNER JOIN Users U ON (B.CenterId=U.UserID)
		INNER JOIN States S ON (B.State=S.StateID)
		LEFT JOIN (select BatchNo, Count(*) NoOfCandidates from Candidates group by BatchNo) CC ON (B.BatchNo=CC.BatchNo)
		WHERE ProgramType=@Type AND S.StateId = ISNULL(@State, S.StateId) AND U.UserID = ISNULL(@Agency, UserID)
	) a
	group by StateId, StateName,FirstName, UserID
	ORDER BY Programmes DESC
END

GO
/****** Object:  StoredProcedure [dbo].[SP_EXPORT_PROGRAMMES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_EXPORT_PROGRAMMES] --NULL,NULL,NULL,'<redacted>',NULL,NULL
(
	@State varchar(100) = NULL,
	@centerId varchar(100) = NULL,
	@Coordinator varchar(100) = NULL,
	@Status varchar(100) = NULL,
	@ProgramType varchar(100) = NULL,
	@ReportType varchar(100) = NULL,
	@StartDate varchar(100) = NULL,
	@EndDate varchar(100) = NULL
)
AS
BEGIN

	IF @ProgramType = 'Awareness' 
		SET @ProgramType='ZEDAP'
	IF @ProgramType = 'Training' 
		SET @ProgramType='ZEDTP'

	IF @ReportType = 'Upcoming'
	BEGIN
		SELECT CenterId, B.BatchNo ProgrammeID, B.ProgramType,J.QpName ProgrammeName,B.VenueName Venue,S.StateName State,D.districtname District,B.Zip PinCode,
		U.FirstName Coordinator, U.phoneno MobileNo, B.Coordinator EMailID, CumulativeFeedback,
		Convert(varchar,StartDate,106) AS ProgrammeStartDate, Convert(varchar,EndDate,106) AS ProgrammeEndDate
		FROM Batches B
		LEFT JOIN JobRoles J ON (B.QpCode = J.QpCode)
		LEFT JOIN States S ON(B.State = S.StateID)
		LEFT JOIN Districts D ON(B.State = D.StateID AND B.District = D.districtID)
		LEFT JOIN Users U ON(B.Coordinator = U.UserID)
		LEFT JOIN (select BatchNo, cast((Convert(float,SUM(AnswerId)) / Count(AnswerId)) as numeric(36,2)) CumulativeFeedback from StudentFeedbacks group by BatchNo) F ON (B.BatchNo=F.BatchNo)

		WHERE State = ISNULL(@State, B.State)
			AND CenterId = ISNULL(@centerId, CenterId)
			AND [Status] = ISNULL(@Status, [Status])
			AND ProgramType = ISNULL(@ProgramType, B.ProgramType)
			AND B.StartDate >= ISNULL(@StartDate, B.StartDate)
			AND B.StartDate <= ISNULL(@EndDate, B.StartDate)
			AND B.StartDate > GETDATE()
    	
		ORDER BY StartDate DESC
	END
	ELSE IF @ReportType = 'Conducted'
	BEGIN
		SELECT CenterId, B.BatchNo ProgrammeID, B.ProgramType,J.QpName ProgrammeName,B.VenueName Venue,S.StateName State,D.districtname District,B.Zip PinCode,
		U.FirstName Coordinator, U.phoneno MobileNo, B.Coordinator EMailID, CumulativeFeedback,
		Convert(varchar,StartDate,106) AS ProgrammeStartDate, Convert(varchar,EndDate,106) AS ProgrammeEndDate
		FROM Batches B
		LEFT JOIN JobRoles J ON (B.QpCode = J.QpCode)
		LEFT JOIN States S ON(B.State = S.StateID)
		LEFT JOIN Districts D ON(B.State = D.StateID AND B.District = D.districtID)
		LEFT JOIN Users U ON(B.Coordinator = U.UserID)
		LEFT JOIN (select BatchNo, cast((Convert(float,SUM(AnswerId)) / Count(AnswerId)) as numeric(36,2)) CumulativeFeedback from StudentFeedbacks group by BatchNo) F ON (B.BatchNo=F.BatchNo)

		WHERE State = ISNULL(@State, B.State)
			AND CenterId = ISNULL(@centerId, CenterId)
			AND [Status] IN (2,3,5)
			AND ProgramType = ISNULL(@ProgramType, B.ProgramType)
			AND B.StartDate >= ISNULL(@StartDate, B.StartDate)
			AND B.StartDate <= ISNULL(@EndDate, B.StartDate)
    	
		ORDER BY StartDate DESC
	END
	ELSE IF @ReportType = 'New'
	BEGIN
		SELECT CenterId, B.BatchNo ProgrammeID, B.ProgramType,J.QpName ProgrammeName,B.VenueName Venue,S.StateName State,D.districtname District,B.Zip PinCode,
		U.FirstName Coordinator, U.phoneno MobileNo, B.Coordinator EMailID, CumulativeFeedback,
		Convert(varchar,StartDate,106) AS ProgrammeStartDate, Convert(varchar,EndDate,106) AS ProgrammeEndDate
		FROM Batches B
		LEFT JOIN JobRoles J ON (B.QpCode = J.QpCode)
		LEFT JOIN States S ON(B.State = S.StateID)
		LEFT JOIN Districts D ON(B.State = D.StateID AND B.District = D.districtID)
		LEFT JOIN Users U ON(B.Coordinator = U.UserID)
		LEFT JOIN (select BatchNo, cast((Convert(float,SUM(AnswerId)) / Count(AnswerId)) as numeric(36,2)) CumulativeFeedback from StudentFeedbacks group by BatchNo) F ON (B.BatchNo=F.BatchNo)

		WHERE State = ISNULL(@State, B.State)
			AND CenterId = ISNULL(@centerId, CenterId)
			AND [Status] IN (0, 1, 2, 3, 4, 5, 6, 7)
			AND ProgramType = ISNULL(@ProgramType, B.ProgramType)
			AND B.StartDate >= ISNULL(@StartDate, B.StartDate)
			AND B.StartDate <= ISNULL(@EndDate, B.StartDate)
    	
		ORDER BY StartDate DESC
	END
	ELSE
	BEGIN
		SELECT CenterId, B.BatchNo ProgrammeID, B.ProgramType,J.QpName ProgrammeName,B.VenueName Venue,S.StateName State,D.districtname District,B.Zip PinCode,
		U.FirstName Coordinator, U.phoneno MobileNo, B.Coordinator EMailID, CumulativeFeedback,
		Convert(varchar,StartDate,106) AS ProgrammeStartDate, Convert(varchar,EndDate,106) AS ProgrammeEndDate
		FROM Batches B
		LEFT JOIN JobRoles J ON (B.QpCode = J.QpCode)
		LEFT JOIN States S ON(B.State = S.StateID)
		LEFT JOIN Districts D ON(B.State = D.StateID AND B.District = D.districtID)
		LEFT JOIN Users U ON(B.Coordinator = U.UserID)
		LEFT JOIN (select BatchNo, cast((Convert(float,SUM(AnswerId)) / Count(AnswerId)) as numeric(36,2)) CumulativeFeedback from StudentFeedbacks group by BatchNo) F ON (B.BatchNo=F.BatchNo)

		WHERE State = ISNULL(@State, B.State)
			AND Coordinator = ISNULL(@Coordinator, Coordinator)
			AND CenterId = ISNULL(@centerId, CenterId)
			AND [Status] = ISNULL(@Status, [Status])
			AND ProgramType = ISNULL(@ProgramType, B.ProgramType)
			AND B.StartDate >= ISNULL(@StartDate, B.StartDate)
			AND B.StartDate <= ISNULL(@EndDate, B.StartDate)
    	
		ORDER BY StartDate DESC
	END
END

GO
/****** Object:  StoredProcedure [dbo].[SP_EXPORT_REGISTRATIONS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_EXPORT_REGISTRATIONS] --'',NULL,'', NULL,NULL,'',NULL,NULL
(
	@State varchar(100) = NULL,
	@centerId varchar(100) = NULL,
	@Coordinator varchar(100) = NULL,
	@Status varchar(100) = NULL,
	@ProgramType varchar(100) = NULL,
	@ReportType varchar(100) = NULL,
	@StartDate varchar(100) = NULL,
	@EndDate varchar(100) = NULL
)
AS
BEGIN
	IF @State=''
		SET @State=NULL
	IF @Coordinator=''
		SET @Coordinator=NULL
	IF @ReportType=''
		SET @ReportType=NULL

	SELECT R.Status, R.Name, R.Email, R.ContactNumber, R.ApplyingFor, 
		NominatedThrough, AssociatedWith, CBIBCRAName, CoordinatorName, CoordinatorEmail, CoordinatorPhone, 
		AadhaarNo, R.DOB, State, District, City, SpokenLanguagePrimary, WrittenLanguagePrimary, 
		ZedDisciplines, AreaOfKnowledgeOrExpertise, 
		TotalIndustrialExp, ZedDisciplinesIndustry, SectorsIndustry, 
		ExperienceInMasterTraining, ZedDisciplinesMT 'ZedDisciplines (MT)', SectorMT 'Sector (MT)', 
		ExperienceInAssessment, NoOfAssessmentsDone, ZedDisciplinesAT 'ZedDisciplines (AT)', SectorAT 'Sector (AT)', 
		ExperienceInConsultancy, NoOfConsultanciesGiven, ZedDisciplinesCT 'ZedDisciplines (CT)', SectorCT 'Sector (CT)', 
		SummaryOfSkillSets,
		Preference1, Preference2, Preference3, Preference4, Preference5, OtherPreferenceState, OtherPreferenceDistrict
	FROM Registrations R
	INNER JOIN Users U ON (R.Agency=U.Id)
	WHERE ApplyingFor=ISNULL(@ReportType, ApplyingFor) --AND Preference1=ISNULL(@State, Preference1) 
	AND U.FirstName=ISNULL(@Coordinator, U.FirstName)
	ORDER BY ApplyingFor
END

GO
/****** Object:  StoredProcedure [dbo].[SP_EXPORT_REGISTRATIONS_PASSED]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_EXPORT_REGISTRATIONS_PASSED] --'',NULL,'', NULL,NULL,'',NULL,NULL
(
	@State varchar(100) = NULL,
	@centerId varchar(100) = NULL,
	@Coordinator varchar(100) = NULL,
	@Status varchar(100) = NULL,
	@ProgramType varchar(100) = NULL,
	@ReportType varchar(100) = NULL,
	@StartDate varchar(100) = NULL,
	@EndDate varchar(100) = NULL
)
AS
BEGIN
	IF @State=''
		SET @State=NULL
	IF @Coordinator=''
		SET @Coordinator=NULL
	IF @ReportType=''
		SET @ReportType=NULL

	SELECT R.Status, R.Name, R.Email, R.ContactNumber, R.ApplyingFor, 
		NominatedThrough, AssociatedWith, CBIBCRAName, CoordinatorName, CoordinatorEmail, CoordinatorPhone, 
		AadhaarNo, R.DOB, State, District, City, SpokenLanguagePrimary, WrittenLanguagePrimary, 
		ZedDisciplines, AreaOfKnowledgeOrExpertise, 
		TotalIndustrialExp, ZedDisciplinesIndustry, SectorsIndustry, 
		ExperienceInMasterTraining, ZedDisciplinesMT 'ZedDisciplines (MT)', SectorMT 'Sector (MT)', 
		ExperienceInAssessment, NoOfAssessmentsDone, ZedDisciplinesAT 'ZedDisciplines (AT)', SectorAT 'Sector (AT)', 
		ExperienceInConsultancy, NoOfConsultanciesGiven, ZedDisciplinesCT 'ZedDisciplines (CT)', SectorCT 'Sector (CT)', 
		SummaryOfSkillSets,
		Preference1, Preference2, Preference3, Preference4, Preference5, OtherPreferenceState, OtherPreferenceDistrict,
		R.BatchNo, Passed.ZedTac, Passed.MScore, Passed.W, Passed.P, Passed.Score, Passed.Status
	FROM Registrations R
	INNER JOIN Users U ON (R.Agency=U.Id)
	INNER JOIN 
	(
		--SELECT BatchNo, ZedTac, ParticipantName, EmailID, MScore, W, P, MScore + W + P AS Score FROM
		--(
		--	SELECT B.BatchNo, C.FirstName+'<redacted>'+ISNULL(C.LastName, '') ParticipantName, C.EmailID, C.ZedTac,
		--		CASE  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('<redacted>', '<redacted>') THEN convert(decimal(10,2),M.score / 100.00)
		--			  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('<redacted>') THEN convert(decimal(10,2),M.score / 170.00)
		--		ELSE NULL END AS MScore, C.W, C.P
		--	FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
		--	LEFT JOIN (SELECT BatchNo, CandidateId, SUM(Rating)*30 AS Score FROM MScores GROUP BY BatchNo, CandidateId) M ON (B.BatchNo=M.BatchNo AND C.CandidateId=M.CandidateId)
		--	WHERE B.QpCode in ('<redacted>', '<redacted>', '<redacted>') AND C.W IS NOT NULl AND C.P IS NOT NULL
		--) A
		--WHERE MScore + W + P >= 60.00
		SELECT BatchNo, ZedTac, ParticipantName, EmailID, MScore, W, P, MScore + W + P AS Score,
			CASE WHEN MScore + W + P >= 60.00 THEN 'Passed' ELSE 'Failed' END AS Status
		FROM
		(
			SELECT B.BatchNo, C.FirstName+' '+ISNULL(C.LastName, '') ParticipantName, C.EmailID, C.ZedTac,
				CASE  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP15', 'ZED/TP16') THEN convert(decimal(10,2),M.score / 100.00)
					  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP14') THEN convert(decimal(10,2),M.score / 170.00)
				ELSE NULL END AS MScore, C.W, C.P
			FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
			LEFT JOIN (SELECT BatchNo, CandidateId, SUM(Rating)*30 AS Score FROM MScores GROUP BY BatchNo, CandidateId) M ON (B.BatchNo=M.BatchNo AND C.CandidateId=M.CandidateId)
			WHERE B.QpCode in ('ZED/TP14', 'ZED/TP15', 'ZED/TP16') --AND C.W IS NOT NULl AND C.P IS NOT NULL
		) A
		--WHERE MScore + W + P >= 60.00
	) Passed ON (Passed.BatchNo=R.BatchNo AND Passed.EmailID=R.Email)
	WHERE ApplyingFor=ISNULL(@ReportType, ApplyingFor) --AND Preference1=ISNULL(@State, Preference1) 
	AND U.FirstName=ISNULL(@Coordinator, U.FirstName)
	ORDER BY ApplyingFor
END

--select top 10 * from registrations where userid='<redacted>'
GO
/****** Object:  StoredProcedure [dbo].[SP_EXPORT_SUMMARY]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_EXPORT_SUMMARY]
(
	@Type varchar(100) = NULL,
	@State varchar(100) = NULL,
	@Agency varchar(100) = NULL,
	@QpCode varchar(100) = NULL
)
AS
BEGIN
	IF @Type IS NULL
		SET @Type = 'ZEDAP' 

	select StateName, FirstName AS AgencyName, QpName AS Curriculum, Count(*) AS Programmes, SUM(NoOfCandidates) Participants, SUM(NoOfCandidates)/Count(*) AS AverageParticipants from 
	(
		SELECT B.BatchNo, U.UserID, U.FirstName, J.QpName, S.StateId, S.StateName, isnull(CC.NoOfCandidates,0) NoOfCandidates
		FROM Batches B
		INNER JOIN Users U ON (B.CenterId=U.UserID)
		INNER JOIN States S ON (B.State=S.StateID)
		INNER JOIN JobRoles J ON (B.QpCode=J.QpCode)
		LEFT JOIN (select BatchNo, Count(*) NoOfCandidates from Candidates group by BatchNo) CC ON (B.BatchNo=CC.BatchNo)
		WHERE ProgramType=@Type 
			AND J.QpCode=ISNULL(@QpCode, J.QpCode) 
			AND S.StateName = ISNULL(@State, S.StateName) 
			AND U.UserID = ISNULL(@Agency, UserID)
	) a
	group by StateId, StateName,FirstName, UserID, QpName
	ORDER BY Programmes DESC
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_ATTENDANCE_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_ATTENDANCE_DETAILS] --'<redacted>'
(
	@BatchNo varchar(50)
)
AS
BEGIN
	select * from (select BatchNo, Year(createdDate) As Year, Month(createdDate) As Month, Day(createdDate) As DayPresent from BatchAttendance where BatchNo=@BatchNo)s
	pivot (max(DayPresent) for DayPresent in ([1], [2], [3], [4], [5],[6], [7], [8], [9], [10],[11], [12], [13], [14], [15],[16], [17], [18], [19], [20], [21], [22], [23], [24], [25], [26], [27], [28], [29], [30], [31] )) pvt 

	--select * from CandidateAttendance where BatchNo=@BatchNo order by [Year] desc, [Month] desc, CandidateId asc
	select CA.*, C.FirstName+' '+ ISNULL(C.LastName,'') AS CandidateName from CandidateAttendance CA INNER JOIN Candidates C ON (CA.CandidateId=C.candidateId) where CA.BatchNo=@BatchNo order by [Year] desc, [Month] desc, CA.CandidateId asc

	select distinct year, month from CandidateAttendance where BatchNo=@BatchNo order by year, month
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_ATTENDANCE_DETAILS_PDF]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_ATTENDANCE_DETAILS_PDF] --'<redacted>'
(
	@BatchNo varchar(50)
)
AS
BEGIN
	DECLARE @query VARCHAR(1000)     
	DECLARE @columns VARCHAR(1000) 
 
	SELECT @columns = COALESCE(@columns + ',[' + convert(varchar,createddate,103) + ']', '[' + convert(varchar,createddate,103)+ ']') 
							 FROM( SELECT distinct createddate from BatchAttendance where batchno=@BatchNo) x            

	SET @query='
	select ROW_NUMBER() OVER(order by FirstName) UAMEM1EM2SSINo,FirstName + ISNULL(LastName,'+char(39)+char(39)+') AS ParticipantName,' + @columns + ' from Candidates C
	LEFT JOIN(
	select * from (
	select CandidateId, convert(varchar,CreatedDate,103) CreatedDate, CAST(IsPresent AS TINYINT) AS IsPresent from BatchAttendance B INNER JOIN Attendance A ON (B.Id=A.BatchAttendanceId) where B.BatchNo='+char(39)+@BatchNo+char(39)+' and InTimeOrOutTime='+char(39)+'In-Time'+char(39)+'
	)s
	pivot (max(IsPresent) for CreatedDate in (' + @columns + ' )) pvt
	) R ON (R.CandidateId=C.CandidateId) where C.BatchNo='+char(39)+@BatchNo+char(39)

	EXECUTE(@query)  

END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_BATCHES_BY_STATUS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_BATCHES_BY_STATUS] --'<redacted>', '<redacted>', '' 
(
	 @ProgramType varchar(50)=NULL,
	 @Status varchar(50)=NULL,
	 @CenterId varchar(100) = NULL
)
AS
BEGIN
	
	IF @CenterId=''
		SET @CenterId=NULL

	declare @myList table (BatchNo varchar(50), NoOfCandidates int)
	declare @myList2 table (BatchNo varchar(50), CumulativeFeedback numeric(36,2))

	insert into @myList
	select B.BatchNo, Count(1) NoOfCandidates from BATCHES B 
	LEFT JOIN States S ON (B.State=S.StateId)
	LEFT JOIN Candidates C ON (B.BatchNo=C.BatchNo) 
	WHERE (@ProgramType IS NULL OR ProgramType = @ProgramType) AND (@Status IS NULL OR B.Status IN (select replace(Data, ' ','') from SplitString(@Status,','))) AND (@CenterId IS NULL OR B.CenterId=@CenterId)
	GROUP BY B.BatchNo 

	insert into @myList2
	select BatchNo, cast((Convert(float,SUM(AnswerId)) / Count(AnswerId)) as numeric(36,2)) CumulativeFeedback from StudentFeedbacks group by BatchNo

	SELECT B.*, Convert(varchar,StartDate,106) AS strStartDate, Convert(varchar,EndDate,106) AS strEndDate, J.QpName, U.FirstName, CumulativeFeedback,
		Convert(varchar,StartDate,112) AS strStartDateFilter, Convert(varchar,EndDate,112) AS strEndDateFilter, S.StateName, CC.NoOfCandidates,
		case WHEN ProgramType='ZEDTP' and getdate() BETWEEN StartDate AND EndDate then 1 else 0 end as ShowExamTime
	FROM Batches B INNER JOIN JobRoles J ON (B.QpCode=J.QpCode)
	LEFT JOIN States S ON (B.State=S.StateId)
	INNER JOIN Users U ON (B.CenterId=U.UserID)
	LEFT JOIN @myList CC ON (B.BatchNo=CC.BatchNo)
	LEFT JOIN @myList2 F ON (B.BatchNo=F.BatchNo)
	WHERE (@ProgramType IS NULL OR ProgramType = @ProgramType) AND (@Status IS NULL OR B.Status IN (select replace(Data, ' ','') from SplitString(@Status,','))) AND (@CenterId IS NULL OR B.CenterId=@CenterId)
	ORDER BY StartDate DESC
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_BATCHES_BY_USER]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_BATCHES_BY_USER]
(
	 @ProgrammeType varchar(50)=NULL,
	 @StateName varchar(100)=NULL,
	 @QpCode varchar(50)=NULL
)
AS
BEGIN
	IF @StateName = 'All'
		SET @StateName = NULL
	IF @QpCode = 'All'
		SET @QpCode = NULL

	declare @myList table (BatchNo varchar(50), NoOfRegistrations int)

	insert into @myList
	select B.BatchNo, Count(1) NoOfRegistrations from BATCHES B 
	LEFT JOIN States S ON (B.State=S.StateId)
	LEFT JOIN Candidates C ON (B.BatchNo=C.BatchNo) 
	WHERE B.Status IN (2, 3, 5) AND (@ProgrammeType IS NULL OR ProgramType = @ProgrammeType) AND (@StateName IS NULL OR StateName=@StateName) AND (@QpCode IS NULL OR B.QpCode=@QpCode)
	GROUP BY B.BatchNo 

	SELECT B.BatchNo, B.VenueLat, B.VenueLong, B.VenueName, B.QpCode,J.QpName, S.StateName, D.DistrictName, Zip, ProgramType, B.Id,
	Convert(varchar, B.StartDate, 103) AS ProgramStartDate, Convert(varchar, B.EndDate, 103) AS ProgramEndDate, C.NoOfRegistrations
	FROM Batches B INNER JOIN JobRoles J ON (B.QpCode=J.QpCode)
	LEFT JOIN States S ON (B.State=S.StateId)
	LEFT JOIN DISTRICTS D ON (B.State=D.StateId AND B.District=D.districtID)
	LEFT JOIN @myList C ON (B.BatchNo=C.BatchNo)
	WHERE Status IN (2, 3, 5) AND (@ProgrammeType IS NULL OR ProgramType = @ProgrammeType) AND (@StateName IS NULL OR StateName=@StateName) AND (@QpCode IS NULL OR B.QpCode=@QpCode)
	ORDER BY StartDate DESC
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_BLOCKED_JOBROLES_BY_PROGRAM_CODE]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_BLOCKED_JOBROLES_BY_PROGRAM_CODE]
(
	@ProgramCode varchar(50)
)
AS
BEGIN
	IF @ProgramCode='Training Programme'
		SELECT * FROM JobRoles where IsActive = 0 AND ProgramCode = 'ZEDTP' ORDER BY QpName
	ELSE IF @ProgramCode='Industry Awareness Programme'
		SELECT * FROM JobRoles where IsActive = 0 AND ProgramCode = 'ZEDAP' ORDER BY QpName
	ELSE
		SELECT * FROM JobRoles where IsActive = 0
	
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_CENTER_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_CENTER_DETAILS] --'<redacted>','<redacted>'
(
	@SDMS_ID varchar(50), @UserId varchar(100)
)
AS
BEGIN
	DECLARE @id int
	SET @id = (select RoleId from Users where UserID=@UserId)

	if @id=3
	BEGIN
		SELECT C.*,S.StateName,D.districtname FROM CENTERS C 
		INNER JOIN STATES S ON (C.StateID=S.StateID) 
		INNER JOIN DISTRICTS D ON (C.StateID=D.StateID AND C.DistrictId=D.districtID) 
		WHERE IsAudited = 0 AND SDMS_ID=@SDMS_ID
	END
	else
	BEGIN
		SELECT C.* FROM CenterInfo C 
		WHERE CenterId=@SDMS_ID
	END
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_CENTER_DETAILS_3]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_CENTER_DETAILS_3] --'<redacted>'
(
	@Id varchar(50)
)
AS
BEGIN
	SELECT C.*, AuditorName AS Auditor, U.FirstName FROM CenterInfo C LEFT JOIN Users U ON (C.AuditorId=U.UserID) WHERE C.CenterId=@Id
	SELECT C.*, AuditorName AS Auditor, U.FirstName FROM CenterInfo_Assessor C LEFT JOIN Users U ON (C.AuditorId=U.UserID) WHERE C.CenterId=@Id
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_CENTER_HISTORY]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_CENTER_HISTORY] --'<redacted>'
(
	@CenterId varchar(50)
)
AS
BEGIN
	select CreatedDate, DeletedDate, UpdatedDate, ApprovedOrRejectedDate, Status from centerinfo where replace(CenterId,'_D','')=@CenterId order by CreatedDate
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_CENTER_STATUS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_CENTER_STATUS] --'<redacted>','<redacted>'
(
	@SDMS_ID varchar(50), @UserId varchar(100)
)
AS
BEGIN
	DECLARE @id int
	DECLARE @RoleId int
	DECLARE @count int
	DECLARE @status int
	DECLARE @audited int
	
	SET @id = (select Id from Users where UserID=@UserId)
	SET @RoleId = (select RoleId from Users where UserID=@UserId)
	if @RoleId = 3
	BEGIN
		SET @count = (select count(*) from CENTERS where SDMS_ID=@SDMS_ID AND CreatedBy=@id)
		SET @audited = (select IsAudited from CENTERS where SDMS_ID=@SDMS_ID AND CreatedBy=@id)
	END
	else
	BEGIN
		SET @count = (select count(*) from CENTERS where IsAudited = 1 AND SDMS_ID=@SDMS_ID)
		SET @audited = (select IsAudited from CENTERS where SDMS_ID=@SDMS_ID)
	END
	
	SELECT @id AS ID,@RoleId AS RoleId,@count AS [Count],@audited AS Audited
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_CERTIFICATE_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_CERTIFICATE_DETAILS] --'<redacted>', '<redacted>'
(
	@BatchNo varchar(50)=NULL,
	@CandidateId varchar(50)=NULL,
	@IssuedOn varchar(50)=NULL
)
AS
BEGIN
	
	DECLARE @QpCode varchar(50) = NULL
	SELECT @QpCode=QpCode from Batches where BatchNo=@BatchNo
	

	IF @IssuedOn IS NULL
		SET @IssuedOn = getdate()

	UPDATE Candidates SET CertificateIssuedOn = @IssuedOn WHERE Id=@CandidateId

	IF @QpCode='ZED/TP24'
	BEGIN
		SELECT QpCode, Id, EmailId, CertificateIssuedOn, StartDate, EndDate, BatchNo, ZedTac, UPPER(ParticipantName) ParticipantName, EmailID, isnull(MScore,0) + W + P AS Score, CertificateNo,CertificateType,UPPER(VenueName) VenueName,UPPER(VenueName2) VenueName2,
		2382 ParticipantNameX, 1406 ParticipantNameY, 456 CertificateIssuedOnX, 2238 CertificateIssuedOnY, 508 CertificateNoX, 2120 CertificateNoY,410 QrCodeX, 1776 QrCodeY,
		2122 StartDateX, 1939 StartDateY, 2480 EndDateX, 1939 EndDateY, 2341 VenueNameX, 2098 VenueNameY, 2341 VenueName2X, 2170 VenueName2Y  --1828
		FROM
		(
			SELECT B.QpCode, C.Id, 
				Convert(varchar, CertificateIssuedOn,103) CertificateIssuedOn,
				Convert(varchar, StartDate,103) StartDate,
				Convert(varchar, EndDate,103) EndDate, 
				B.BatchNo, C.FirstName+' '+ISNULL(C.LastName, '') ParticipantName, C.EmailID, C.CandidateId ZedTac,
				CASE  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP19', 'ZED/TP20') THEN convert(decimal(10,2),M.score / 100.00)
					  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP18') THEN convert(decimal(10,2),M.score / 170.00)
				ELSE NULL END AS MScore, C.W, C.P, 
				--REPLACE(ZedTac,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo
				--REPLACE(C.CandidateId,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo,
				ZEDTAC CertificateNo,
				'Participant' CertificateType,
				replace(venuename,SUBSTRING(substring(venuename,40,len(venuename)), CHARINDEX(',', substring(venuename,40,len(venuename))) +1,len(substring(venuename,40,len(venuename)))),'') VenueName,
				SUBSTRING(substring(venuename,40,len(venuename)), CHARINDEX(',', substring(venuename,40,len(venuename))) +1,len(substring(venuename,40,len(venuename)))) VenueName2
				--substring(venuename,40,len(venuename))
			FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
			LEFT JOIN (SELECT BatchNo, CandidateId, SUM(Rating)*30 AS Score FROM MScores WHERE BatchNo=@BatchNo AND CandidateId=@CandidateId GROUP BY BatchNo, CandidateId) M ON (B.BatchNo=M.BatchNo AND C.CandidateId=M.CandidateId)
			WHERE B.BatchNo=@BatchNo AND C.Id=@CandidateId AND C.W IS NOT NULl AND C.P IS NOT NULL 
		) A
			--and c.emailid not in ('<redacted>')
	END
	
	ELSE
	BEGIN
		SELECT QpCode, Id, EmailId, CertificateIssuedOn, StartDate, EndDate, BatchNo, ZedTac, UPPER(ParticipantName) ParticipantName, EmailID, isnull(MScore,0) + W + P AS Score, CertificateNo,CertificateType,UPPER(VenueName) VenueName,'' VenueName2,
		2328 ParticipantNameX, 1406 ParticipantNameY, 497 CertificateIssuedOnX, 2118 CertificateIssuedOnY, 560 CertificateNoX, 2018 CertificateNoY,410 QrCodeX, 1690 QrCodeY,
		-1000 StartDateX, -1000 StartDateY, -1000 EndDateX, -1000 EndDateY, -1000 VenueNameX, -1000 VenueNameY, -1000 VenueName2X, -1000 VenueName2Y
		FROM
		(
			SELECT B.QpCode, C.Id, 
				Convert(varchar, CertificateIssuedOn,103) CertificateIssuedOn,
				Convert(varchar, StartDate,103) StartDate,
				Convert(varchar, EndDate,103) EndDate, 
				B.BatchNo, C.FirstName+' '+ISNULL(C.LastName, '') ParticipantName, C.EmailID, C.CandidateId ZedTac,
				CASE  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP19', 'ZED/TP20') THEN convert(decimal(10,2),M.score / 100.00)
					  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP18') THEN convert(decimal(10,2),M.score / 170.00)
				ELSE NULL END AS MScore, C.W, C.P, 
				--REPLACE(ZedTac,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo
				--REPLACE(C.CandidateId,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo,
				ZEDTAC CertificateNo,
				case when B.QpCode='ZED/TP18' then 'MasterTrainer'
				when B.QpCode ='ZED/TP19' then 'Assessor'
				when B.QpCode ='ZED/TP20' then 'Consultant'  end as CertificateType, VenueName
			FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
			LEFT JOIN (SELECT BatchNo, CandidateId, SUM(Rating)*30 AS Score FROM MScores WHERE BatchNo=@BatchNo AND CandidateId=@CandidateId GROUP BY BatchNo, CandidateId) M ON (B.BatchNo=M.BatchNo AND C.CandidateId=M.CandidateId)
			WHERE B.BatchNo=@BatchNo AND C.Id=@CandidateId AND C.W IS NOT NULl AND C.P IS NOT NULL 
		
			--and c.emailid not in ('<redacted>')

		) A
	END
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_CERTIFICATE_DETAILS_QRCODE]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_CERTIFICATE_DETAILS_QRCODE]  --'<redacted>'
(
	@CandidateId varchar(50)=NULL
)
AS
BEGIN
		IF @CandidateId LIKE 'P%'
		BEGIN
		SELECT B.BatchNo, QpName, B.VenueName, C.Id, 
				Convert(varchar, CertificateIssuedOn,103) CertificateIssuedOn,
				Convert(varchar, StartDate,103) StartDate,
				Convert(varchar, EndDate,103) EndDate,
				Convert(varchar, StartDate,103) StartDate,
				Convert(varchar, EndDate,103) EndDate,
				UPPER(C.FirstName+' '+ISNULL(C.LastName, '')) ParticipantName, 
				--REPLACE(ZedTac,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo,
				ZEDTAC CertificateNo,
				C.CandidateId ZedTac,
				--CONCAT('<redacted>',B.BatchNo,'<redacted>',replace(@CandidateId,'<redacted>',''),'<redacted>') PhotoPath,
				CONCAT('https://training.zed.org.in/professional/',P.PhotoPath) PhotoPath,
				CASE WHEN B.QpCode='ZED/TP20' THEN 'ZED Facilitator' ELSE 'ZED Bronze Assessor' END AS Designation,
				----CASE WHEN DATEDIFF(year, C.CertificateIssuedOn, GETDATE()) >= 1 THEN '<redacted>' ELSE '<redacted>' END AS CertificateStatus 
				CASE WHEN C.CertificateIssuedOn <= DATEADD(MONTH, -12, GETDATE()) THEN 'Expired' ELSE 'Active' END AS CertificateStatus 
				-- WHEN C.IsActive = 1 THEN '<redacted>' WHEN C.IsActive = 0 THEN '<redacted>' END AS CertificateStatus 

			FROM ZED_CENTER_AUDIT_PROFESSIONAL.DBO.Batches B 
			INNER JOIN ZED_CENTER_AUDIT_PROFESSIONAL.DBO.Candidates C ON (B.BatchNo=C.BatchNo)
			INNER JOIN ZED_CENTER_AUDIT_PROFESSIONAL.DBO.JobRoles J ON (B.QpCode=J.QpCode)
			INNER JOIN (SELECT TOP 1 Id,BatchNo,CandidateId,PhotoPath,CreatedDate from ZED_CENTER_AUDIT_PROFESSIONAL.DBO.SelfiePhotos where CandidateId=REPLACE(@CandidateId,'P','') ORDER BY ID DESC) P ON (C.BatchNo=P.BatchNo)
			WHERE C.Id=REPLACE(@CandidateId,'P','')

		END

		ELSE IF @CandidateId LIKE 'Q%'
		BEGIN
		SELECT B.BatchNo, QpName, B.VenueName, C.Id, 
				Convert(varchar, CertificateIssuedOn,103) CertificateIssuedOn,
				Convert(varchar, StartDate,103) StartDate,
				Convert(varchar, EndDate,103) EndDate,
				Convert(varchar, StartDate,103) StartDate,
				Convert(varchar, EndDate,103) EndDate,
				UPPER(C.FirstName+' '+ISNULL(C.LastName, '')) ParticipantName, 
				--REPLACE(ZedTac,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo,
				ZEDTAC CertificateNo,
				C.CandidateId ZedTac,
				--CONCAT('<redacted>',B.BatchNo,'<redacted>',replace(@CandidateId,'<redacted>',''),'<redacted>') PhotoPath,
				CONCAT('https://training.zed.org.in/qualityprofessional/',P.PhotoPath) PhotoPath,
				CASE WHEN B.QpCode='ZED/TP20' THEN 'Quality Management Professional' ELSE 'ZED Bronze Assessor' END AS Designation,
				----CASE WHEN DATEDIFF(year, C.CertificateIssuedOn, GETDATE()) >= 1 THEN '<redacted>' ELSE '<redacted>' END AS CertificateStatus 
				CASE WHEN C.CertificateIssuedOn <= DATEADD(MONTH, -12, GETDATE()) THEN 'Expired' ELSE 'Active' END AS CertificateStatus 
				-- WHEN C.IsActive = 1 THEN '<redacted>' WHEN C.IsActive = 0 THEN '<redacted>' END AS CertificateStatus 

			FROM ZED_QUALITY_PROFESSIONAL.DBO.Batches B 
			INNER JOIN ZED_QUALITY_PROFESSIONAL.DBO.Candidates C ON (B.BatchNo=C.BatchNo)
			INNER JOIN ZED_QUALITY_PROFESSIONAL.DBO.JobRoles J ON (B.QpCode=J.QpCode)
			LEFT JOIN (SELECT TOP 1 Id,BatchNo,CandidateId,PhotoPath,CreatedDate from ZED_QUALITY_PROFESSIONAL.DBO.SelfiePhotos where CandidateId=REPLACE(@CandidateId,'Q','') ORDER BY ID DESC) P ON (C.BatchNo=P.BatchNo)
			WHERE C.Id=REPLACE(@CandidateId,'Q','')

		END

		ELSE
		BEGIN
			SELECT B.BatchNo, QpName, B.VenueName, C.Id, 
				Convert(varchar, CertificateIssuedOn,103) CertificateIssuedOn,
				Convert(varchar, StartDate,103) StartDate,
				Convert(varchar, EndDate,103) EndDate,
				Convert(varchar, StartDate,103) StartDate,
				Convert(varchar, EndDate,103) EndDate,
				UPPER(C.FirstName+' '+ISNULL(C.LastName, '')) ParticipantName, 
				--REPLACE(ZedTac,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo,
				ZEDTAC CertificateNo,
				C.CandidateId ZedTac,
				CONCAT('https://training.zed.org.in/Photos/Biometric/',B.BatchNo,'/',@CandidateId,'.jpg') PhotoPath,
				'' Designation, '' CertificateStatus

			FROM Batches B 
			INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
			INNER JOIN JobRoles J ON (B.QpCode=J.QpCode)
			WHERE C.Id=@CandidateId
		END
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_CERTIFICATES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_CERTIFICATES]
AS
BEGIN
	--select B.BatchNo ProgrammeID, J.QpName TypeOfProgramme, Convert(varchar,StartDate, 106)+'<redacted>' + Convert(varchar,EndDate, 106) ConductedOn,B.VenueName Venue
	--from Batches B 
	--INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) 
	--where B.QpCode IN ('<redacted>','<redacted>','<redacted>') 
	--AND BatchNo in (select batchno from ZedTac where convert(date,createddate)>='<redacted>' 
	--    and convert(date,createddate)<='<redacted>') and venuename not like '<redacted>'  

	--ORDER BY EndDate desc

	select B.BatchNo ProgrammeID, J.QpName TypeOfProgramme, Convert(varchar,StartDate, 106)+' - ' + Convert(varchar,EndDate, 106) ConductedOn,B.VenueName Venue
	from Batches B 
	INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) 
	where B.QpCode IN ('ZED/TP18','ZED/TP19','ZED/TP20','ZED/TP24') 
	and B.Status=3
	and venuename not like '%test%'  

	ORDER BY EndDate desc

END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_DISTRICTS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_DISTRICTS]
(
	@StateID int
)
AS
BEGIN
	SELECT * FROM Districts WHERE StateID=@StateID ORDER BY districtname
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_FEEDBACKS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_FEEDBACKS] --'<redacted>'
(
	@BatchNo varchar(50) = NULL
)
AS
BEGIN
	SELECT C.CandidateId, C.FirstName, C.LastName ,F.* 
	FROM TacStudentFeedback F 
	INNER JOIN Candidates C ON (F.BatchNo=C.batchNo AND F.UserId=C.EmailId) 
	WHERE F.batchno=@BatchNo 
	ORDER BY CandidateId

	SELECT distinct F.TrainerId, F.TrainerName 
	FROM TacTrainersFeedback F 
	WHERE F.batchno=@BatchNo 

	SELECT C.CandidateId, C.FirstName, C.LastName ,F.* 
	FROM TacTrainersFeedback F 
	INNER JOIN Candidates C ON (F.BatchNo=C.batchNo AND F.UserId=C.EmailId) 
	WHERE F.batchno=@BatchNo 
	ORDER BY TrainerId, CandidateId

	select * from MScores where batchno=@BatchNo

	SELECT * FROM
	(SELECT distinct C.FirstName, C.LastName, F.CandidateId, Suggestions, ThreeComments, 'Q'+F.QuestionId QuestionId, F.AnswerId FROM studentFeedbacks F INNER JOIN Candidates C ON (F.CandidateId=C.CandidateId) where F.BatchNo = @BatchNo ) AS SourceTable
	PIVOT
	(
	MAX(AnswerId)
	FOR QuestionId IN (Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20)
	) AS PivotTable;

	SELECT distinct 'Q.'+F.QuestionText QuestionText, Convert(int,QuestionId) FROM studentFeedbacks F where F.BatchNo = @BatchNo ORDER BY Convert(int,QuestionId) 


	-- TAC Observants List
	SELECT distinct F.ObservantId, F.ObservantName 
	FROM TacObservantsFeedback F 
	WHERE F.batchno=@BatchNo 

	-- TAC Observants Feedbacks
	SELECT C.CandidateId, C.FirstName, C.LastName, F.* 
	FROM TacObservantsFeedback F 
	INNER JOIN Candidates C ON (F.BatchNo=C.batchNo AND F.UserId=C.EmailId)
	WHERE F.batchno=@BatchNo 
	ORDER BY ObservantId, CandidateId
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_FEEDBACKS_PDF]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_FEEDBACKS_PDF] --'<redacted>'
(
	@BatchNo varchar(50)
)
AS
BEGIN
	select * from TacStudentFeedback where BatchNo=@BatchNo
	select T.TrainerName, F.* from TacTrainersFeedback F INNER JOIN TrainerInformation T ON (F.TrainerId=T.Id)  where BatchNo=@BatchNo 

END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_IA_USER]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_IA_USER]
AS
BEGIN
	SELECT ROW_NUMBER() OVER(ORDER BY FirstName) AS SNO, Id, FirstName, email, UserID FROM Users WHERE Roleid=3 and ProgrammeType='Training Programme' AND IsActive=1
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_JOBROLES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_JOBROLES]
AS
BEGIN
	SELECT * FROM JobRoles where IsActive = 1 ORDER BY Id
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_JOBROLES_BY_PROGRAM_CODE]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_JOBROLES_BY_PROGRAM_CODE]
(
	@ProgramCode varchar(50)=NULL,
	@IsGoogleMapFilter bit = NULL
)
AS
BEGIN
	IF @ProgramCode='Training Programme'
		SELECT * FROM JobRoles where (@IsGoogleMapFilter IS NOT NULL OR IsActive = 1) AND ProgramCode = 'ZEDTP' ORDER BY QpName
	ELSE IF @ProgramCode='Industry Awareness Programme'
		SELECT * FROM JobRoles where (@IsGoogleMapFilter IS NOT NULL OR IsActive = 1) AND ProgramCode = 'ZEDAP' ORDER BY QpName
	ELSE
		SELECT * FROM JobRoles where @IsGoogleMapFilter IS NOT NULL OR IsActive = 1
	
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_MONITORING_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_MONITORING_DETAILS] --'<redacted>'
(
	@BatchNo varchar(50)
)
AS
BEGIN
	select C.BatchNo,B.QpCode,NosId,PcId,C.TrainerId,Lattitude,Longitude,C.Comments,
	Convert(varchar,C.CreatedDate,106) AS CreatedDate, C.CreatedDate as CreatedDate1,PhotoPath,CapturedTime,
	J.QpName,N.NosName,PC.PcName,T.TrainerName,C.SmeId,SME.Name SmeName, O.ObservantName, O.Id ObservantId
	FROM CenterMonitoring C 
	INNER JOIN Batches B ON (C.BatchNo=B.BatchNo)
	INNER JOIN MonitoringPhotos P ON (C.Id=P.MonitoringId) 
	INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) 
	LEFT JOIN NosDetails N ON (B.QpCode=N.QpCode AND C.NosId=N.NosCode) 
	LEFT JOIN PcDetails PC ON (B.QpCode=PC.QpCode AND C.PcId=PC.PcCode AND C.NosId=PC.NosCode) 
	LEFT JOIN TrainerInformation T ON (C.TrainerId=T.Id) 
	LEFT JOIN ZedFacultyOrSME SME ON (C.SmeId=SME.Id) 
	LEFT JOIN ObservantInformation O ON (O.Id=C.ObservantId) 
	where C.[BatchNo]=@BatchNo
	ORDER BY CreatedDate1 desc

	--select CreatedDate AS CreatedDate1,Convert(varchar,CreatedDate,106) AS CreatedDate, 
	--max([11]) AS NOS_1, max([12]) AS NOS_2, max([13]) AS NOS_3, max([14]) AS NOS_4, max([15]) AS NOS_5,
	--max([1]) AS PC_1, max([2]) AS PC_2, max([3]) AS PC_3, max([4]) AS PC_4, max([5]) AS PC_5,
	--max([21]) AS PATH_1, max([22]) AS PATH_2, max([23]) AS PATH_3, max([24]) AS PATH_4, max([25]) AS PATH_5,
	--max([31]) AS TS_1, max([32]) AS TS_2, max([33]) AS TS_3, max([34]) AS TS_4, max([35]) AS TS_5 from 
	--(select * from
	--(
	--  select C.BatchNo,NosId,PcId,CAST(CreatedDate AS DATE) AS CreatedDate,PhotoPath,CapturedTime
	--	  ,row_number() over (partition by CAST(CreatedDate AS DATE) order by CreatedDate) RN_PC
	--	  ,10+row_number() over (partition by CAST(CreatedDate AS DATE) order by CreatedDate) RN_NOS
	--	  ,20+row_number() over (partition by CAST(CreatedDate AS DATE) order by CreatedDate) RN_PATH
	--	  ,30+row_number() over (partition by CAST(CreatedDate AS DATE) order by CreatedDate) RN_TS
	--  from CenterMonitoring C INNER JOIN MonitoringPhotos P ON (C.Id=P.MonitoringId) where C.[BatchNo]=@BatchNo
	--) s
	--pivot (min(NosId) for RN_NOS in ([11], [12], [13], [14], [15])) pvt
	--pivot (min(PcId) for RN_PC in ([1], [2], [3], [4], [5])) pvt
	--pivot (min(PhotoPath) for RN_PATH in ([21], [22], [23], [24], [25])) pvt
	--pivot (min(CapturedTime) for RN_TS in ([31], [32], [33], [34], [35])) pvt) p
	--group by CreatedDate order by CreatedDate1 desc
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_MONITORING_FULL_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_MONITORING_FULL_DETAILS] --'<redacted>',2016,6,9
(
	@BatchNo varchar(50),
	@Year int,
	@Month int,
	@Day int
)
AS
BEGIN
	-- InTime OutTime
	select B.BatchNo,convert(varchar, I.CreatedTime,100) AS InTime,convert(varchar, O.CreatedTime,100) AS OutTime from 
	(select @BatchNo AS BatchNo) B
	LEFT JOIN BatchAttendance I ON (B.BatchNo=I.BatchNo AND I.InTimeOrOutTime='In-Time' AND YEAR(I.CreatedDate)=@Year AND MONTH(I.CreatedDate)=@Month AND DAY(I.CreatedDate)=@Day)
	LEFT JOIN BatchAttendance O ON (B.BatchNo=O.BatchNo AND O.InTimeOrOutTime='Out-Time' AND YEAR(O.CreatedDate)=@Year AND MONTH(O.CreatedDate)=@Month AND DAY(O.CreatedDate)=@Day)

	-- Attendance
	SELECT C.CandidateId, C.FirstName+' ' + C.LastName AS CandidateName,A.Year,A.Month,
	CASE
		WHEN @Day=1 THEN A.Day1
		WHEN @Day=2 THEN A.Day2
		WHEN @Day=3 THEN A.Day3
		WHEN @Day=4 THEN A.Day4
		WHEN @Day=5 THEN A.Day5
		WHEN @Day=6 THEN A.Day6
		WHEN @Day=7 THEN A.Day7
		WHEN @Day=8 THEN A.Day8
		WHEN @Day=9 THEN A.Day9
		WHEN @Day=10 THEN A.Day10
		WHEN @Day=11 THEN A.Day11
		WHEN @Day=12 THEN A.Day12
		WHEN @Day=13 THEN A.Day13
		WHEN @Day=14 THEN A.Day14
		WHEN @Day=15 THEN A.Day15
		WHEN @Day=16 THEN A.Day16
		WHEN @Day=17 THEN A.Day17
		WHEN @Day=18 THEN A.Day18
		WHEN @Day=19 THEN A.Day19
		WHEN @Day=20 THEN A.Day20
		WHEN @Day=21 THEN A.Day21
		WHEN @Day=22 THEN A.Day22
		WHEN @Day=23 THEN A.Day23
		WHEN @Day=24 THEN A.Day24
		WHEN @Day=25 THEN A.Day25
		WHEN @Day=26 THEN A.Day26
		WHEN @Day=27 THEN A.Day27
		WHEN @Day=28 THEN A.Day28
		WHEN @Day=29 THEN A.Day29
		WHEN @Day=30 THEN A.Day30
		WHEN @Day=31 THEN A.Day31
	END AS InTime,
	CASE
		WHEN @Day=1 THEN B.Day1
		WHEN @Day=2 THEN B.Day2
		WHEN @Day=3 THEN B.Day3
		WHEN @Day=4 THEN B.Day4
		WHEN @Day=5 THEN B.Day5
		WHEN @Day=6 THEN B.Day6
		WHEN @Day=7 THEN B.Day7
		WHEN @Day=8 THEN B.Day8
		WHEN @Day=9 THEN B.Day9
		WHEN @Day=10 THEN B.Day10
		WHEN @Day=11 THEN B.Day11
		WHEN @Day=12 THEN B.Day12
		WHEN @Day=13 THEN B.Day13
		WHEN @Day=14 THEN B.Day14
		WHEN @Day=15 THEN B.Day15
		WHEN @Day=16 THEN B.Day16
		WHEN @Day=17 THEN B.Day17
		WHEN @Day=18 THEN B.Day18
		WHEN @Day=19 THEN B.Day19
		WHEN @Day=20 THEN B.Day20
		WHEN @Day=21 THEN B.Day21
		WHEN @Day=22 THEN B.Day22
		WHEN @Day=23 THEN B.Day23
		WHEN @Day=24 THEN B.Day24
		WHEN @Day=25 THEN B.Day25
		WHEN @Day=26 THEN B.Day26
		WHEN @Day=27 THEN B.Day27
		WHEN @Day=28 THEN B.Day28
		WHEN @Day=29 THEN B.Day29
		WHEN @Day=30 THEN B.Day30
		WHEN @Day=31 THEN B.Day31
	END AS OutTime
	FROM  Candidates C
	LEFT JOIN CandidateAttendance A ON (A.CandidateId=C.CandidateId AND A.Year=@Year AND A.Month=@Month)
	LEFT JOIN CandidateAttendanceOut B ON (B.CandidateId=C.CandidateId AND B.Year=@Year AND B.Month=@Month)
	WHERE C.BatchNo=@BatchNo

	-- Monitoring
	select C.BatchNo,B.QpCode,NosId,PcId,C.TrainerId,Lattitude,Longitude,Comments,
	Convert(varchar,C.CreatedDate,106) AS CreatedDate, C.CreatedDate as CreatedDate1,PhotoPath,CapturedTime,
	J.QpName,N.NosName,PC.PcName,T.TrainerName
	FROM CenterMonitoring C 
	INNER JOIN Batches B ON (C.BatchNo=B.BatchNo)
	INNER JOIN MonitoringPhotos P ON (C.Id=P.MonitoringId) 
	INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) 
	LEFT JOIN NosDetails N ON (B.QpCode=N.QpCode AND C.NosId=N.NosCode) 
	LEFT JOIN PcDetails PC ON (B.QpCode=PC.QpCode AND C.PcId=PC.PcCode AND C.NosId=PC.NosCode) 
	LEFT JOIN TrainerInformation T ON (C.TrainerId=T.Id) 
	where C.[BatchNo]=@BatchNo AND YEAR(C.CreatedDate)=@Year AND MONTH(C.CreatedDate)=@Month AND DAY(C.CreatedDate)=@Day
	ORDER BY CreatedDate1 desc
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_OBSERVANT_EMAIL_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_OBSERVANT_EMAIL_DETAILS] --12, '<redacted>'
(
	@Id varchar(50)=NULL,
	@BatchNo varchar(50)=NULL
)
AS
BEGIN
	SELECT Id, CenterId, ObservantId, ObservantName, FirstName, LastName, EmailId, MobileNo, AadhaarNo, ZedTacId, W, M, P, RegistrationId, 
		TrainingType, State, District, CreatedDate, IsActive, QpCode, BatchNo, ObservantBatchNo, ObservantWScore, 
		Convert(varchar, ScheduledDate, 106) ScheduledDate, UPPER(ScheduledTime) ScheduledTime, Topic, Observer, ObserverEmail
	FROM ObservantInformation WHERE ObservantBatchNo=@BatchNo AND Id=@Id
		
	select BatchNo, QpName, B.CenterId, B.VenueName, T.TrainerName LeadTrainer, T.EMailId LeadTrainerEmail,
		U.FirstName Coordinator, NULL CoordinatorEmail, B.Coordinator CoordinatorEmail1, U.phoneno CoordinatorMobile,
		CASE WHEN B.QpCode = 'ZED/TP14' THEN 'Master Trainer'
			WHEN B.QpCode = 'ZED/TP15' THEN 'Assessor'
			WHEN B.QpCode = 'ZED/TP16' THEN 'Consultant'
		END AS TrainingType
	 from batches B
	 LEFT JOIN Users U ON (B.Coordinator=U.UserID)
	 LEFT JOIN TrainerInformation T ON (B.LeadTrainer=T.Id)
	 LEFT JOIN JobRoles J ON (J.QpCode=B.QpCode)
	 where batchno=@BatchNo
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_OBSERVANTS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_OBSERVANTS]
AS
BEGIN
	SELECT O.*, convert(decimal(10,2),M.score / 170.00) ObservantMScore FROM ObservantInformation O
	LEFT JOIN (SELECT BatchNo, ObservantId, SUM(Rating)*100 AS Score FROM MScores WHERE ObservantId IS NOT NULL GROUP BY BatchNo, ObservantId) M ON (M.ObservantId=O.Id) 
	WHERE ObservantBatchNo IS NULL 
	ORDER By TrainingType, ObservantName

	SELECT O.*, convert(decimal(10,2),M.score / 170.00) ObservantMScore, FS.FeedbackScore, convert(decimal(10,2),(M.score / 170.00 + FS.FeedbackScore) / 2) TotalScore, F.ObservantId FeedbackObservantId FROM ObservantInformation  O
	LEFT JOIN (SELECT BatchNo, ObservantId, SUM(Rating)*100 AS Score FROM MScores WHERE ObservantId IS NOT NULL GROUP BY BatchNo, ObservantId) M ON (M.ObservantId=O.Id) 
	LEFT JOIN (SELECT distinct ObservantId FROM TacObservantsFeedback WHERE ObservantId IS NOT NULL) F ON (F.ObservantId=O.Id) 
	LEFT JOIN (select ObservantId, convert(decimal(10,2),(avg(AbilityToExplainZEDConcepts*1.00) + avg(PresentationSkills*1.00) + avg(AbleToResolveQueries*1.00) + avg(SupportingThroughCaseStudies*1.00) + avg(RecommendAsAFaculty*1.00))*4) FeedbackScore from TacObservantsFeedback  group by ObservantId) FS ON (FS.ObservantId=O.Id) 
	WHERE ObservantBatchNo IS NOT NULL 
	ORDER By TrainingType, ObservantName

	SELECT *, convert(varchar,StartDate,103) ProgrammeStartDate FROM Batches 
	WHERE (StartDate>=convert(date, getdate()) OR Status=1) AND QpCode IN ('ZED/TP14','ZED/TP15','ZED/TP16')
	ORDER By BatchNo

	SELECT CandidateId, FirstName, LastName, ObservantId, AbilityToExplainZEDConcepts, PresentationSkills, AbleToResolveQueries, SupportingThroughCaseStudies, RecommendAsAFaculty, ReceivedFeedback
	FROM TacObservantsFeedback F 
	INNER JOIN Candidates C ON (F.BatchNo=C.batchNo AND F.UserId=C.EmailId)
	ORDER BY ObservantId, CandidateId

	select * from MScores where ObservantId IS NOT NULL
END
GO
/****** Object:  StoredProcedure [dbo].[SP_GET_PARTICIPANTS_WITH_MARKS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_PARTICIPANTS_WITH_MARKS]
(
	@BatchNo varchar(20)
)
AS
BEGIN
	SELECT ProgrammeID, CandidateId, FirstName, LastName,UAMEEM2SSINo, AdhaarNo, C.MobileNo,EmailId, OrganizationName, Sector,
		M, W, P, ISNULL(M,0) + ISNULL(W,0) + ISNULL(P,0) Total, 
		CASE WHEN ISNULL(M,0) + ISNULL(W,0) + ISNULL(P,0) >= 60.00 THEN 'Pass' ELSE 'Fail' END AS Status
	FROM
	(
		SELECT B.BatchNo ProgrammeID, C.CandidateId, FirstName, LastName,UAMEM1EM2SSINo UAMEEM2SSINo, AdhaarNo, C.MobileNo,EmailId, OrganizationName, Sector,
		CASE  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP15', 'ZED/TP16') THEN convert(decimal(10,2),M.score / 100.00)
			  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP14') THEN convert(decimal(10,2),M.score / 170.00)
		ELSE NULL END AS M, W, P
		FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
		LEFT JOIN (SELECT BatchNo, CandidateId, SUM(Rating)*30 AS Score FROM MScores WHERE BatchNo=@BatchNo GROUP BY BatchNo, CandidateId) M ON (B.BatchNo=M.BatchNo AND C.CandidateId=M.CandidateId)
		LEFT JOIN (SELECT * FROM ZedTac WHERE BatchNo=@BatchNo and ExamType='Final') ZT ON (B.BatchNo=ZT.BatchNo AND C.EmailId=ZT.UserId)
		LEFT JOIN (select distinct UserId, BatchNo from TacStudentFeedback where BatchNo=@BatchNo) FB ON (C.EmailId=FB.UserId AND FB.BatchNo=C.BatchNo)
		WHERE B.BatchNo=@BatchNo
	) C
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_QUALIFYING_PARTICIPANTS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_QUALIFYING_PARTICIPANTS] --'<redacted>'
(
	@BatchNo varchar(50)=NULL
)
AS
BEGIN
	SELECT Id, CertificateIssuedOn, BatchNo, ZedTac, ParticipantName, EmailID, isnull(MScore,0) + W + P AS Score, CertificateNo FROM
	(
		SELECT C.Id, Convert(varchar, CertificateIssuedOn,106) CertificateIssuedOn, B.BatchNo, C.FirstName+' '+ISNULL(C.LastName, '') ParticipantName, C.EmailID, C.CandidateId ZedTac,
			CASE  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP19', 'ZED/TP20') THEN convert(decimal(10,2),M.score / 100.00)
				  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP18') THEN convert(decimal(10,2),M.score / 170.00)
			ELSE NULL END AS MScore, C.W, C.P, 
			--REPLACE(ZedTac,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo
			--REPLACE(C.CandidateId,'<redacted>','') + RIGHT('<redacted>'+REPLACE(B.BatchNo,'<redacted>',''),4) CertificateNo
			Zedtac CertificateNo
		FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
		LEFT JOIN (SELECT BatchNo, CandidateId, SUM(Rating)*30 AS Score FROM MScores GROUP BY BatchNo, CandidateId) M ON (B.BatchNo=M.BatchNo AND C.CandidateId=M.CandidateId)
		WHERE B.BatchNo=@BatchNo AND C.W IS NOT NULL AND C.P IS NOT NULL --and c.emailid not in ('<redacted>')
	) A
	  WHERE isnull(W,0)>= 42.00 AND isnull(P,0)>= 28.00
	--WHERE isnull(MScore,0) + W + P >= 60.00

	--select  * from candidates
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_REMARKS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_REMARKS]
AS
BEGIN
	SELECT * FROM Remarks where IsActive = 1 ORDER BY Remark
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_REPORT]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_REPORT]
AS
BEGIN
	select [CenterId]
	  ,convert(varchar,CreatedDate,106) as InspectioDate
	  ,[TrainingProviderName]
      ,[CenterName]
	  ,[State]
	  ,[District]
	  ,[BusinessType]
      ,[AuditorName]
	  ,replace([CenterRemarks],'
',' ') as InspectioRemarks
	  ,case 
		when [Status]=0 then 'Pending Final Stage'
		when [Status]=1 then 'Approved'
		when [Status]=2 then 'Rejected'
		when [Status]=3 then 'Provisionally Approved'
		when [Status]=4 then 'Pending Quality Check'
	   end as Status
 from centerinfo where status!=5 and MONTH(CreatedDate) in (7,8)
 order by CreatedDate
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_RESULTS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_RESULTS]
AS
BEGIN
	select B.BatchNo ProgrammeID, J.QpName TypeOfProgramme, Convert(varchar,StartDate, 106)+' - ' + Convert(varchar,EndDate, 106) ConductedOn,B.VenueName Venue
	from Batches B 
	INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) 
	--where B.Status in (3) AND B.QpCode IN ('<redacted>','<redacted>','<redacted>')
	where B.QpCode IN ('ZED/TP18','ZED/TP19','ZED/TP20') 
	and B.Status=3
	--AND BatchNo in (select batchno from ZedTac where convert(date,createddate)>='<redacted>' 
	  --  and convert(date,createddate)<='<redacted>') and venuename not like '<redacted>'  

	ORDER BY EndDate desc

	--select B.BatchNo, C.FirstName+'<redacted>'+C.LastName ParticipantName, C.EmailID 
	--from Batches B
	--INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo) 
	--INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) 
	--where B.Status in (3) AND B.QpCode IN ('<redacted>','<redacted>','<redacted>')
	--ORDER BY ParticipantName

	SELECT BatchNo,  ZedTac, UPPER(ParticipantName) ParticipantName, EmailID, isnull(MScore,0) + W + P AS Score FROM
	(
		SELECT B.BatchNo, C.FirstName+' '+ISNULL(C.LastName, '') ParticipantName, C.EmailID, C.CandidateId ZedTac,
			CASE  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP19', 'ZED/TP20') THEN convert(decimal(10,2),M.score / 100.00)
				  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP18') THEN convert(decimal(10,2),M.score / 170.00)
			ELSE NULL END AS MScore, C.W, C.P
		FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
		LEFT JOIN (SELECT BatchNo, CandidateId, SUM(Rating)*30 AS Score FROM MScores GROUP BY BatchNo, CandidateId) M ON (B.BatchNo=M.BatchNo AND C.CandidateId=M.CandidateId)
		WHERE B.QpCode in ('ZED/TP18', 'ZED/TP19', 'ZED/TP20') AND C.W IS NOT NULl AND C.P IS NOT NULL --and c.emailid not in ('<redacted>')
	) A

	WHERE isnull(W,0)>= 42.00 AND isnull(P,0)>= 28.00
	--WHERE isnull(MScore,0) + W + P >= 60.00
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_ROLES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_ROLES]
AS
BEGIN
	SELECT * FROM Roles where IsActive = 1 ORDER BY RoleId
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_SITE_VENUE_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_SITE_VENUE_DETAILS] --'<redacted>'
(
	@BatchNo varchar(50)
)
AS
BEGIN

	--Venue Details
	Select B.BatchNo,B.VenueName,B.zip,J.QpName,U.phoneno, U1.FirstName Agency, U.email,U.firstname,S.StateName,D.districtname,J.QpName,J.QpCode,
	Convert(varchar,B.StartDate,106) AS StartDate, Convert(varchar,B.EndDate,106) AS EndDate, VenueLat, VenueLong from Batches B
	LEFT JOIN JobRoles J ON(B.QpCode = J.QpCode)
	LEFT JOIN Users U ON(B.Coordinator = U.UserId)
	LEFT JOIN Users U1 ON(B.CenterId= U1.UserID)
	LEFT JOIN States S ON (B.State=S.StateID)
	LEFT JOIN DISTRICTS D ON (B.State=D.stateid AND B.District=D.districtID)
	WHERE BatchNo = @BatchNo

	--Venue Details
	SELECT B.Address batchAddress, B.City batchCity, B.District batchDistrict, B.State batchState, B.Zip batchZip, B.Constituency batchConstituency,
	B.ApprovedDate,B.CenterId, B.Coordinator, B.CreatedDate, B.MobileNo batchMobileNo, B.VenueName, B.CenterManager, B.Email, B.Landmark, C.*
	FROM Batches B LEFT JOIN Candidates C ON (B.BatchNo=C.BatchNo)
	WHERE B.BatchNo=@BatchNo

	--Venue Photos
	SELECT * FROM Photos WHERE AdminInfraId=@BatchNo

	-- Trainers
	SELECT T.*, Convert(varchar,T.CreatedDate,106) AS AddedOn FROM TrainerInformation T
	WHERE Id IN (SELECT distinct TrainerId FROM CenterMonitoring WHERE BatchNo=@BatchNo)

END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_STATES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_STATES]
AS
BEGIN
	SELECT * FROM States ORDER BY StateName
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_USER_JOBROLES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_USER_JOBROLES]
(
	@ID bigint
)
AS
BEGIN
	SELECT ROW_NUMBER() OVER(ORDER BY J.QpName) AS Id, J.QpCode, J.QpName FROM UserJobRoles U INNER JOIN JobRoles J ON (U.QPID=J.QpCode) WHERE U.UserId=@Id ORDER BY J.QpName
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_USERS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_USERS]
(@RoleId Int)
AS
BEGIN
	SELECT U.*,S.StateName,D.districtname FROM Users U 
	INNER JOIN STATES S ON (U.StateID=S.StateID) 
	INNER JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
	WHERE RoleId = @RoleId
END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_USERS_BY_ID]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_USERS_BY_ID]
(@UserId varchar(100))
AS
BEGIN
	SELECT U.*, U.StateID AS StateName, U.DistrictId AS districtname FROM Users U 
	INNER JOIN STATES S ON (U.StateID=S.StateID) 
	LEFT JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
	WHERE UserID = @UserId

END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_USERS_BY_STATUS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_USERS_BY_STATUS]
(@RoleId Int, @IsActive bit, @CreatedBy varchar(100))
AS
BEGIN
	IF @CreatedBy IS NULL
	BEGIN
		SELECT U.*,S.StateName,D.districtname FROM Users U 
		INNER JOIN STATES S ON (U.StateID=S.StateID) 
		LEFT JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
		WHERE RoleId = @RoleId AND U.IsActive=@IsActive
	END
	ELSE
		BEGIN
		SELECT U.*,S.StateName,D.districtname FROM Users U 
		INNER JOIN STATES S ON (U.StateID=S.StateID) 
		LEFT JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
		WHERE RoleId = @RoleId AND U.IsActive=@IsActive AND CreatedBy=@CreatedBy
	END

END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_USERS_BY_STATUS_EXPORT]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_USERS_BY_STATUS_EXPORT]
(@RoleId Int, @IsActive bit, @CreatedBy varchar(100))
AS
BEGIN
	IF @CreatedBy IS NULL
	BEGIN
		SELECT U.FirstName AgencyName, U.address OfficeAddress, S.StateName State, D.districtname District, U.PinCode, U.ProgrammeType, U.SpocName AuthorizedPersonName, U.phoneno MobileNo, U.email EmailID, U.AdhaarNo FROM Users U 
		INNER JOIN STATES S ON (U.StateID=S.StateID) 
		INNER JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
		WHERE RoleId = @RoleId AND U.IsActive=@IsActive
		ORDER BY U.FirstName
	END
	ELSE
		BEGIN
		SELECT U.FirstName Name, S.StateName State, D.districtname District, U.address Address, U.PinCode, U.phoneno MobileNo, U.email EmailID, U.AdhaarNo FROM Users U 
		INNER JOIN STATES S ON (U.StateID=S.StateID) 
		INNER JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
		WHERE RoleId = @RoleId AND U.IsActive=@IsActive AND CreatedBy=@CreatedBy
		ORDER BY U.FirstName
	END

END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_USERS_BY_USER_TYPE]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_USERS_BY_USER_TYPE]
(@RoleId Int, @UserId Int, @IsActive bit, @CreatedBy varchar(100))
AS
BEGIN
	DECLARE @Type varchar(50) = 'Training Programme'
	IF @CreatedBy IS NULL
	BEGIN
		IF @UserId = 1
		BEGIN
			SELECT U.*,S.StateName,D.districtname FROM Users U 
			INNER JOIN STATES S ON (U.StateID=S.StateID) 
			LEFT JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
			WHERE RoleId = @RoleId AND U.IsActive=@IsActive
		END
		ELSE
		BEGIN
			SELECT @Type = ProgrammeType FROM Users WHERE Id=@UserId
			SELECT U.*,S.StateName,D.districtname FROM Users U 
			INNER JOIN STATES S ON (U.StateID=S.StateID) 
			LEFT JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
			WHERE RoleId = @RoleId AND U.IsActive=@IsActive AND U.ProgrammeType=@Type
		END
	END
	ELSE
		BEGIN
		SELECT U.*,S.StateName,D.districtname FROM Users U 
		INNER JOIN STATES S ON (U.StateID=S.StateID) 
		LEFT JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
		WHERE RoleId = @RoleId AND U.IsActive=@IsActive AND CreatedBy=@CreatedBy
	END

END

GO
/****** Object:  StoredProcedure [dbo].[SP_GET_USERS_WITH_COUPONS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_GET_USERS_WITH_COUPONS]
(@RoleId Int)
AS
BEGIN
	SELECT U.*,S.StateName,D.districtname, isnull(C.NoOfCoupons,0) as NoOfCoupons FROM Users U 
	INNER JOIN STATES S ON (U.StateID=S.StateID) 
	INNER JOIN DISTRICTS D ON (U.StateID=D.StateID AND U.DistrictId=D.districtID) 
	LEFT JOIN (SELECT UserId,Sum(Coupons) as NoOfCoupons From COUPONS group by UserId) C ON (U.UserID=C.UserID) 
	WHERE RoleId = @RoleId ORDER BY U.FirstName
END

GO
/****** Object:  StoredProcedure [dbo].[SP_INSERT_CENTER]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_INSERT_CENTER]
(
	 @email varchar(100)
	,@phoneno varchar(15)
	,@stateid int
	,@districtid int
	,@pincode varchar(6)
	,@address varchar(200)
	,@firstName varchar(100)
	,@lastname varchar(100)
	,@SDMS_ID varchar(50)
	,@createdby int
)
AS
BEGIN
	INSERT INTO CENTERS (email,phoneno,stateid,districtid,pincode,[address],CenterName,MangerName,SDMS_ID,CreatedBy)
	values(@email,@phoneno,@stateid,@districtid,@pincode,@address,@firstName,@lastname,@SDMS_ID,@createdby)
END

GO
/****** Object:  StoredProcedure [dbo].[SP_INSERT_RESUME]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_INSERT_RESUME]
(
	@Agency varchar(100) = NULL,
	@TotalIndustrialExp varchar(100) = NULL,
	@SelectedLocation varchar(100) = NULL,
	@ScheduledLocation varchar(100) = NULL,
	@ApplyingFor varchar(100) = NULL,
	@Preference1 varchar(100) = NULL,
	@Preference2 varchar(100) = NULL,
	@Preference3 varchar(100) = NULL,
	@Preference4 varchar(100) = NULL,
	@Preference5 varchar(100) = NULL,
	@OtherPreferenceState varchar(100) = NULL,
	@OtherPreferenceDistrict varchar(100) = NULL,
	@OldId varchar(100)=NULL,

	@Data NVarChar(MAX) = NULL,  
	@State varchar(100) = NULL,
	@District varchar(100) = NULL,
	@City varchar(100) = NULL,
	@Name varchar(100) = NULL,
	@ContactNumber varchar(100) = NULL,
	@DOB varchar(100) = NULL,
	@Email varchar(100) = NULL,
	@AadhaarNo varchar(100) = NULL,
	@SpokenLanguagePrimary varchar(100) = NULL,
	@WrittenLanguagePrimary varchar(100) = NULL,

	@NominatedThrough varchar(100) = NULL,
	@AssociatedWith varchar(100) = NULL,
	@CBIBCRAName varchar(200) = NULL,
	@CoordinatorName varchar(200) = NULL,
	@CoordinatorEmail varchar(100) = NULL,
	@CoordinatorPhone varchar(100) = NULL,

	@AreaOfKnowledgeOrExpertise varchar(1000) = NULL,
	@ZedDisciplines varchar(1000) = NULL,

	@TotalExperience varchar(100) = NULL,
	@ZedDisciplinesIndustry varchar(1000) = NULL,
	@SectorsIndustry varchar(1000) = NULL,

	@ExperienceInMasterTraining varchar(100) = NULL,
	@ZedDisciplinesMT varchar(1000) = NULL,
	@SectorMT varchar(1000) = NULL,

	@ExperienceInAssessment varchar(100) = NULL,
	@NoOfAssessmentsDone varchar(1000) = NULL,
	@ZedDisciplinesAT varchar(1000) = NULL,
	@SectorAT varchar(1000) = NULL,

	@ExperienceInConsultancy varchar(100) = NULL,
	@NoOfConsultanciesGiven varchar(1000) = NULL,
	@ZedDisciplinesCT varchar(1000) = NULL,
	@SectorCT varchar(1000) = NULL,

	@SummaryOfSkillSets varchar(500) = NULL,
	@ProgrammeId varchar(50) = NULL
) 
AS
BEGIN
	IF (select count(*) from Registrations where Email=@Email OR ContactNumber=@ContactNumber)>0
	BEGIN
		SELECT TOP 1 * FROM Registrations WHERE CreatedDate='ABCD'
	END

	ELSE
	BEGIN
		INSERT INTO Registrations (
			Agency, ApplyingFor, OldId, Data, SelectedLocation, ScheduledLocation, 
			Preference1, Preference2, Preference3, Preference4, Preference5, OtherPreferenceState, OtherPreferenceDistrict, 
			State, District, City, Name, ContactNumber, DOB, Email, AadhaarNo, SpokenLanguagePrimary, WrittenLanguagePrimary, 
			NominatedThrough, AssociatedWith, CBIBCRAName, CoordinatorName, CoordinatorEmail, CoordinatorPhone, 
			AreaOfKnowledgeOrExpertise, ZedDisciplines, 
			TotalIndustrialExp, ZedDisciplinesIndustry, SectorsIndustry, 
			ExperienceInMasterTraining, ZedDisciplinesMT, SectorMT, 
			ExperienceInAssessment, NoOfAssessmentsDone, ZedDisciplinesAT, SectorAT, 
			ExperienceInConsultancy, NoOfConsultanciesGiven, ZedDisciplinesCT, SectorCT, 
			SummaryOfSkillSets, ProgrammeId
		)
		values(
			@Agency, @ApplyingFor, @OldId, @Data, @SelectedLocation, @ScheduledLocation, 
			@Preference1, @Preference2, @Preference3, @Preference4, @Preference5, @OtherPreferenceState, @OtherPreferenceDistrict, 
			@State, @District, @City, @Name, @ContactNumber, @DOB, @Email, @AadhaarNo, @SpokenLanguagePrimary, @WrittenLanguagePrimary, 
			@NominatedThrough, @AssociatedWith, @CBIBCRAName, @CoordinatorName, @CoordinatorEmail, @CoordinatorPhone, 
			@AreaOfKnowledgeOrExpertise, @ZedDisciplines, 
			@TotalIndustrialExp, @ZedDisciplinesIndustry, @SectorsIndustry, 
			@ExperienceInMasterTraining, @ZedDisciplinesMT, @SectorMT, 
			@ExperienceInAssessment, @NoOfAssessmentsDone, @ZedDisciplinesAT, @SectorAT, 
			@ExperienceInConsultancy, @NoOfConsultanciesGiven, @ZedDisciplinesCT, @SectorCT, 
			@SummaryOfSkillSets, @ProgrammeId
		)
	END
END

GO
/****** Object:  StoredProcedure [dbo].[SP_INSERT_RESUME_PHASE1]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_INSERT_RESUME_PHASE1]
(
	@Agency varchar(100) = NULL,
	@TotalIndustrialExp varchar(100) = NULL,
	@SelectedLocation varchar(100) = NULL,
	@ScheduledLocation varchar(100) = NULL,
	@ApplyingFor varchar(100) = NULL,
	@Preference1 varchar(100) = NULL,
	@Preference2 varchar(100) = NULL,
	@Preference3 varchar(100) = NULL,
	@Preference4 varchar(100) = NULL,
	@Preference5 varchar(100) = NULL,
	@OtherPreferenceState varchar(100) = NULL,
	@OtherPreferenceDistrict varchar(100) = NULL,
	@OldId varchar(100)=NULL,

	@Data NVarChar(MAX) = NULL,  
	@State varchar(100) = NULL,
	@District varchar(100) = NULL,
	@City varchar(100) = NULL,
	@Name varchar(100) = NULL,
	@ContactNumber varchar(100) = NULL,
	@DOB varchar(100) = NULL,
	@Email varchar(100) = NULL,
	@AadhaarNo varchar(100) = NULL,
	@SpokenLanguagePrimary varchar(100) = NULL,
	@WrittenLanguagePrimary varchar(100) = NULL,

	@NominatedThrough varchar(100) = NULL,
	@AssociatedWith varchar(100) = NULL,
	@CBIBCRAName varchar(200) = NULL,
	@CoordinatorName varchar(200) = NULL,
	@CoordinatorEmail varchar(100) = NULL,
	@CoordinatorPhone varchar(100) = NULL,

	@AreaOfKnowledgeOrExpertise varchar(1000) = NULL,
	@ZedDisciplines varchar(1000) = NULL,

	@TotalExperience varchar(100) = NULL,
	@ZedDisciplinesIndustry varchar(1000) = NULL,
	@SectorsIndustry varchar(1000) = NULL,

	@ExperienceInMasterTraining varchar(100) = NULL,
	@ZedDisciplinesMT varchar(1000) = NULL,
	@SectorMT varchar(1000) = NULL,

	@ExperienceInAssessment varchar(100) = NULL,
	@NoOfAssessmentsDone varchar(1000) = NULL,
	@ZedDisciplinesAT varchar(1000) = NULL,
	@SectorAT varchar(1000) = NULL,

	@ExperienceInConsultancy varchar(100) = NULL,
	@NoOfConsultanciesGiven varchar(1000) = NULL,
	@ZedDisciplinesCT varchar(1000) = NULL,
	@SectorCT varchar(1000) = NULL,

	@SummaryOfSkillSets varchar(500) = NULL,
	@ProgrammeId varchar(50) = NULL
) 
AS
BEGIN
	INSERT INTO RegistrationsPhase1 (
		Agency, ApplyingFor, OldId, Data, SelectedLocation, ScheduledLocation, 
		Preference1, Preference2, Preference3, Preference4, Preference5, OtherPreferenceState, OtherPreferenceDistrict, 
		State, District, City, Name, ContactNumber, DOB, Email, AadhaarNo, SpokenLanguagePrimary, WrittenLanguagePrimary, 
		NominatedThrough, AssociatedWith, CBIBCRAName, CoordinatorName, CoordinatorEmail, CoordinatorPhone, 
		AreaOfKnowledgeOrExpertise, ZedDisciplines, 
		TotalIndustrialExp, ZedDisciplinesIndustry, SectorsIndustry, 
		ExperienceInMasterTraining, ZedDisciplinesMT, SectorMT, 
		ExperienceInAssessment, NoOfAssessmentsDone, ZedDisciplinesAT, SectorAT, 
		ExperienceInConsultancy, NoOfConsultanciesGiven, ZedDisciplinesCT, SectorCT, 
		SummaryOfSkillSets, ProgrammeId
	)
	values(
		@Agency, @ApplyingFor, @OldId, @Data, @SelectedLocation, @ScheduledLocation, 
		@Preference1, @Preference2, @Preference3, @Preference4, @Preference5, @OtherPreferenceState, @OtherPreferenceDistrict, 
		@State, @District, @City, @Name, @ContactNumber, @DOB, @Email, @AadhaarNo, @SpokenLanguagePrimary, @WrittenLanguagePrimary, 
		@NominatedThrough, @AssociatedWith, @CBIBCRAName, @CoordinatorName, @CoordinatorEmail, @CoordinatorPhone, 
		@AreaOfKnowledgeOrExpertise, @ZedDisciplines, 
		@TotalIndustrialExp, @ZedDisciplinesIndustry, @SectorsIndustry, 
		@ExperienceInMasterTraining, @ZedDisciplinesMT, @SectorMT, 
		@ExperienceInAssessment, @NoOfAssessmentsDone, @ZedDisciplinesAT, @SectorAT, 
		@ExperienceInConsultancy, @NoOfConsultanciesGiven, @ZedDisciplinesCT, @SectorCT, 
		@SummaryOfSkillSets, @ProgrammeId
	)
END

GO
/****** Object:  StoredProcedure [dbo].[SP_INSERT_TAC_OBSERVANT_FEEDBACK]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_INSERT_TAC_OBSERVANT_FEEDBACK]
(
	 @BatchNo	varchar(50),
	 @UserId	varchar(100),
	 @ObservantId	varchar(50),
	 @ObservantName	varchar(200),
	 @AbilityToExplainZEDConcepts	int,
	 @PresentationSkills	int,
	 @AbleToResolveQueries	int,
	 @SupportingThroughCaseStudies	int,
	 @RecommendAsAFaculty	int,
	 @ReceivedFeedback	int
)
AS
BEGIN
	INSERT INTO TacObservantsFeedback 
	(	
		BatchNo, UserId, ObservantId, ObservantName, AbilityToExplainZEDConcepts, PresentationSkills, AbleToResolveQueries, 
		SupportingThroughCaseStudies, RecommendAsAFaculty, ReceivedFeedback
	)
	values(
		@BatchNo, @UserId, @ObservantId, @ObservantName, @AbilityToExplainZEDConcepts, @PresentationSkills, @AbleToResolveQueries, 
		@SupportingThroughCaseStudies, @RecommendAsAFaculty, @ReceivedFeedback
	)
END

GO
/****** Object:  StoredProcedure [dbo].[SP_INSERT_TAC_STUDENT_FEEDBACK]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_INSERT_TAC_STUDENT_FEEDBACK]
(
	@BatchNo	varchar(50),
	@UserId	varchar(100),
	@OverallProgrammeDelivery	int,
	@ContentAndInformationProvided	int,
	@ExercisedAndCaseStudiesHelp	int,
	@SessionsStructure	int,
	@PaceOfTheProgram	int,
	@TimelyConductOfTests	int,
	@TrainingMaterialUsefulness	int,
	@HowConfidentToTakeAssignmentsUnderZED	int,
	@TopThreeImprovementAreas	varchar(500)=NULL,
	@LikeToTakeThisTrainingAgain	varchar(50)=NULL,
	@OvelallVenueArrangements	int,
	@AvAndInternetSupport	int,
	@RefreshmentsAndFoodQuality	int,
	@PowerBackup	int,
	@EventCoordinationAndTimeManagement	int,
	@OtherSuggestionsOnVenue	varchar(500)=NULL	
)
AS
BEGIN
	INSERT INTO  TacStudentFeedback
	(	
		BatchNo, UserId, OverallProgrammeDelivery, ContentAndInformationProvided, ExercisedAndCaseStudiesHelp, SessionsStructure, 
		PaceOfTheProgram, TimelyConductOfTests, TrainingMaterialUsefulness, HowConfidentToTakeAssignmentsUnderZED, 
		TopThreeImprovementAreas, LikeToTakeThisTrainingAgain, OvelallVenueArrangements, AvAndInternetSupport, 
		RefreshmentsAndFoodQuality, PowerBackup, EventCoordinationAndTimeManagement, OtherSuggestionsOnVenue
	)
	values(
		@BatchNo, @UserId, @OverallProgrammeDelivery, @ContentAndInformationProvided, @ExercisedAndCaseStudiesHelp, @SessionsStructure, 
		@PaceOfTheProgram, @TimelyConductOfTests, @TrainingMaterialUsefulness, @HowConfidentToTakeAssignmentsUnderZED, 
		@TopThreeImprovementAreas, @LikeToTakeThisTrainingAgain, @OvelallVenueArrangements, @AvAndInternetSupport, 
		@RefreshmentsAndFoodQuality, @PowerBackup, @EventCoordinationAndTimeManagement, @OtherSuggestionsOnVenue
	)
END

GO
/****** Object:  StoredProcedure [dbo].[SP_INSERT_TAC_TRAINER_FEEDBACK]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_INSERT_TAC_TRAINER_FEEDBACK]
(
	 @BatchNo	varchar(50),
	 @UserId	varchar(100),
	 @TrainerId	varchar(50),
	 @TrainerName	varchar(200),
	 @TrainersKnowledge	int,
	 @ConfidenceLevel	int,
	 @PresentationSkills	int,
	 @TrainersInteration	int,
	 @AbleToResolveQueries	int,
	 @OpenToIdeas	int,
	 @AbleToShareExamples	int,
	 @TimeManagement	int,
	 @TimelyArrival	int,
	 @StressHandling	int,
	 @EngagementLevelAndPositiveRapport	int,
	 @ReceivedFeedback	bit,
	 @OtherSuggestions	varchar(500)=NULL
)
AS
BEGIN
	INSERT INTO TacTrainersFeedback 
	(	
		BatchNo, UserId, TrainerId, TrainerName, TrainersKnowledge, ConfidenceLevel, PresentationSkills, 
		TrainersInteration, AbleToResolveQueries, OpenToIdeas, AbleToShareExamples, TimeManagement, TimelyArrival, 
		StressHandling, EngagementLevelAndPositiveRapport, ReceivedFeedback
	)
	values(
		@BatchNo, @UserId, @TrainerId, @TrainerName, @TrainersKnowledge, @ConfidenceLevel, @PresentationSkills, 
		@TrainersInteration, @AbleToResolveQueries, @OpenToIdeas, @AbleToShareExamples, @TimeManagement, @TimelyArrival, 
		@StressHandling, @EngagementLevelAndPositiveRapport, @ReceivedFeedback
	)
END

GO
/****** Object:  StoredProcedure [dbo].[SP_INSERT_USER]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_INSERT_USER]
(
	 @userid varchar(50)
	,@password varchar(50)
	,@email varchar(100)
	,@phoneno varchar(15)
	,@stateid int
	,@districtid int
	,@pincode varchar(6)
	,@address varchar(200)
	,@firstName varchar(100)
	,@lastName varchar(100)
	,@CreatedBy varchar(100)
	,@roleid int
	,@ProgrammeType varchar(50)
	,@AdhaarNo varchar(50)
	,@PanNo varchar(50)
	,@OrganizationName varchar(100)
	,@GstNo varchar(50)
)
AS
BEGIN
	INSERT INTO USERS (userid,[password],email,phoneno,stateid,districtid,pincode,[address],firstname, SpocName,RoleId,CreatedBy,ProgrammeType, AdhaarNo, PanNo, OrganizationName,GstNo)
	values(@userid,@password,@email,@phoneno,@stateid,@districtid,@pincode,@address,@firstName, @lastName,@roleid, @CreatedBy,@ProgrammeType, @AdhaarNo, @PanNo, @OrganizationName,@GstNo)
	IF @roleid=3
	BEGIN
		INSERT INTO OrganisingPartners
		select Id, 'Self' Self from users where roleid=3 AND UserId=@userid
	END

END


GO
/****** Object:  StoredProcedure [dbo].[SP_MONTHLY_REPORT]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_MONTHLY_REPORT]
AS
BEGIN
	Select MONTH(AuditedDate) AS AuditedDate, LEFT(DATENAME(MONTH,AuditedDate),3) AS CreatedMonth, YEAR(AuditedDate) AS CreatedYear, 
		Sum(Audited) AS Audited, Sum(PendingQualityCheck) AS PendingQualityCheck, Sum(PendingFinalStage) AS PendingFinalStage, 
		Sum(Approved) AS Approved, Sum(Rejected) AS Rejected, Sum(DeletedForReAudit) AS DeletedForReAudit FROM 
		(SELECT distinct CONVERT(varchar,C.CreatedDate, 106) AS AuditedDate, isnull(Audited,0) AS Audited, isnull(PendingQualityCheck,0) AS PendingQualityCheck, 
		isnull(PendingFinalStage,0) AS PendingFinalStage, isnull(Approved,0) AS Approved, 
		isnull(Rejected,0) AS Rejected, isnull(DeletedForReAudit,0) AS DeletedForReAudit, CAST(C.CreatedDate AS DATE) AS CreatedDate FROM CenterInfo C
		LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS Audited FROM CenterInfo where Status in (0,1,2,3,4,5) group by CAST(CreatedDate AS DATE)) A1 ON (A1.CreatedDate=CAST(C.CreatedDate AS DATE))
		LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS Approved FROM CenterInfo where Status = 1 group by CAST(CreatedDate AS DATE)) A2 ON (A2.CreatedDate=CAST(C.CreatedDate AS DATE))
		LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS Rejected FROM CenterInfo where Status = 2 group by CAST(CreatedDate AS DATE)) A3 ON (A3.CreatedDate=CAST(C.CreatedDate AS DATE))
		LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS PendingQualityCheck FROM CenterInfo where Status in (4) group by CAST(CreatedDate AS DATE)) A4 ON (A4.CreatedDate=CAST(C.CreatedDate AS DATE))
		LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS DeletedForReAudit FROM CenterInfo where Status in (5) group by CAST(CreatedDate AS DATE)) DA ON (DA.CreatedDate=CAST(C.CreatedDate AS DATE))
		LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS PendingFinalStage FROM CenterInfo where Status in (0) group by CAST(CreatedDate AS DATE)) A5 ON (A5.CreatedDate=CAST(C.CreatedDate AS DATE))) D
	
	GROUP BY MONTH(AuditedDate), DATENAME(MONTH,AuditedDate), YEAR(AuditedDate)
	ORDER BY YEAR(AuditedDate) DESC, MONTH(AuditedDate) DESC
END

GO
/****** Object:  StoredProcedure [dbo].[SP_MOVE_TO_OBSERVANT]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_MOVE_TO_OBSERVANT] --'<redacted>', '<redacted>'
(
	@BatchNo varchar(50) = NULL,
	@CandidateId varchar(50) = NULL
)
AS
BEGIN
	INSERT INTO ObservantInformation (
		ObservantId, ObservantName, FirstName, LastName, EmailId, MobileNo, AadhaarNo, ZedTacId, 
		W, P, M, RegistrationId, TrainingType, State, District, BatchNo, CenterId, QpCode
	)
	SELECT C.CandidateId, C.FirstName + ' ' + ISNULL(C.LastName,'') ObservantName, C.FirstName, C.LastName, C.EmailId, C.MobileNo, C.AdhaarNo, C.ZEDTAC, W, P,
		CASE  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP15', 'ZED/TP16') THEN convert(decimal(10,2),M.score / 100.00)
			  WHEN C.mScoreSubmitted = 1 AND B.QpCode IN ('ZED/TP14') THEN convert(decimal(10,2),M.score / 170.00)
		ELSE NULL END AS MScore, C.RegistrationId, 
		CASE  WHEN B.QpCode='ZED/TP15' THEN 'Assessor'
			WHEN B.QpCode='ZED/TP16' THEN 'Consultant'
			WHEN B.QpCode='ZED/TP14' THEN 'Master Trainer'
		END AS TrainingType,
		C.State, C.District, @BatchNo BatchNo, B.CenterId, QpCode
	FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
	LEFT JOIN (SELECT BatchNo, CandidateId, SUM(Rating)*30 AS Score FROM MScores WHERE BatchNo=@BatchNo GROUP BY BatchNo, CandidateId) M ON (B.BatchNo=M.BatchNo AND C.CandidateId=M.CandidateId)
	LEFT JOIN (select distinct UserId, BatchNo from TacStudentFeedback where BatchNo=@BatchNo) FB ON (C.EmailId=FB.UserId AND FB.BatchNo=C.BatchNo)
	WHERE B.BatchNo=@BatchNo AND C.CandidateId=@CandidateId

	Update Candidates SET IsMovedToObservant=1 WHERE BatchNo=@BatchNo AND CandidateId=@CandidateId
END

GO
/****** Object:  StoredProcedure [dbo].[SP_MOVE_TO_OBSERVANT_BACK]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_MOVE_TO_OBSERVANT_BACK] --'<redacted>', '<redacted>'
(
	@BatchNo varchar(50) = NULL,
	@Id varchar(50) = NULL
)
AS
BEGIN

	Update Candidates SET IsMovedToObservant=NULL WHERE BatchNo=@BatchNo AND CandidateId IN (SELECT ObservantId FROM ObservantInformation WHERE Id=@Id AND BatchNo=@BatchNo)

	DELETE FROM ObservantInformation WHERE Id=@Id AND BatchNo=@BatchNo
END

GO
/****** Object:  StoredProcedure [dbo].[SP_PHASE1_BATCH_PARTICIPANTS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_PHASE1_BATCH_PARTICIPANTS] --'',NULL,'', NULL,NULL,'',NULL,NULL
(
	@BatchNo varchar(100) = NULL
)
AS
BEGIN
	SELECT R.Id, R.Status, R.Name, R.Email, R.ContactNumber, R.ApplyingFor, 
		NominatedThrough, AssociatedWith, CBIBCRAName, CoordinatorName, CoordinatorEmail, CoordinatorPhone, 
		AadhaarNo, R.DOB, R.State, R.District, City, SpokenLanguagePrimary, WrittenLanguagePrimary, 
		ZedDisciplines, AreaOfKnowledgeOrExpertise, 
		TotalIndustrialExp, ZedDisciplinesIndustry, SectorsIndustry, 
		ExperienceInMasterTraining, ZedDisciplinesMT, SectorMT, 
		ExperienceInAssessment, NoOfAssessmentsDone, ZedDisciplinesAT, SectorAT, 
		ExperienceInConsultancy, NoOfConsultanciesGiven, ZedDisciplinesCT, SectorCT, 
		SummaryOfSkillSets, Convert(varchar, CreatedDate, 106) CreatedDate,
		C.ZEDTAC, C.CertificateIssuedOn, C.Id CandidateId, C.BatchNo, R.RejectedComments
	FROM RegistrationsPhase1 R
	INNER JOIn Candidates C ON (R.ProgrammeId=C.BatchNo AND R.Email=C.EmailId)
	WHERE ProgrammeId=@BatchNo AND ZEDTAC IS NOT NULL
	ORDER BY Name
END

GO
/****** Object:  StoredProcedure [dbo].[SP_PHASE1_BATCHES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_PHASE1_BATCHES] --'<redacted>'
(
	@UserId varchar(200)=NULL,
	@RoleId varchar(200)=NULL
)
AS
BEGIN
	SELECT B.Id, CenterId, B.BatchNo, B.QpCode, VenueName, Status, State, District, Zip, ProgramType, OrganisingPartner, 
	Convert(varchar,StartDate,106) AS strStartDate, Convert(varchar,EndDate,106) AS strEndDate, J.QpName, U.FirstName,
	Convert(varchar,StartDate,112) AS strStartDateFilter, Convert(varchar,EndDate,112) AS strEndDateFilter, S.StateName, 
	B.NoOfCandidates, ISNULL(NoOfRegistrations,0) NoOfRegistrations
	FROM Batches B
	INNER JOIN JobRoles J ON (B.QpCode=J.QpCode)
	INNER JOIN Users U ON (B.CenterId=U.UserID)
	INNER JOIN States S ON (B.State=S.StateID)
	LEFT JOIN (select ProgrammeId, Count(*) NoOfRegistrations from RegistrationsPhase1 group by ProgrammeId) R ON (B.BatchNo=R.ProgrammeId)
	--WHERE B.QpCode IN ('<redacted>','<redacted>','<redacted>') AND StartDate>='<redacted>' AND StartDate<'<redacted>' AND ProgramType='<redacted>'
	WHERE Phase=1
	ORDER BY NoOfRegistrations desc 
END
GO
/****** Object:  StoredProcedure [dbo].[SP_PHASE1_GET_CERTIFICATE_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_PHASE1_GET_CERTIFICATE_DETAILS] --'<redacted>', '<redacted>'
(
	@BatchNo varchar(50)=NULL,
	@CandidateId varchar(50)=NULL,
	@IssuedOn varchar(50)=NULL
)
AS
BEGIN
	IF @IssuedOn IS NULL
		SET @IssuedOn = getdate()

	UPDATE Candidates SET CertificateIssuedOn = @IssuedOn WHERE Id=@CandidateId

	SELECT B.QpCode, C.Id, 
		Convert(varchar, CertificateIssuedOn,103) CertificateIssuedOn,
		Convert(varchar, StartDate,103) StartDate,
		Convert(varchar, EndDate,103) EndDate, 
		B.BatchNo, UPPER(P1.Name) ParticipantName, C.EmailID, C.ZedTac,
		REPLACE(ZedTac,'ZED','') + RIGHT('00'+REPLACE(B.BatchNo,'ZEDTP',''),4) CertificateNo
	FROM Batches B INNER JOIN Candidates C ON (B.BatchNo=C.BatchNo)
	INNER JOIN RegistrationsPhase1 P1 ON (P1.ProgrammeId=C.BatchNo AND P1.Email=C.EmailId)
	WHERE B.BatchNo=@BatchNo AND C.Id=@CandidateId

END

GO
/****** Object:  StoredProcedure [dbo].[SP_PHASE1_PARTICIPANT_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_PHASE1_PARTICIPANT_DETAILS] --'<redacted>', ''
(
	@EmailId varchar(200),
	@AadhaarNo varchar(200)=NULL
)
AS
BEGIN
	SELECT * FROM Phase1Candidates WHERE EmailId=@EmailId AND EmailId NOT IN  (SELECT Email FROM RegistrationsPhase1)
END

GO
/****** Object:  StoredProcedure [dbo].[SP_REGISTER_TRAINING_PROGRAM]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[SP_REGISTER_TRAINING_PROGRAM] --'<redacted>', '<redacted>'
(
	
	@BatchNo varchar(100) = NULL,
	@MobileNo varchar(100) = NULL,
	@EmailId varchar(100) = NULL,
	@QpCode varchar(50) = NULL

)
AS
BEGIN

	--ZED/TP18	5-Day Master Trainers Training Program
	--ZED/TP19	5-Day Assessors Training Program
	--ZED/TP20	5-Day Consultants Training Program

	----if (ds != null && ds.Tables[0].Rows.Count == 0)
 ----               {
 ----                   strRes = "Your record doesnot exist. Kindly check the details and try again.";
 ----               }
 ----               else if (ds != null && ds.Tables[0].Rows.Count > 0 && ds.Tables[0].Rows[0]["Status"].ToString()!="APPROVED")
 ----               {
 ----                   strRes = "Your application is yet to approve by administrator.";
 ----               }
 ----               else if (ds != null && ds.Tables[1].Rows.Count == 0)
 ----               {
 ----                   strRes = "You are not eligible for this program. Please check and try again.";
 ----               }
 ----               else if (ds != null && ds.Tables[2].Rows.Count > 0)
 ----               {
 ----                   strRes = "Email ID or Mobile No Already registered for this program.";
 ----               }

	DECLARE @RegId int = NULL

	select @QpCode= case when QpCode='ZED/TP18' then 'MasterTrainer' when QpCode='ZED/TP19' then 'Assessor' when QpCode='ZED/TP20' then 'ZEDConsultant' else '' end 
	from Batches where BatchNo=@BatchNo and Status=1 and StartDate>=getdate()

	--copying RegistrationId
	select @RegId=Id from Registrations where (Email=@EmailId and ContactNumber=@MobileNo and ApplyingFor=@QpCode)

	--if no data, not registered
	select Id,Agency,Name,ContactNumber,Email,State,District,ApplyingFor,Status from Registrations where (Email=@EmailId and ContactNumber=@MobileNo) 

	select * from Registrations where (Email=@EmailId and ContactNumber=@MobileNo and ApplyingFor=@QpCode)
	AND (select count(*) from Batches where IsRegistrationsClosed=0 and Status in (1,11,12) AND StartDate>=getdate() and BatchNo=@BatchNo)>0

	select BatchNo,FirstName,MobileNo,EmailId,Address,OrganizationName from candidates where EmailId=@EmailId and MobileNo=@MobileNo and BatchNo=@BatchNo 

	IF EXISTS(select Id,Agency,Name,ContactNumber,Email,State,District,ApplyingFor from Registrations where (Email=@EmailId and ContactNumber=@MobileNo))
	BEGIN
		IF NOT EXISTS(select BatchNo,FirstName,MobileNo,EmailId,Address,OrganizationName from candidates where EmailId=@EmailId and MobileNo=@MobileNo and BatchNo=@BatchNo )
		BEGIN
			IF EXISTS(select * from Registrations where (Email=@EmailId and ContactNumber=@MobileNo and ApplyingFor=@QpCode AND Status='APPROVED'))
			BEGIN
				IF EXISTS(select * from Batches where IsRegistrationsClosed=0 and Status in (1,11,12) AND StartDate>=getdate() and BatchNo=@BatchNo)
				BEGIN
					insert into Candidates (FirstName,MobileNo,EmailId,BatchNo)
					select name,ContactNumber,email,@BatchNo from Registrations where (Email=@EmailId and ContactNumber=@MobileNo)
					update Candidates set CandidateId=Id, RegistrationId=@RegId where EmailId=@EmailId and MobileNo=@MobileNo and BatchNo=@BatchNo 
				END
			END

		END
	END
	


END



GO
/****** Object:  StoredProcedure [dbo].[SP_RESET_PARTICIPANT]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_RESET_PARTICIPANT] --'<redacted>', '<redacted>'
(
	@BatchNo varchar(50) = NULL,
	@CandidateId varchar(50) = NULL
)
AS
BEGIN
	DECLARE @UserId varchar(200)
	SELECT @UserId=EmailId from Candidates where Id=@CandidateId AND BatchNo=@BatchNo

	UPDATE users SET UserId=@UserId+'_'+@BatchNo where UserID=@UserId AND BatchNumber=@BatchNo
	UPDATE Candidates SET EmailId=@UserId+'_'+@BatchNo where EmailId=@UserId AND BatchNo=@BatchNo

	UPDATE TacQuestionPaper SET UserId=@UserId+'_'+@BatchNo where UserId=@UserId AND BatchNo=@BatchNo
	UPDATE TacStudentFeedback SET UserId=@UserId+'_'+@BatchNo where UserId=@UserId AND BatchNo=@BatchNo
	UPDATE TacTrainersFeedback SET UserId=@UserId+'_'+@BatchNo where UserId=@UserId AND BatchNo=@BatchNo
	UPDATE ZedTac SET UserId=@UserId+'_'+@BatchNo where UserId=@UserId AND BatchNo=@BatchNo

	UPDATE Registrations SET BatchNo=NULL, Status='APPROVED' where Email=@UserId AND BatchNo=@BatchNo

END

GO
/****** Object:  StoredProcedure [dbo].[SP_RPT_AWS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_RPT_AWS]
AS
BEGIN
	select StateId, StateName, UserID,FirstName AS AgencyName, ProgramType, Count(*) AS Programmes, SUM(NoOfCandidates) Participants, SUM(NoOfCandidates)/Count(*) AS AverageParticipants from 
	(
		SELECT B.ProgramType, B.BatchNo, U.UserID, U.FirstName, S.StateId, S.StateName, isnull(CC.NoOfCandidates,0) NoOfCandidates
		FROM Batches B
		INNER JOIN Users U ON (B.CenterId=U.UserID)
		INNER JOIN States S ON (B.State=S.StateID)
		LEFT JOIN (select BatchNo, Count(*) NoOfCandidates from Candidates group by BatchNo) CC ON (B.BatchNo=CC.BatchNo)
		--WHERE ProgramType='<redacted>'
	) a
	group by StateId, StateName,FirstName, UserID, ProgramType
	ORDER BY ProgramType,Programmes DESC
END

GO
/****** Object:  StoredProcedure [dbo].[SP_RPT_AWS1]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_RPT_AWS1]
AS
BEGIN
	select StateId, StateName, UserID,FirstName AS AgencyName, QpCode, QpName, ProgramType, Count(*) AS Programmes, SUM(NoOfCandidates) Participants, SUM(NoOfCandidates)/Count(*) AS AverageParticipants from 
	(
		SELECT B.ProgramType, B.BatchNo, U.UserID, U.FirstName, J.QpCode, J.QpName, S.StateId, S.StateName, isnull(CC.NoOfCandidates,0) NoOfCandidates
		FROM Batches B
		INNER JOIN Users U ON (B.CenterId=U.UserID)
		INNER JOIN States S ON (B.State=S.StateID)
		INNER JOIN JobRoles J ON (B.QpCode=J.QpCode)
		LEFT JOIN (select BatchNo, Count(*) NoOfCandidates from Candidates group by BatchNo) CC ON (B.BatchNo=CC.BatchNo)
		--WHERE ProgramType='<redacted>'
	) a
	group by StateId, StateName,FirstName, QpCode, QpName, UserID, ProgramType
	ORDER BY ProgramType,Programmes DESC
END

GO
/****** Object:  StoredProcedure [dbo].[SP_SUMMARY_REPORT]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_SUMMARY_REPORT]
AS
BEGIN
	SELECT distinct CONVERT(varchar,C.CreatedDate, 106) AS AuditedDate, CAST(C.CreatedDate AS DATE) AS CreatedDate, isnull(Audited,0) AS Audited, isnull(Approved,0) AS Approved, isnull(Rejected,0) AS Rejected, isnull(PendingFinalStage,0) AS PendingFinalStage, isnull(PendingQualityCheck,0) AS PendingQualityCheck FROM CenterInfo C
	LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS Audited FROM CenterInfo where Status in (0,1,2,4,5) group by CAST(CreatedDate AS DATE)) A1 ON (A1.CreatedDate=CAST(C.CreatedDate AS DATE))
	LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS Approved FROM CenterInfo where Status = 1 group by CAST(CreatedDate AS DATE)) A2 ON (A2.CreatedDate=CAST(C.CreatedDate AS DATE))
	LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS Rejected FROM CenterInfo where Status = 2 group by CAST(CreatedDate AS DATE)) A3 ON (A3.CreatedDate=CAST(C.CreatedDate AS DATE))
	LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS PendingQualityCheck FROM CenterInfo where Status in (4) group by CAST(CreatedDate AS DATE)) A4 ON (A4.CreatedDate=CAST(C.CreatedDate AS DATE))
	LEFT JOIN (SELECT CAST(CreatedDate AS DATE) AS CreatedDate, Count(*) AS PendingFinalStage FROM CenterInfo where Status in (0) group by CAST(CreatedDate AS DATE)) A5 ON (A5.CreatedDate=CAST(C.CreatedDate AS DATE))
	ORDER BY CAST(C.CreatedDate AS DATE) DESC
END

GO
/****** Object:  StoredProcedure [dbo].[SP_TAC_EXAM_STATUS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_TAC_EXAM_STATUS] --'<redacted>', '<redacted>'
(
	@ProgrammeId varchar(50),
	@UserId varchar(100)
)
AS
BEGIN
	DECLARE @CurrentDate date = getdate()
	DECLARE @CandidateId varchar(50)
	IF @ProgrammeId = 'ZEDTP0000' AND @UserId='vivek204@gmail.com'
	BEGIN
		SET @CurrentDate= '2017-11-23' 
		select @CandidateId=CandidateId from Users where UserId = @UserId AND BatchNumber=@ProgrammeId

		select * from batches where BatchNo = @ProgrammeId --and convert(date,EndDate) = @CurrentDate 
			--and examstarttime is not null and Convert(Time,ExamStartTime)<Convert(time,Getdate())

		select top 4 * from batchattendance B inner join attendance A on (A.BatchAttendanceid=B.Id) 
		where B.batchNo='ZEDTP1747' --and A.CandidateId=@CandidateId and A.Ispresent=1 and createddate < @CurrentDate

		select isnull(NoOfAttempts,0)+1 NoOfAttempts from Candidates where Candidateid=@CandidateId
		--select 1 NoOfAttempts from Candidates where Candidateid=@CandidateId
	END
	ELSE
	BEGIN
		select @CandidateId=CandidateId from Users where UserId = @UserId AND BatchNumber=@ProgrammeId

		select * from batches where BatchNo = @ProgrammeId and convert(date,EndDate) = convert(date,@CurrentDate) 
			and examstarttime is not null and Convert(Time,REPLACE(ExamStartTime,'.',''))<Convert(time,Getdate())

		select * from batchattendance B inner join attendance A on (A.BatchAttendanceid=B.Id) 
		where B.batchNo=@ProgrammeId and A.CandidateId=@CandidateId and A.Ispresent=1 and createddate < @CurrentDate

		select isnull(NoOfAttempts,0)+1 NoOfAttempts from Candidates where Candidateid=@CandidateId
		--select 1 NoOfAttempts from Candidates where Candidateid=@CandidateId
	END
END

GO
/****** Object:  StoredProcedure [dbo].[SP_UPDATE_ATTENDANCE]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_UPDATE_ATTENDANCE]-- 14,'<redacted>','<redacted>',1
(
	@BatchAttendanceId bigint,
	@BatchNo varchar(50),
	@CandidateId varchar(50),
	@IsPresent bit
)
AS
BEGIN
	DECLARE @sql AS varchar(max)
	DECLARE @cnt AS int
	DECLARE @CenterId varchar(50)
	SET @CenterId = (SELECT CenterId from Batches WHERE BatchNo=@BatchNo)

	SET @cnt = (SELECT Count(*) from CandidateAttendance WHERE BatchNo=@BatchNo AND CandidateId=@CandidateId AND [Year]=YEAR(getdate()) AND [Month]=MONTH(getdate()))
	IF @cnt=0
		INSERT INTO CandidateAttendance (CenterId,BatchNo,CandidateId,[Year],[Month]) VALUES (@CenterId,@BatchNo,@CandidateId,YEAR(getdate()),MONTH(getdate()))
	
	INSERT INTO Attendance (BatchAttendanceId,BatchNo,CandidateId,IsPresent) VALUES (@BatchAttendanceId,@BatchNo,@CandidateId,@IsPresent)
	
	SET @sql = 'UPDATE CandidateAttendance SET Day'+convert(varchar,DAy(getdate()))+'='+convert(varchar,@IsPresent)+' WHERE BatchNo='+char(39)+@BatchNo+char(39)+' AND CandidateId='+@CandidateId+' AND [Year]=YEAR(getdate()) AND [Month]=MONTH(getdate())'
	--print @sql
	execute (@sql)
END
GO
/****** Object:  StoredProcedure [dbo].[SP_UPDATE_ATTENDANCE_OUT]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_UPDATE_ATTENDANCE_OUT]
(
	@BatchAttendanceId bigint,
	@BatchNo varchar(50),
	@CandidateId varchar(50),
	@IsPresent bit
)
AS
BEGIN
	DECLARE @sql AS varchar(max)
	DECLARE @cnt AS int
	DECLARE @CenterId varchar(50)
	SET @CenterId = (SELECT CenterId from Batches WHERE BatchNo=@BatchNo)

	SET @cnt = (SELECT Count(*) from CandidateAttendanceOut WHERE BatchNo=@BatchNo AND CandidateId=@CandidateId AND [Year]=YEAR(getdate()) AND [Month]=MONTH(getdate()))
	IF @cnt=0
		INSERT INTO CandidateAttendanceOut (CenterId,BatchNo,CandidateId,[Year],[Month]) VALUES (@CenterId,@BatchNo,@CandidateId,YEAR(getdate()),MONTH(getdate()))
	
	INSERT INTO Attendance (BatchAttendanceId,BatchNo,CandidateId,IsPresent) VALUES (@BatchAttendanceId,@BatchNo,@CandidateId,@IsPresent)
	
	SET @sql = 'UPDATE CandidateAttendanceOut SET Day'+convert(varchar,DAy(getdate()))+'='+convert(varchar,@IsPresent)+' WHERE BatchNo='+char(39)+@BatchNo+char(39)+' AND CandidateId='+@CandidateId+' AND [Year]=YEAR(getdate()) AND [Month]=MONTH(getdate())'

	execute (@sql)
END
GO
/****** Object:  StoredProcedure [dbo].[SP_UPDATE_OBSERVER_SCHEDULE]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_UPDATE_OBSERVER_SCHEDULE]-- 14,'<redacted>','<redacted>',1
(
	@Id bigint,
	@ObservantBatchNo varchar(50)=NULL,
	@Topic varchar(500)=NULL,
	@ScheduledDate varchar(50)=NULL,
	@ScheduledTime varchar(50)=NULL,
	@Observer varchar(200)=NULL,
	@ObserverEmail varchar(200)=NULL
)
AS
BEGIN
	UPDATE ObservantInformation 
	SET	ObservantBatchNo=@ObservantBatchNo, Topic=@Topic, ScheduledDate=@ScheduledDate, ScheduledTime=@ScheduledTime,
		Observer=@Observer, ObserverEmail=@ObserverEmail
	WHERE Id=@Id
END
GO
/****** Object:  StoredProcedure [dbo].[SP_UPDATE_PARTICIPANT_DETAILS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_UPDATE_PARTICIPANT_DETAILS]
(
		@FirstName VARCHAR(100) = NULL,
		@LastName VARCHAR(100) = NULL,
		@MobileNo VARCHAR(50) = NULL,
		@EmailId VARCHAR(150) = NULL,
		@UAMEM1EM2SSINo VARCHAR(50) = NULL,
		@AdhaarNo VARCHAR(50) = NULL,
		@Id VARCHAR(50) = NULL
)
AS
BEGIN
	update Candidates set FirstName=@FirstName,LastName=@LastName where Id=@Id
END

GO
/****** Object:  StoredProcedure [dbo].[SP_UPDATE_REGISTRATION_STATUS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_UPDATE_REGISTRATION_STATUS]
(
	 @RejectedComments varchar(5000)
	,@Status varchar(15)
	,@Id int
	
)
AS
BEGIN
	UPDATE Registrations SET RejectedComments=@RejectedComments, Status=@Status, StatusUpdatedDate=GetDate() WHERE Id=@Id
	
	IF (@Status='REJECTED')
	BEGIN
		update Registrations set Email=concat(Email,'_REJECTED'), ContactNumber=CONCAT(ContactNumber,'00000'), AadhaarNo=CONCAT(AadhaarNo,'00000') where Id=@Id
	END
END

GO
/****** Object:  StoredProcedure [dbo].[SP_UPDATE_RESUME]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_UPDATE_RESUME]
(
	@Id varchar(100),
	@City varchar(100) = NULL,
	@AadhaarNo varchar(100) = NULL,
	@SpokenLanguagePrimary varchar(100) = NULL,
	@WrittenLanguagePrimary varchar(100) = NULL,

	@NominatedThrough varchar(100) = NULL,
	@AssociatedWith varchar(100) = NULL,
	@CBIBCRAName varchar(200) = NULL,
	@CoordinatorName varchar(200) = NULL,
	@CoordinatorEmail varchar(100) = NULL,
	@CoordinatorPhone varchar(100) = NULL,

	@AreaOfKnowledgeOrExpertise varchar(1000) = NULL,
	@ZedDisciplines varchar(1000) = NULL,

	@TotalIndustrialExp varchar(100)=NULL,
	@ZedDisciplinesIndustry varchar(1000) = NULL,
	@SectorsIndustry varchar(1000) = NULL,

	@ExperienceInMasterTraining varchar(100) = NULL,
	@ZedDisciplinesMT varchar(1000) = NULL,
	@SectorMT varchar(1000) = NULL,

	@ExperienceInAssessment varchar(100) = NULL,
	@NoOfAssessmentsDone varchar(1000) = NULL,
	@ZedDisciplinesAT varchar(1000) = NULL,
	@SectorAT varchar(1000) = NULL,

	@ExperienceInConsultancy varchar(100) = NULL,
	@NoOfConsultanciesGiven varchar(1000) = NULL,
	@ZedDisciplinesCT varchar(1000) = NULL,
	@SectorCT varchar(1000) = NULL,

	@SummaryOfSkillSets varchar(500) = NULL

)
AS
BEGIN
	UPDATE Registrations SET
		City=@City, AadhaarNo=@AadhaarNo, SpokenLanguagePrimary=@SpokenLanguagePrimary, WrittenLanguagePrimary=@WrittenLanguagePrimary, 
		NominatedThrough=@NominatedThrough, AssociatedWith=@AssociatedWith, CBIBCRAName=@CBIBCRAName, CoordinatorName=@CoordinatorName, 
		CoordinatorEmail=@CoordinatorEmail, CoordinatorPhone=@CoordinatorPhone, 
		AreaOfKnowledgeOrExpertise=@AreaOfKnowledgeOrExpertise, ZedDisciplines=@ZedDisciplines, 
		ZedDisciplinesIndustry=@ZedDisciplinesIndustry, SectorsIndustry=@SectorsIndustry, 
		ExperienceInMasterTraining=@ExperienceInMasterTraining, ZedDisciplinesMT=@ZedDisciplinesMT, SectorMT=@SectorMT, 
		ExperienceInAssessment=@ExperienceInAssessment, NoOfAssessmentsDone=@NoOfAssessmentsDone, ZedDisciplinesAT=@ZedDisciplinesAT, SectorAT=@SectorAT, 
		ExperienceInConsultancy=@ExperienceInConsultancy, NoOfConsultanciesGiven=@NoOfConsultanciesGiven, ZedDisciplinesCT=@ZedDisciplinesCT, SectorCT=@SectorCT, 
		SummaryOfSkillSets=@SummaryOfSkillSets
	WHERE Id=@Id
END

GO
/****** Object:  StoredProcedure [dbo].[SP_UPDATE_RESUME_BY_USER]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_UPDATE_RESUME_BY_USER]
(
	@ApplyingFor varchar(100) = NULL,
	@Email varchar(100) = NULL,
	@AadhaarNo varchar(100) = NULL,

	@TotalIndustrialExp varchar(100) = NULL,
	@SelectedLocation varchar(100) = NULL,
	@ScheduledLocation varchar(100) = NULL,
	@Preference1 varchar(100) = NULL,
	@Preference2 varchar(100) = NULL,
	@Preference3 varchar(100) = NULL,
	@Preference4 varchar(100) = NULL,
	@Preference5 varchar(100) = NULL,
	@OtherPreferenceState varchar(100) = NULL,
	@OtherPreferenceDistrict varchar(100) = NULL,
	@OldId varchar(100)=NULL,

	@Data NVarChar(MAX) = NULL,  
	@State varchar(100) = NULL,
	@District varchar(100) = NULL,
	@City varchar(100) = NULL,
	@Name varchar(100) = NULL,
	@ContactNumber varchar(100) = NULL,
	@DOB varchar(100) = NULL,
	@SpokenLanguagePrimary varchar(100) = NULL,
	@WrittenLanguagePrimary varchar(100) = NULL,

	@NominatedThrough varchar(100) = NULL,
	@AssociatedWith varchar(100) = NULL,
	@CBIBCRAName varchar(200) = NULL,
	@CoordinatorName varchar(200) = NULL,
	@CoordinatorEmail varchar(100) = NULL,
	@CoordinatorPhone varchar(100) = NULL,

	@AreaOfKnowledgeOrExpertise varchar(1000) = NULL,
	@ZedDisciplines varchar(1000) = NULL,

	@TotalExperience varchar(100) = NULL,
	@ZedDisciplinesIndustry varchar(1000) = NULL,
	@SectorsIndustry varchar(1000) = NULL,

	@ExperienceInMasterTraining varchar(100) = NULL,
	@ZedDisciplinesMT varchar(1000) = NULL,
	@SectorMT varchar(1000) = NULL,

	@ExperienceInAssessment varchar(100) = NULL,
	@NoOfAssessmentsDone varchar(1000) = NULL,
	@ZedDisciplinesAT varchar(1000) = NULL,
	@SectorAT varchar(1000) = NULL,

	@ExperienceInConsultancy varchar(100) = NULL,
	@NoOfConsultanciesGiven varchar(1000) = NULL,
	@ZedDisciplinesCT varchar(1000) = NULL,
	@SectorCT varchar(1000) = NULL,

	@SummaryOfSkillSets varchar(500) = NULL

)
AS
BEGIN
	UPDATE Registrations 
	SET Data=@Data, SelectedLocation=@SelectedLocation, ScheduledLocation=@ScheduledLocation, 
		Preference1=@Preference1, Preference2=@Preference2, Preference3=@Preference3, Preference4=@Preference4, Preference5=@Preference5, OtherPreferenceState=@OtherPreferenceState, OtherPreferenceDistrict=@OtherPreferenceDistrict, 
		State=@State, District=@District, City=@City, Name=@Name, ContactNumber=@ContactNumber, DOB=@DOB, SpokenLanguagePrimary=@SpokenLanguagePrimary, WrittenLanguagePrimary=@WrittenLanguagePrimary, 
		NominatedThrough=@NominatedThrough, AssociatedWith=@AssociatedWith, CBIBCRAName=@CBIBCRAName, CoordinatorName=@CoordinatorName, CoordinatorEmail=@CoordinatorEmail, CoordinatorPhone=@CoordinatorPhone, 
		AreaOfKnowledgeOrExpertise=@AreaOfKnowledgeOrExpertise, ZedDisciplines=@ZedDisciplines, 
		TotalIndustrialExp=@TotalIndustrialExp, ZedDisciplinesIndustry=@ZedDisciplinesIndustry, SectorsIndustry=@SectorsIndustry, 
		ExperienceInMasterTraining=@ExperienceInMasterTraining, ZedDisciplinesMT=@ZedDisciplinesMT, SectorMT=@SectorMT, 
		ExperienceInAssessment=@ExperienceInAssessment, NoOfAssessmentsDone=@NoOfAssessmentsDone, ZedDisciplinesAT=@ZedDisciplinesAT, SectorAT=@SectorAT, 
		ExperienceInConsultancy=@ExperienceInConsultancy, NoOfConsultanciesGiven=@NoOfConsultanciesGiven, ZedDisciplinesCT=@ZedDisciplinesCT, SectorCT=@SectorCT, 
		SummaryOfSkillSets=@SummaryOfSkillSets
	WHERE ContactNumber=@ContactNumber AND Email=@Email
END

GO
/****** Object:  StoredProcedure [dbo].[SP_UPDATE_USER]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_UPDATE_USER]
(
	 @userid varchar(50)
	,@phoneno varchar(15)
	,@stateid int
	,@districtid int
	,@pincode varchar(6)
	,@address varchar(200)
	,@lastName varchar(100)
	,@UpdatedBy varchar(100)
	,@AdhaarNo varchar(50)
	,@PanNo varchar(50)
	,@GstNo varchar(50)
)
AS
BEGIN
	UPDATE USERS 
	SET phoneno=@phoneno,
		stateid=@stateid,
		districtid=@districtid,
		pincode=@pincode,
		[address]=@address,
		SpocName=@lastName, 
		UpdatedBy=@UpdatedBy,
		UpdatedDate=GETDATE(),
		AdhaarNo=@AdhaarNo, 
		PanNo=@PanNo,
		GstNo=@GstNo
	WHERE userid=@userid
END

GO
/****** Object:  StoredProcedure [dbo].[SP_VERIFY_REGISTRATION_STATUS_delete]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[SP_VERIFY_REGISTRATION_STATUS_delete] --'<redacted>', '<redacted>'
(
	@Email varchar(100) = NULL,
	@ContactNumber varchar(50) = NULL
)
AS
BEGIN

	select Id,Agency,Name,ContactNumber,Email,State,District,ApplyingFor from Registrations where ApplyingFor='MasterTrainer' and (Email=@Email and ContactNumber=@ContactNumber)

END



GO
/****** Object:  StoredProcedure [dbo].[SP_ZEDTAC_CHECK_ASSESSMENT_STATUS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_ZEDTAC_CHECK_ASSESSMENT_STATUS] --'<redacted>','<redacted>','<redacted>'
(
	@EmailId varchar(200) = NULL,
	@MobileNo varchar(200) = NULL,
	@BatchNo varchar(200) = NULL
)
AS
BEGIN
	
	DECLARE @CandidateId int = NULL
	DECLARE @QpCode varchar(50) = NULL
	DECLARE @AssessmentStatus int = 0
	SELECT @CandidateId=CandidateId FROM Candidates where EmailId=@EmailId and MobileNo=@MobileNo and BatchNo=@BatchNo
	select @QpCode=CASE WHEN QpCode='ZED/TP18' THEN 'MasterTrainer' WHEN QpCode='ZED/TP19' THEN 'Assessor' WHEN QpCode='ZED/TP20' THEN 'ZedConsultant' END  from Batches where BatchNo=@BatchNo


	IF(SELECT COUNT(*) FROM Candidates where EmailId=@EmailId and MobileNo=@MobileNo and BatchNo=@BatchNo)>0
	BEGIN
		IF (select count(*) from Attendance where CandidateId=@CandidateId and BatchNo=@BatchNo and IsPresent=1)=5
		BEGIN
			IF (select COUNT(*) from ZedTacSelfAssessments where CandidateId=@CandidateId and BatchNo=@BatchNo and Status=1)=0
			BEGIN
				IF(select count(*) from Batches where BatchNo=@BatchNo and convert(time,getdate())>=convert(time,ExamStartTime) and convert(time,getdate())<=convert(time,ExamEndTime) and convert(date,EndDate)= convert(date,getdate())  )>0
				BEGIN
					SET @AssessmentStatus = 1
					select @AssessmentStatus ErrorStatus, '' ErrorMessage

					IF (select COUNT(*) from ZedTacSelfAssessments where CandidateId=@CandidateId and BatchNo=@BatchNo)=0
					BEGIN
						INSERT INTO ZedTacSelfAssessments (BatchNo,CandidateId,CreatedDate)
						values(@BatchNo,@CandidateId,GETDATE())
					END

				END
				ELSE
				BEGIN
					select @AssessmentStatus ErrorStatus, 'Please check the Exam schedule time' ErrorMessage
				END
			END
			ELSE
			BEGIN
				select @AssessmentStatus ErrorStatus, 'Exam already conducted' ErrorMessage
			END
		END
		ELSE
		BEGIN
			SELECT @AssessmentStatus ErrorStatus, '5 days Attendance is not there' ErrorMessage
		END
	END
	ELSE 
	BEGIN
		SELECT @AssessmentStatus ErrorStatus,'Please check Candidate Details' ErrorMessage
	END
	
	select distinct SectionCode,SectionName from ZedTacQuestions where QuestionniareCategory=@QpCode order by SectionCode
	select Q.SectionCode, SectionName, OrderNo, Q.QuestionCode, QuestionName QuestionText, AnswerCode, AnswerText from ZedTacQuestions Q left join ZedTacSelfAssessmentQuestions S on (q.QuestionCode=S.QuestionCode and CandidateId=@CandidateId)  where QuestionniareCategory=@QpCode order by OrderNo
	select O.SectionCode, O.QuestionCode, OptionCode, OptionName from ZedTacOptions O inner join ZedTacQuestions Q on (O.QuestionCode=Q.QuestionCode and O.QuestionnaireName=Q.QuestionniareCategory) where  Q.QuestionniareCategory=@QpCode and O.QuestionnaireName=@QpCode order by OptionCode

	select B.*, QpName from Batches B INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) where BatchNo=@BatchNo
	SELECT * FROM Candidates where EmailId=@EmailId and MobileNo=@MobileNo and BatchNo=@BatchNo
	
END

GO
/****** Object:  StoredProcedure [dbo].[SP_ZEDTAC_FINAL_SUBMIT]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_ZEDTAC_FINAL_SUBMIT] --816,'<redacted>'
(
	@CandidateId varchar(200) = NULL,
	@BatchNo varchar(200) = NULL
)
AS
BEGIN

	DECLARE @WScore int = NULL,
			@PScore int = NULL,
			@CertificatePrefix varchar(50) = NULL,
			@QpCode varchar(50) = NULL,
			@SrNo bigint = NULL,
			@CertificateNo varchar(50) = NULL

			SELECT @QpCode=QpCode from Batches where BatchNo=@BatchNo

			

	--LOCKING FINAL SUBMIT
	update ZedTacSelfAssessments set Status=1,FinalSubmitDate=getdate() where CandidateId=@CandidateId and BatchNo=@BatchNo


	--GETTING THE W AND P SCORES
	select @WScore=sum(AnswerScore) from (
	select case when AnswerCode=CorrectAnswer then MaximumMarks else 0 end as AnswerScore
	from ZedTacSelfAssessmentQuestions S 
	inner join ZedTacQuestions Q on (S.questioncode=q.questioncode) where CandidateId=@CandidateId and AssessmentId=@BatchNo) A

	--select @PScore=isnull(Attendance,0)+isnull(ClassParticipation,0)+isnull(CommunicationSkills,0)+isnull(AssessmentSkills,0) from ZedTacPracticalScore where CandidateId=@CandidateId and BatchNo=@BatchNo

	--UPDATING W AND P SCORES
	update Candidates set W=@WScore where CandidateId=@CandidateId and BatchNo=@BatchNo


	--GENERATING CERTIFICATE NUMBER
	IF (SELECT count(*) FROM Candidates where CandidateId=@CandidateId and BatchNo=@BatchNo and isnull(W,0)>= 42.00 AND isnull(P,0)>= 28.00)>0
			BEGIN

				IF @QpCode='ZED/TP18'
				BEGIN
					SET @SrNo = Next Value For MasterTrainerCertificateNo; 
					SET @CertificatePrefix='MT'
				END
				IF @QpCode='ZED/TP19'
				BEGIN
					SET @SrNo = Next Value For AssessorCertificateNo; 
					SET @CertificatePrefix='AS'
				END
				IF @QpCode='ZED/TP20'
				BEGIN
					SET @SrNo = Next Value For ConsultantCertificateNo;
					SET @CertificatePrefix='CO'
				END

				SET @CertificateNo = CONCAT(@CertificatePrefix, year(getdate()),right(@BatchNo,4),right('0000' + cast(@SrNo as varchar(10)), 4))
				 update Candidates set ZEDTAC=@CertificateNo where CandidateId=@CandidateId and BatchNo=@BatchNo

			END


		 
		 

		--print @CertificateNo
		--print @CertificatePrefix
		--print @QpCode
		--PRINT @SrNo

	
END

GO
/****** Object:  StoredProcedure [dbo].[SP_ZEDTAC_GET_PRACTICAL_SCORES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_ZEDTAC_GET_PRACTICAL_SCORES] --'<redacted>'
(
	@BatchNo varchar(200) = NULL
)
AS
BEGIN
	

	SELECT C.Id, C.CandidateId, C.FirstName, C.LastName, S.Attendance, S.ClassParticipation, S.CommunicationSkills, S.AssessmentSkills 
	FROM Candidates C 
	LEFT JOIN ZedTacPracticalScore S 
	ON (C.CandidateId=S.CandidateId and C.BatchNo=s.BatchNo) 
	where C.BatchNo=@BatchNo

	select * from ZedTacPracticalScore where batchNo=@BatchNo
	
END

GO
/****** Object:  StoredProcedure [dbo].[SP_ZEDTAC_GET_PRACTICAL_SCORES_BATCHES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_ZEDTAC_GET_PRACTICAL_SCORES_BATCHES] --'<redacted>', '<redacted>'
(
	@UserId varchar(200) = NULL,
	@RoleId varchar(200) = NULL
)
AS
BEGIN
	
	SELECT B.BatchNo, J.QpName, B.VenueName, Convert(varchar,StartDate,106) AS strStartDate, Convert(varchar,EndDate,106) AS strEndDate, B.QpCode
    FROM Batches B 
    INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) 
    WHERE Status > 0
	AND (@RoleId=4 AND B.Coordinator=@UserId) OR (@RoleId!=4 AND B.CenterId=@UserId)
	ORDER BY StartDate DESC
	
END

GO
/****** Object:  StoredProcedure [dbo].[SP_ZEDTAC_INSERT_SELF_ASSESSMENT_QUESTIONS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[SP_ZEDTAC_INSERT_SELF_ASSESSMENT_QUESTIONS] --'<redacted>', '<redacted>'
(
	@BatchNo varchar(50) = NULL,
	@CandidateId varchar(50) = NULL,
	@QuestionList DynamicQuestion READONLY
)
AS
BEGIN
	
	SET NOCOUNT ON;

	DECLARE @AssessmentId varchar(50) = NULL,
	@UserId varchar(50) = NULL,
	@InterviewType varchar(50) = NULL

	SET @AssessmentId=@BatchNo

	

	--SELECT @AssessmentId=Id,@UserId=UserId,@InterviewType=InterviewType from SelfAssessments WHERE MobileNo=@MobileNo

	DELETE FROM ZEdTacSelfAssessmentQuestions WHERE CandidateId=@CandidateId
	--DELETE FROM SelfAssessmentOptions WHERE AssessmentId=@AssessmentId

	INSERT INTO ZEdTacSelfAssessmentQuestions (AssessmentId, CandidateId, QuestionCode, QuestionText, AnswerType, AnswerCode, AnswerText, AnswerOther)
	SELECT @AssessmentId, @CandidateId,Q.QuestionCode, QuestionText,AnswerType, AnswerCode,O.OptionName, AnswerOther FROM @QuestionList Q 
	left join ZEdTacOptions O on (Q.AnswerCode=O.OptionCode)
	
	--INSERT INTO SelfAssessmentQuestions (AssessmentId, MobileNo, QuestionCode, QuestionText, AnswerType, AnswerCode, AnswerText, AnswerOther)
	--SELECT @AssessmentId, @MobileNo,Q.QuestionCode, QuestionText,AnswerType, AnswerCode,case when Q.AnswerType='<redacted>' then O.OptionName else AnswerText end as AnswerText, AnswerOther FROM @QuestionList Q 
	--left join Options O on (Q.AnswerCode=O.OptionCode and Q.AnswerType='<redacted>' and Q.AnswerText is null)

	--INSERT INTO SelfAssessmentOptions (AssessmentId, MobileNo, QuestionCode, OptionCode, OptionText, AnswerCode, Selected)
	--SELECT @AssessmentId, @MobileNo,QuestionCode, OptionCode, OptionText, AnswerCode, Selected FROM @OptionList

	--INSERT INTO UserLogins (UserId,AssessmentId,MobileNo,InterviewType,CreatedDate)
	--values(@UserId,@AssessmentId,@MobileNo,@InterviewType,getdate())



END

GO
/****** Object:  StoredProcedure [dbo].[SP_ZEDTAC_UPDATE_EXAM_TIME]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_ZEDTAC_UPDATE_EXAM_TIME]-- 14,'<redacted>','<redacted>',1
(
	
	@BatchNo varchar(50),
	@ExamStartTime varchar(50),
	@ExamEndTime varchar(50)
)
AS
BEGIN
	UPDATE Batches set ExamStartTime=@ExamStartTime, ExamEndTime=@ExamEndTime where BatchNo=@BatchNo
END
GO
/****** Object:  StoredProcedure [dbo].[SP_ZEDTAC_UPDATE_PRACTICAL_SCORES]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE PROCEDURE [dbo].[SP_ZEDTAC_UPDATE_PRACTICAL_SCORES] --'<redacted>', '<redacted>'
(
	@BatchNo varchar(50) = NULL,
	@ParticipantList DynamicQuestion READONLY
)
AS
BEGIN
	
	SET NOCOUNT ON;

	DECLARE	@QpCode varchar(50) = NULL

			SELECT @QpCode=QpCode from Batches where BatchNo=@BatchNo

	UPDATE S 
	SET S.Attendance=C.AnswerType, 
		S.ClassParticipation=C.AnswerCode, 
		S.CommunicationSkills=C.AnswerText, 
		S.AssessmentSkills=C.AnswerOther
	FROM @ParticipantList C 
	INNER JOIN ZedTacPracticalScore S 
	ON (C.QuestionCode=S.CandidateId) 
	where S.BatchNo=@BatchNo

	INSERT INTO ZedTacPracticalScore (BatchNo, CandidateId, Attendance, ClassParticipation, CommunicationSkills, AssessmentSkills)
	SELECT @BatchNo, C.QuestionCode, C.AnswerType, C.AnswerCode, C.AnswerText, C.AnswerOther
	FROM @ParticipantList C 
	LEFT JOIN ZedTacPracticalScore S 
	ON (C.QuestionCode=S.CandidateId AND S.BatchNo=@BatchNo) 
	where S.CandidateId IS NULL

	----UPDATING PRACTICAL SCORES TOTAL IN CANDIDATES TABLE
	update C set P=isnull(Attendance,0)+isnull(ClassParticipation,0)+isnull(CommunicationSkills,0)+isnull(AssessmentSkills,0)
	from ZedTacPracticalScore Z inner join Candidates C on (Z.BatchNo=C.BatchNo and Z.CandidateId=C.CandidateId) where Z.BatchNo=@BatchNo

	----UPDATING DEFAULT SCORES IN CANDIDATES TABLE FOR PARTICIPATION CERTIFICATE
	IF @QpCode='ZED/TP24'
	BEGIN
		update C set P=isnull(Attendance,0)+isnull(ClassParticipation,0)+isnull(CommunicationSkills,0)+isnull(AssessmentSkills,0),
		W=isnull(Attendance,0)+isnull(ClassParticipation,0)+isnull(CommunicationSkills,0)+isnull(AssessmentSkills,0)
		from ZedTacPracticalScore Z inner join Candidates C on (Z.BatchNo=C.BatchNo and Z.CandidateId=C.CandidateId) where Z.BatchNo=@BatchNo
	END


	----GENERATING CERTIFICATE NUMBER

				IF @QpCode='ZED/TP18'
				BEGIN					
					update Candidates set ZEDTAC=CONCAT('MT', year(getdate()),right(@BatchNo,4),right('0000' + cast(Next Value For MasterTrainerCertificateNo as varchar(10)), 4)) where ZEDTAC is null and BatchNo=@BatchNo and isnull(W,0)>= 42.00 AND isnull(P,0)>= 28.00
				END
				IF @QpCode='ZED/TP19'
				BEGIN
					update Candidates set ZEDTAC=CONCAT('AS', year(getdate()),right(@BatchNo,4),right('0000' + cast(Next Value For AssessorCertificateNo as varchar(10)), 4)) where ZEDTAC is null and BatchNo=@BatchNo and isnull(W,0)>= 42.00 AND isnull(P,0)>= 28.00
				END
				IF @QpCode='ZED/TP20'
				BEGIN
					update Candidates set ZEDTAC=CONCAT('CO', year(getdate()),right(@BatchNo,4),right('0000' + cast(Next Value For ConsultantCertificateNo as varchar(10)), 4)) where ZEDTAC is null and BatchNo=@BatchNo and isnull(W,0)>= 42.00 AND isnull(P,0)>= 28.00
				END
				IF @QpCode='ZED/TP24'
				BEGIN
					update Candidates set ZEDTAC=CONCAT(year(getdate()),right(@BatchNo,4),right('0000' + cast(Next Value For ParticipationCertificateNo as varchar(10)), 4)) where ZEDTAC is null and BatchNo=@BatchNo and isnull(W,0)>= 42.00 AND isnull(P,0)>= 28.00
				END

				update Candidates set ZEDTAC=NULL where BatchNo=@BatchNo and (isnull(W,0)< 42.00 OR isnull(P,0)< 28.00)

END

GO
/****** Object:  StoredProcedure [dbo].[SP_ZEDTAC_VIEW_QUESTIONS]    Script Date: 10/21/2026 11:44:38 AM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROC [dbo].[SP_ZEDTAC_VIEW_QUESTIONS] --'<redacted>','<redacted>'
(
	@CandidateId varchar(200) = NULL,
	@BatchNo varchar(200) = NULL
)
AS
BEGIN
	
	DECLARE @QpCode varchar(50) = NULL
	DECLARE @AssessmentStatus int = 0
	select @QpCode=CASE WHEN QpCode='ZED/TP18' THEN 'MasterTrainer' WHEN QpCode='ZED/TP19' THEN 'Assessor' WHEN QpCode='ZED/TP20' THEN 'ZedConsultant' END  from Batches where BatchNo=@BatchNo


		
	select distinct SectionCode,SectionName from ZedTacQuestions where QuestionniareCategory=@QpCode order by SectionCode

	select Q.SectionCode, SectionName, OrderNo, Q.QuestionCode, QuestionName QuestionText, AnswerCode, AnswerText, case when AnswerCode=CorrectAnswer then 'Correct' else 'Wrong' end as Result 
	from ZedTacQuestions Q left join ZedTacSelfAssessmentQuestions S on (q.QuestionCode=S.QuestionCode and CandidateId=@CandidateId)  where QuestionniareCategory=@QpCode order by OrderNo

	select O.SectionCode, O.QuestionCode, OptionCode, OptionName from ZedTacOptions O inner join ZedTacQuestions Q on (O.QuestionCode=Q.QuestionCode and O.QuestionnaireName=Q.QuestionniareCategory) where  QuestionniareCategory=@QpCode and O.QuestionnaireName=@QpCode order by OptionCode

	select B.*, QpName from Batches B INNER JOIN JobRoles J ON (B.QpCode=J.QpCode) where BatchNo=@BatchNo
	SELECT * FROM Candidates where CandidateId=@CandidateId and BatchNo=@BatchNo
	
END

GO
