\set ON_ERROR_STOP on
\getenv migration_password MIGRATION_DB_PASSWORD
\getenv api_password API_DB_PASSWORD
\getenv worker_password WORKER_DB_PASSWORD
\getenv platform_password PLATFORM_DB_PASSWORD
CREATE ROLE fs_migrator LOGIN PASSWORD :'migration_password' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE fs_api LOGIN PASSWORD :'api_password' NOSUPERUSER NOBYPASSRLS;
-- Background worker (A04): reaches data only through worker.* functions.
CREATE ROLE fs_worker LOGIN PASSWORD :'worker_password' NOSUPERUSER NOBYPASSRLS;
-- Platform console API (C01): reaches data only through padmin.* functions.
CREATE ROLE fs_platform LOGIN PASSWORD :'platform_password' NOSUPERUSER NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE field_service TO fs_migrator;
GRANT CONNECT ON DATABASE field_service TO fs_api;
GRANT CONNECT ON DATABASE field_service TO fs_worker;
GRANT CONNECT ON DATABASE field_service TO fs_platform;
