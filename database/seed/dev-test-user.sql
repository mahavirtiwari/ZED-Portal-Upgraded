-- LOCAL DEVELOPMENT ONLY. Creates an MSME login for testing the new portal against the
-- empty schema built by setup.ps1. Never run this against production.
USE [ZEDCS_V2_LIVE];
IF NOT EXISTS (SELECT 1 FROM Users WHERE UserId = 'ZEDMSMEDEV001')
    INSERT INTO Users (UserId, Password, UserName, RoleId, IsActive, Email, MobileNo, StateCode, DistrictCode, CreatedBy, CreatedDate)
    VALUES ('ZEDMSMEDEV001', 'Dev#Test2026', 'DEV TEST ENTERPRISE', 5, 1, 'dev.test@example.test', '9999999999', '9', '160', 'seed', GETDATE());

-- Enterprise rows for the test user, so the mobile app login (SP_APP_MSME_CHECK_LOGIN) works too.
IF NOT EXISTS (SELECT 1 FROM Msme WHERE ZedId = 'ZEDMSMEDEV001')
    INSERT INTO Msme (ZedId, PUnitName, PledgeEmailId, RegistrationFrom, StateId, CreatedDate)
    VALUES ('ZEDMSMEDEV001', 'DEV TEST UNIT', 'dev.test@example.test', 'Portal', 9, GETDATE());
IF NOT EXISTS (SELECT 1 FROM MsmeBasicInformation WHERE ZedId = 'ZEDMSMEDEV001')
    INSERT INTO MsmeBasicInformation (ZedId, EnterpriseName, OwnerName, EnterpriseType, MobileNo, EmailId)
    VALUES ('ZEDMSMEDEV001', 'DEV TEST ENTERPRISE', 'Dev Tester', 'Micro', '9999999999', 'dev.test@example.test');
