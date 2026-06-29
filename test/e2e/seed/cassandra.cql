-- Deterministic seed data for the Cassandra E2E scenarios.
--
-- Applied against the single-node cluster from docker-compose.e2e.yml. The
-- keyspace/table give the connect → browse → insert → edit → delete walk a
-- stable target. Key columns are derived by CassandraService.fetchTableSchema;
-- `id` is the partition key so insert/update/delete only need that value.

CREATE KEYSPACE IF NOT EXISTS app
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

DROP TABLE IF EXISTS app.users;
CREATE TABLE app.users (
  id    int PRIMARY KEY,
  email text,
  name  text,
  active boolean
);

INSERT INTO app.users (id, email, name, active) VALUES (1, 'ada@example.com',   'Ada Lovelace', true);
INSERT INTO app.users (id, email, name, active) VALUES (2, 'alan@example.com',  'Alan Turing',  true);
INSERT INTO app.users (id, email, name, active) VALUES (3, 'grace@example.com', 'Grace Hopper', false);
