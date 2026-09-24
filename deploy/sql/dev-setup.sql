-- Creates the dev + test databases and the login used by the Windows dev machine.
-- Idempotent. Normally run by apps/api/scripts/setup-dev-db.mjs, which passes the password
-- as the sqlcmd variable DEV_DB_PASSWORD. Manual run:
--   sqlcmd -S <host> -U sa -C -v DEV_DB_PASSWORD="..." -i dev-setup.sql
SET NOCOUNT ON;

IF DB_ID(N'serviceflow_dev') IS NULL CREATE DATABASE serviceflow_dev;
IF DB_ID(N'serviceflow_test') IS NULL CREATE DATABASE serviceflow_test;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'serviceflow_dev')
  CREATE LOGIN serviceflow_dev WITH PASSWORD = N'$(DEV_DB_PASSWORD)', CHECK_POLICY = ON;
ELSE
  ALTER LOGIN serviceflow_dev WITH PASSWORD = N'$(DEV_DB_PASSWORD)';
-- `prisma migrate dev` creates and drops a temporary shadow database.
ALTER SERVER ROLE dbcreator ADD MEMBER serviceflow_dev;
GO

USE serviceflow_dev;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'serviceflow_dev')
  CREATE USER serviceflow_dev FOR LOGIN serviceflow_dev;
ALTER ROLE db_owner ADD MEMBER serviceflow_dev;
GO

USE serviceflow_test;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'serviceflow_dev')
  CREATE USER serviceflow_dev FOR LOGIN serviceflow_dev;
ALTER ROLE db_owner ADD MEMBER serviceflow_dev;
GO

PRINT 'serviceflow dev setup OK';
