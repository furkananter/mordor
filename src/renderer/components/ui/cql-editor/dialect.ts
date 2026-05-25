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

// PostgreSQL-flavored dialect. Diverges from CodeMirror's bundled PostgreSQL
// dialect on a few small things so it lines up with what users actually type:
//   - doubleDollarQuotedStrings: pg's `$body$ ... $body$` and `$$ ... $$`
//   - hashComments: psql's `#` meta-commands are not SQL but we leave them off
//   - operatorChars includes `~` (regex match) and `?` (jsonb existence)
// The keyword/type/function lists below cover the surface area we expect
// dev-workbench users to touch — not exhaustive, but enough that pg-specific
// statements (RETURNING, ON CONFLICT, jsonb_*, etc.) don't get flagged.
export const POSTGRES_KEYWORDS = [
  // DML
  "select", "from", "where", "and", "or", "not", "in", "is", "null", "limit", "offset",
  "order", "by", "asc", "desc", "group", "having", "distinct", "all", "any", "some", "exists",
  "union", "intersect", "except", "with", "recursive",
  "insert", "into", "values", "default", "returning",
  "update", "set", "from",
  "delete",
  "on", "conflict", "do", "nothing",
  // Joins
  "join", "left", "right", "inner", "outer", "full", "cross", "lateral", "using", "natural",
  // DDL
  "create", "alter", "drop", "rename", "table", "schema", "view", "materialized", "index",
  "sequence", "function", "procedure", "trigger", "policy", "extension", "type", "domain",
  "if", "exists", "cascade", "restrict", "concurrently", "temp", "temporary", "unlogged",
  "primary", "key", "unique", "references", "foreign", "check", "default", "constraint",
  "column", "add", "alter", "drop", "rename", "to", "as",
  // Tx
  "begin", "commit", "rollback", "savepoint", "release", "transaction", "isolation", "level",
  "read", "write", "only", "serializable", "repeatable",
  // PL/pgSQL bits commonly typed inline
  "declare", "return", "returns", "language", "perform", "raise", "notice", "exception",
  "loop", "while", "case", "when", "then", "else", "end", "for",
  // Misc
  "true", "false", "between", "like", "ilike", "similar"
];

export const POSTGRES_TYPES = [
  "boolean", "bool", "smallint", "int2", "integer", "int", "int4", "bigint", "int8",
  "decimal", "numeric", "real", "float4", "double", "precision", "float8",
  "serial", "bigserial", "smallserial",
  "text", "varchar", "char", "character", "citext",
  "bytea",
  "date", "time", "timestamp", "timestamptz", "interval",
  "uuid", "inet", "cidr", "macaddr",
  "json", "jsonb",
  "xml",
  "money",
  "tsvector", "tsquery",
  "point", "line", "lseg", "box", "path", "polygon", "circle",
  "array"
];

export const POSTGRES_FUNCTIONS = [
  "count", "sum", "avg", "min", "max", "string_agg", "array_agg", "json_agg", "jsonb_agg",
  "coalesce", "nullif", "greatest", "least",
  "now", "current_timestamp", "current_date", "current_time", "current_user",
  "date_trunc", "date_part", "extract", "age",
  "lower", "upper", "initcap", "length", "char_length", "trim", "ltrim", "rtrim",
  "substring", "position", "replace", "split_part", "regexp_replace", "regexp_match",
  "to_char", "to_date", "to_timestamp", "to_number",
  "jsonb_set", "jsonb_build_object", "jsonb_array_elements", "jsonb_each",
  "row_number", "rank", "dense_rank", "lag", "lead", "first_value", "last_value",
  "generate_series", "unnest"
];

export const postgresDialect = SQLDialect.define({
  keywords: POSTGRES_KEYWORDS.join(" "),
  types: POSTGRES_TYPES.join(" "),
  builtin: POSTGRES_FUNCTIONS.join(" "),
  hashComments: false,
  slashComments: false,
  doubleDollarQuotedStrings: true,
  operatorChars: "*+-/<>!=~?|&%^@",
  identifierQuotes: '"'
});
