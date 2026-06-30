// Test stub for the optional `ssh2` runtime dependency.
//
// `ssh2` is a real production dependency (package.json) loaded lazily via a
// dynamic `import("ssh2")` in `src/main/ssh/SshTunnel.ts`, but it is NOT
// installed in the test/CI environment (no native build). Vite still has to
// *resolve* the dynamic import when it walks the module graph for any test that
// transitively imports the main handler chain, so vitest.config aliases `ssh2`
// to this stub. Individual SshTunnel tests override behaviour with `vi.mock`.
export class Client {
  connect(): this {
    throw new Error("ssh2 stub: connect() not implemented — mock it in the test.");
  }
  on(): this {
    return this;
  }
  once(): this {
    return this;
  }
  forwardOut(): this {
    return this;
  }
  end(): this {
    return this;
  }
}
