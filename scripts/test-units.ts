// Small unit checks for the security-sensitive helpers. No test framework: plain asserts.
// Usage: npm run test:unit   (exit code 1 on the first failed check)

import assert from "node:assert/strict";
import { canSendToken } from "../lib/agent/mcpClient";
import { allowRequest, MAX_TRACKED_KEYS } from "../lib/rateLimit";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const NO_VERCEL = {
  VERCEL_URL: undefined,
  VERCEL_BRANCH_URL: undefined,
  VERCEL_PROJECT_PRODUCTION_URL: undefined,
  MCP_URL: undefined,
};

// canSendToken(target, incoming request URL)
check("localhost, 127.0.0.1 and [::1] get the token when the host matches", () => {
  withEnv(NO_VERCEL, () => {
    assert.equal(canSendToken("http://localhost:3000/api/mcp", "http://localhost:3000/api/chat"), true);
    assert.equal(canSendToken("http://127.0.0.1:3100/api/mcp", "http://127.0.0.1:3100/api/chat"), true);
    assert.equal(canSendToken("http://[::1]:3000/api/mcp", "http://[::1]:3000/api/chat"), true);
  });
});

check("the deployment's own Vercel hosts get the token", () => {
  withEnv(
    {
      ...NO_VERCEL,
      VERCEL_URL: "duly-abc123-team.vercel.app",
      VERCEL_BRANCH_URL: "https://duly-git-feat-team.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "duly.vercel.app",
    },
    () => {
      for (const host of ["duly-abc123-team.vercel.app", "duly-git-feat-team.vercel.app", "duly.vercel.app"]) {
        assert.equal(canSendToken(`https://${host}/api/mcp`, `https://${host}/api/chat`), true, host);
      }
    },
  );
});

check("another *.vercel.app host does not get the token", () => {
  withEnv({ ...NO_VERCEL, VERCEL_URL: "duly.vercel.app" }, () => {
    const other = "https://someone-else.vercel.app";
    assert.equal(canSendToken(`${other}/api/mcp`, `${other}/api/chat`), false);
  });
});

check("a target host different from the request host does not get the token", () => {
  withEnv({ ...NO_VERCEL, VERCEL_URL: "duly.vercel.app" }, () => {
    assert.equal(canSendToken("https://duly.vercel.app/api/mcp", "http://localhost:3000/api/chat"), false);
    assert.equal(canSendToken("http://localhost:3100/api/mcp", "http://localhost:3000/api/chat"), false);
  });
});

check("MCP_URL no longer extends the allowlist", () => {
  withEnv({ ...NO_VERCEL, MCP_URL: "https://mcp.example.com/api/mcp" }, () => {
    assert.equal(canSendToken("https://mcp.example.com/api/mcp", "https://mcp.example.com/api/chat"), false);
  });
});

// Rate limiter
check("a request over the limit is refused", () => {
  assert.equal(allowRequest("unit-limit", "1.1.1.1", 2), true);
  assert.equal(allowRequest("unit-limit", "1.1.1.1", 2), true);
  assert.equal(allowRequest("unit-limit", "1.1.1.1", 2), false);
});

check("the tracked keys never exceed the cap, and the oldest are evicted first", () => {
  // Fill past the cap with distinct keys, all inside the same minute (none is expired).
  for (let i = 0; i < MAX_TRACKED_KEYS + 500; i++) allowRequest("unit-flood", `ip-${i}`, 1);
  // The newest key is still tracked (a second hit is refused with limit 1)...
  assert.equal(allowRequest("unit-flood", `ip-${MAX_TRACKED_KEYS + 499}`, 1), false);
  // ...and the oldest was evicted (it starts counting from zero again).
  assert.equal(allowRequest("unit-flood", "ip-0", 1), true);
});

console.log(`\n${passed} checks passed.`);
