import { SQLDialect } from "@codemirror/lang-sql";

export const CASSANDRA_KEYWORDS = [
  "select", "from", "where", "and", "or", "not", "in", "is", "null", "limit", "allow", "filtering",
  "order", "by", "asc", "desc", "group", "per", "partition", "token", "writetime", "ttl",
  "insert", "into", "values", "update", "set", "delete", "if", "exists",
  "create", "alter", "drop", "table", "keyspace", "index", "type", "materialized", "view", "function", "aggregate",
  "primary", "key", "with", "clustering", "compact", "storage", "options", "replication", "durable_writes",
  "use", "begin", "batch", "apply", "unlogged", "counter", "static",
  "truncate", "grant", "revoke", "role", "user", "permission", "list",
  "as", "to", "of", "on", "using", "case", "when", "then", "else", "end",
  "true", "false"
];

export const CASSANDRA_TYPES = [
  "ascii", "bigint", "blob", "boolean", "counter", "date", "decimal", "double",
  "duration", "float", "frozen", "inet", "int", "list", "map", "set", "smallint",
  "text", "time", "timestamp", "timeuuid", "tinyint", "tuple", "uuid", "varchar", "varint"
];

export const CASSANDRA_FUNCTIONS = [
  "count", "min", "max", "avg", "sum", "now", "uuid", "tounixtimestamp", "totimestamp",
  "todate", "dateof", "unixtimestampof", "blobasbigint", "blobastext", "textasblob",
  "writetime", "ttl", "token", "fromjson", "tojson", "cast"
];

export const cassandraDialect = SQLDialect.define({
  keywords: CASSANDRA_KEYWORDS.join(" "),
  types: CASSANDRA_TYPES.join(" "),
  builtin: CASSANDRA_FUNCTIONS.join(" "),
  hashComments: false,
  slashComments: true,
  doubleDollarQuotedStrings: false,
  operatorChars: "*+-/<>!=",
  identifierQuotes: '"'
});
