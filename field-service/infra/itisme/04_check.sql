-- Read-only: are the KooChang objects and the koochang_billing login ready in $(DB)?
--   sqlcmd ... -v DB=ITISME_TEST -i 04_check.sql
SET NOCOUNT ON;
USE [$(DB)];
PRINT '=== KOOCHANG OBJECTS ===';
SELECT name, type_desc, modify_date FROM sys.objects
WHERE name IN ('sp_NextDocNo','sp_KC_IssueReceipt','sp_KC_IssueCreditNote','sp_KC_Company','KooChangCustomer','CreditNote','CreditNoteDetail')
ORDER BY name;
PRINT '=== LOGIN / USER ===';
SELECT name, is_disabled, default_database_name FROM sys.server_principals WHERE name = 'koochang_billing';
SELECT dp.name AS db_user, p.permission_name, OBJECT_NAME(p.major_id) AS object_name, p.state_desc
FROM sys.database_principals dp LEFT JOIN sys.database_permissions p ON p.grantee_principal_id = dp.principal_id
WHERE dp.name = 'koochang_billing';
SELECT r.name AS role_name FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
JOIN sys.database_principals u ON u.principal_id = m.member_principal_id WHERE u.name = 'koochang_billing';
PRINT '=== COMPANY ROW (header of the PDF) ===';
SELECT COUNT(*) AS company_rows FROM dbo.Company;
PRINT '=== CURRENT MONTH NUMBERS ===';
DECLARE @p varchar(4) = RIGHT(CAST(YEAR(GETDATE()) + 543 AS varchar(4)), 2) + RIGHT('0' + CAST(MONTH(GETDATE()) AS varchar(2)), 2);
SELECT 'IV' AS kind, MAX(DocNo) AS last_no, COUNT(*) AS n FROM dbo.Invoice WHERE DocNo LIKE 'IV' + @p + '%';
SELECT 'R' AS kind, MAX(DocNo) AS last_no, COUNT(*) AS n FROM dbo.Receipt WHERE DocNo LIKE 'R' + @p + '%';
SELECT 'Customers' AS kind, MAX(CustomerID) AS last_no, COUNT(*) AS n FROM dbo.Customer;
