-- Run on ZEDCS_V2_LIVE. Additive and safe to re-run.
-- Admin → Incentives: where an incentive appears on the MSME's side, as new columns of the existing dbo.Incentives:
--   DisplayOn      'Dashboard' = its own card in "My Incentives" of the MSME dashboard;
--                  NULL or 'Card' = listed inside its stakeholder card (Ministry of MSME, States/UTs, Financial
--                  Institutions, Other), as before V4;
--   CardHighlight  the coloured line of the dashboard card (e.g. "Rs. 10,000/-");
--   DashboardCard  the built-in cards of "My Incentives" whose buttons the portal drives (KAWACH, JOINING_REWARD,
--                  FINANCIAL_ASSISTANCE, HANDHOLDING, TECHNOLOGY_UPGRADATION): the Admin edits their title and text
--                  and shows or hides them (ActiveStatus).
-- The five built-in cards are added once, with IncentiveType 'Dashboard', so that the legacy procedures
-- (SP_GET_INCENTIVES, SP_MASTER_GET_INCENTIVES, which read the types Common, Other, Financial and the state names) and
-- the old site never list them. The legacy procedures are not changed; they read the table with SELECT *.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Incentives', 'DisplayOn') IS NULL ALTER TABLE dbo.Incentives ADD DisplayOn varchar(20) NULL;
IF COL_LENGTH('dbo.Incentives', 'CardHighlight') IS NULL ALTER TABLE dbo.Incentives ADD CardHighlight nvarchar(300) NULL;
IF COL_LENGTH('dbo.Incentives', 'DashboardCard') IS NULL ALTER TABLE dbo.Incentives ADD DashboardCard varchar(30) NULL;
GO
IF OBJECT_ID('dbo.CK_Incentives_DisplayOn', 'C') IS NULL
    ALTER TABLE dbo.Incentives WITH CHECK ADD CONSTRAINT CK_Incentives_DisplayOn CHECK (DisplayOn IS NULL OR DisplayOn IN ('Dashboard', 'Card'));
-- No filtered index on DashboardCard: the legacy procedures may run with QUOTED_IDENTIFIER OFF, and their INSERTs into
-- the table would then fail (error 1934). Each card is added once below; V4 never inserts with a DashboardCard.
GO
-- The built-in cards, with the wording the dashboard showed before V4 (only those not there yet).
INSERT INTO dbo.Incentives (IncentiveType, DashboardCard, DisplayOn, Incentive, CardHighlight, Details, OrderNo,
                            ApplicableForBronze, ApplicableForSilver, ApplicableForGold, ActiveStatus)
SELECT 'Dashboard', c.Card, 'Dashboard', c.Title, c.Highlight, c.Details, c.OrderNo, 1, 1, 1, 1
FROM (VALUES
    ('KAWACH', 'MSME KAWACH', N'Free (₹ 5,750 + Taxes, 100% Subsidized)', 'WASH Certification on Safety & Hygiene', 1),
    ('JOINING_REWARD', 'Joining Reward', N'Rs. 10,000/-', 'Limited purpose reward, linked with ZED Certification Levels', 2),
    ('FINANCIAL_ASSISTANCE', 'Financial Assistance', N'75% of Subsidy (Max. Rs. 50,000/-)', 'For System Certification or Product Certification or Product Testing', 3),
    ('HANDHOLDING', 'Handholding Support', N'Cost: Rs. 2,00,000/- (Subsidy as per MSME size)', 'for improving systems and processes', 4),
    ('TECHNOLOGY_UPGRADATION', 'Technology Upgradation', N'Support of upto Rs. 3,00,000/-', 'for moving towards Zero Effect Solutions', 5)
) AS c (Card, Title, Highlight, Details, OrderNo)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Incentives i WHERE i.DashboardCard = c.Card);
GO
