-- Deterministic seed data for the Postgres E2E scenarios.
--
-- Applied against the `mordor_e2e` database created by docker-compose.e2e.yml.
-- A single-column primary key keeps the insert/edit/delete write paths simple
-- (the app derives key columns from the table schema; see
-- PostgresService.fetchTableSchema / insertRow / updateRow).

CREATE SCHEMA IF NOT EXISTS app;

DROP TABLE IF EXISTS app.users;
CREATE TABLE app.users (
  id    integer PRIMARY KEY,
  email text NOT NULL,
  name  text,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO app.users (id, email, name, active) VALUES
  (1, 'ada@example.com',   'Ada Lovelace',   true),
  (2, 'alan@example.com',  'Alan Turing',    true),
  (3, 'grace@example.com', 'Grace Hopper',   false);
