-- New in V4. Run on ZEDCS_V2_LIVE. The incentive upload looks up existing rows by Udyam number to skip
-- rows that were uploaded before (Features/Staff/Schemes/IncentivesController.DuplicateSql).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ApiIncentives') AND name = 'IX_ApiIncentives_UdyamNo')
CREATE INDEX IX_ApiIncentives_UdyamNo ON dbo.ApiIncentives (UdyamNo) INCLUDE (ApplicationId, ApprovalId, DisbursedDate, DisbursedAmount, CreatedDate);
GO
