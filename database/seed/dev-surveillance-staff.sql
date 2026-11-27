-- LOCAL DEVELOPMENT ONLY: staff logins of the surveillance portal for a UI walkthrough on the throwaway ZEDV4CHK_ set
--   (database\setup.ps1 -DatabasePrefix ZEDV4CHK_ ..., see dev-walkthrough-guide.sql). Run with sqlcmd -d ZEDV4CHK_ZED_SURVEILLANCE.
-- Never run this against the test server or production.
-- Test logins (throwaway values for the local walkthrough only), same password as dev-walkthrough-guide.sql:
--   SMADMINX (surveillance Master Admin), SAGENCYX (surveillance agency), SSAX1 (its assessor). Names and numbers are made up.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() NOT LIKE 'ZEDV4CHK[_]%' BEGIN RAISERROR('Only for a ZEDV4CHK_ database.', 16, 1); RETURN; END
DECLARE @Pwd varchar(50) = 'Zedx#Check2026';
BEGIN TRANSACTION;
IF NOT EXISTS (SELECT 1 FROM dbo.Roles)
    INSERT dbo.Roles (RoleId, Role, IsActive) VALUES (1, 'Admin', 1), (2, 'Agency', 1), (3, 'Assessor', 1), (4, 'QC', 1), (5, 'MSME', 1),
        (6, 'Ministry', 1), (7, 'MasterAdmin', 1);
DELETE FROM dbo.Users WHERE UserId IN ('SMADMINX', 'SAGENCYX', 'SSAX1');
INSERT dbo.Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, CreatedBy, CreatedDate, StateCode, DesktopVerification,
                  SiteVerification, FinancialVerification, AllowBronzeSurveillance, SectorActivity, AssessmentModes) VALUES
 ('SMADMINX', @Pwd, 'Master Admin (surveillance walkthrough)', 7, 1, 'smadmin@example.test', '9999992001', 'seed', GETDATE(), NULL, 1, 1, 1, NULL, NULL, NULL),
 ('SAGENCYX', @Pwd, 'Sample Surveillance Agency Pvt Ltd', 2, 1, 'sagency@example.test', '9999992002', 'SMADMINX', GETDATE(), '9', 1, 1, 0, 1, 'Manufacturing', NULL),
 ('SSAX1',    @Pwd, 'Surveillance Assessor One', 3, 1, 'ssa1@example.test', '9999992003', 'SAGENCYX', GETDATE(), NULL, 0, 1, 0, NULL, 'Manufacturing', NULL);
COMMIT;
PRINT 'Surveillance walkthrough logins: SMADMINX, SAGENCYX, SSAX1.';
