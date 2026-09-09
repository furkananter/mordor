/**
 * Ready-made benchmark scenarios.
 *
 * The point of a template is the *shape* of the workload and its tuning, not
 * the literal CQL: which query patterns are worth measuring before and after a
 * schema change, and at what repeat/concurrency each one produces a stable
 * number. Table names are filled in from the connected cluster's schema; the
 * parts only the user can know — which partition key value to hit, which
 * columns to insert — are left as `<angle_bracket>` placeholders for them to
 * replace in the step editor.
 *
 * Concurrency figures are deliberately modest: they measure the schema, not
 * the machine. Enough in-flight requests to keep the coordinator busy, few
 * enough that a laptop-sized cluster isn't the bottleneck.
 */

export interface BenchmarkTemplateTarget {
  keyspace: string;
  table: string;
}

export interface BenchmarkTemplateStep {
  cql: string;
  repeat: number;
  concurrency: number;
}

export interface BenchmarkTemplate {
  id: string;
  name: string;
  description: string;
  /**
   * Steps mutate data, so the scenario only runs with the Write or All query
   * mode. `normalizeQuery` enforces this per execution; the flag exists so the
   * UI can warn before the user builds a scenario they can't run.
   */
  mutates: boolean;
  buildSteps(target: BenchmarkTemplateTarget): BenchmarkTemplateStep[];
}

/** Matches the `<name>` placeholders templates leave behind for the user. */
const PLACEHOLDER_PATTERN = /<[a-z_]+>/;

export function hasUnfilledPlaceholder(cql: string): boolean {
  return PLACEHOLDER_PATTERN.test(cql);
}

export const BENCHMARK_TEMPLATES: BenchmarkTemplate[] = [
  {
    id: "point-read",
    name: "Point read",
    description:
      "Single-partition SELECT, the latency baseline. The number most schema changes actually move.",
    mutates: false,
    buildSteps: ({ keyspace, table }) => [
      {
        cql: `SELECT * FROM ${keyspace}.${table} WHERE <partition_key> = <value> LIMIT 1`,
        repeat: 500,
        concurrency: 32,
      },
    ],
  },
  {
    id: "partition-scan",
    name: "Wide-partition scan",
    description:
      "Reads a whole partition. This is what partition/clustering-key redesigns move the most.",
    mutates: false,
    buildSteps: ({ keyspace, table }) => [
      {
        // The LIMIT is explicit because the query path appends one anyway —
        // better the user sees the cap they are measuring against.
        cql: `SELECT * FROM ${keyspace}.${table} WHERE <partition_key> = <value> LIMIT 1000`,
        repeat: 100,
        concurrency: 8,
      },
    ],
  },
  {
    id: "full-scan",
    name: "Full scan (LIMIT 1000)",
    description:
      "Unfiltered read across partitions — coordinator and range-scan cost. Runs as-is, no editing needed.",
    mutates: false,
    buildSteps: ({ keyspace, table }) => [
      {
        cql: `SELECT * FROM ${keyspace}.${table} LIMIT 1000`,
        repeat: 50,
        concurrency: 4,
      },
    ],
  },
  {
    id: "write-throughput",
    name: "Write throughput",
    description:
      "INSERT-only load: ops/sec and write p99. Needs Write or All query mode. Repeating one key upserts the same row — vary the key to spread partitions.",
    mutates: true,
    buildSteps: ({ keyspace, table }) => [
      {
        cql: `INSERT INTO ${keyspace}.${table} (<columns>) VALUES (<values>)`,
        repeat: 500,
        concurrency: 32,
      },
    ],
  },
  {
    id: "mixed-read-write",
    name: "Mixed read/write",
    description:
      "Writes then reads, the way the app actually behaves. Needs Write or All query mode.",
    mutates: true,
    buildSteps: ({ keyspace, table }) => [
      {
        cql: `INSERT INTO ${keyspace}.${table} (<columns>) VALUES (<values>)`,
        repeat: 200,
        concurrency: 16,
      },
      {
        cql: `SELECT * FROM ${keyspace}.${table} WHERE <partition_key> = <value> LIMIT 1`,
        repeat: 500,
        concurrency: 32,
      },
    ],
  },
];

export function findBenchmarkTemplate(id: string): BenchmarkTemplate | undefined {
  return BENCHMARK_TEMPLATES.find((template) => template.id === id);
}

/**
 * Picks the table a new templated scenario should point at: the first table of
 * the first keyspace that has one. The renderer's schema already excludes
 * system keyspaces, so the first hit is a user table. With nothing connected
 * (or an empty cluster) the target degrades to placeholders, which the step
 * editor shows the same way as the rest.
 */
export function templateTargetFromSchema(
  keyspaces: Array<{ name: string; tables: Array<{ name: string }> }>,
): BenchmarkTemplateTarget {
  for (const keyspace of keyspaces) {
    const [firstTable] = keyspace.tables;
    if (firstTable) {
      return { keyspace: keyspace.name, table: firstTable.name };
    }
  }
  return { keyspace: "<keyspace>", table: "<table>" };
}
