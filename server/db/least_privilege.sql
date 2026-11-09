-- OPTIONAL but recommended: a restricted database login for the running API.
--
-- The API only ever needs to read and write rows. With this account, even a bug that let an attacker run
-- their own SQL could not DROP tables, change the schema or wipe the database; those need the owner login.
--
-- Use the owner login (e.g. "postgres") for:   npm run db:migrate, db:seed, db:reset
-- Use clouddocs_app for the running API:       DATABASE_URL=postgres://clouddocs_app:YOUR_NEW_PASSWORD@localhost:5432/clouddocs
--
-- Run this ONCE as the owner/superuser, connected to the clouddocs database, AFTER npm run db:migrate.
-- Change the password first!   psql -U postgres -d clouddocs -f db/least_privilege.sql

CREATE ROLE clouddocs_app LOGIN PASSWORD 'CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE clouddocs TO clouddocs_app;
GRANT USAGE ON SCHEMA public TO clouddocs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clouddocs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clouddocs_app;
REVOKE ALL ON schema_migrations FROM clouddocs_app;

-- Tables added by future migrations get the same limited access automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clouddocs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO clouddocs_app;
