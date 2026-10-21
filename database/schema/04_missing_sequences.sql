/*
  04_missing_sequences.sql  -  LOCAL STAND-INS, NOT FROM PRODUCTION.

  The SSMS 'Generate Scripts' output did not include SEQUENCE objects, but procedures use
  NEXT VALUE FOR <seq>. Without them those procedures compile but fail at runtime
  (Msg 208 Invalid object name). This file creates every sequence referenced by NEXT VALUE FOR
  in each script (including references inside comments - harmless) as
  BIGINT START WITH 1 INCREMENT BY 1.

  The real definitions (data type, START/current value, CACHE) must be taken from production:
    SELECT name, TYPE_NAME(system_type_id), start_value, increment, current_value, is_cached, cache_size
    FROM sys.sequences;

  Run from any database (uses <db>.sys.sp_executesql). Idempotent.
*/
SET NOCOUNT ON;

-- ZEDCS_V2_LIVE: 12 sequence(s)
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.AssessorsSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[AssessorsSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.BodiesSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[BodiesSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.CertificateSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[CertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.EvidenceIdSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[EvidenceIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.FinancialIdSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[FinancialIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.InvoiceNumberSeq', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[InvoiceNumberSeq] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.MsmeIdSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[MsmeIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.PaymentSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[PaymentSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.RefIdSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[RefIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.SaCertificateSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[SaCertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.Seq_Zed_Invoice_Number', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[Seq_Zed_Invoice_Number] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.WebinarCertificateSequence', N'SO') IS NULL EXEC [ZEDCS_V2_LIVE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[WebinarCertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';

-- ZED_CONSULTANT: 9 sequence(s)
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.AssessorsSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[AssessorsSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.BodiesSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[BodiesSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.CertificateSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[CertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.EvidenceIdSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[EvidenceIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.FinancialIdSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[FinancialIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.MsmeIdSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[MsmeIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.PaymentSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[PaymentSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.SaCertificateSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[SaCertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.WebinarCertificateSequence', N'SO') IS NULL EXEC [ZED_CONSULTANT].sys.sp_executesql N'CREATE SEQUENCE [dbo].[WebinarCertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';

-- ZED_SURVEILLANCE: 9 sequence(s)
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.AssessorsSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[AssessorsSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.BodiesSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[BodiesSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.CertificateSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[CertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.EvidenceIdSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[EvidenceIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.FinancialIdSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[FinancialIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.MsmeIdSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[MsmeIdSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.PaymentSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[PaymentSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.SaCertificateSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[SaCertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';
IF OBJECT_ID(N'ZED_SURVEILLANCE.dbo.WebinarCertificateSequence', N'SO') IS NULL EXEC [ZED_SURVEILLANCE].sys.sp_executesql N'CREATE SEQUENCE [dbo].[WebinarCertificateSequence] AS bigint START WITH 1 INCREMENT BY 1;';
GO
