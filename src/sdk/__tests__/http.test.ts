import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createRequestFn, paginate } from "../http.ts";
import { SdkError } from "../errors.ts";

// ── Stub server helpers ───────────────────────────────────────────────

type StubRoute = {
  method: string;
  path: string;
  status: number;
  body: unknown;
};

function startStub(routes: StubRoute[]): { baseUrl: string; server: ReturnType<typeof Bun.serve> } {
  const server = Bun.serve({
    port: 0, // random available port
    fetch(req) {
      const url = new URL(req.url);
      const match = routes.find(
        (r) => r.method === req.method && url.pathname.startsWith(r.path),
      );
      if (!match) {
        return new Response(JSON.stringify({ errors: [{ message: "Not found" }] }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(match.body), {
        status: match.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { baseUrl: `http://localhost:${server.port}`, server };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("createRequestFn", () => {
  it("wraps body in { data: ... } automatically", async () => {
    let receivedBody: unknown;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.json();
        return new Response(JSON.stringify({ data: { gid: "1", name: "test" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const request = createRequestFn("fake-token", `http://localhost:${server.port}`);
    await request("POST", "/tasks", { body: { name: "Test Task" } });
    expect(receivedBody).toEqual({ data: { name: "Test Task" } });
    await server.stop();
  });

  it("returns parsed envelope data", async () => {
    const { baseUrl, server } = startStub([
      { method: "GET", path: "/tasks/123", status: 200, body: { data: { gid: "123", name: "My Task" } } },
    ]);
    const request = createRequestFn("fake-token", baseUrl);
    const result = await request<{ gid: string; name: string }>("GET", "/tasks/123");
    expect(result.data.gid).toBe("123");
    expect(result.data.name).toBe("My Task");
    await server.stop();
  });

  it("throws SdkError with AUTH_MISSING on 401", async () => {
    const { baseUrl, server } = startStub([
      { method: "GET", path: "/tasks/1", status: 401, body: { errors: [{ message: "Not Authorized" }] } },
    ]);
    const request = createRequestFn("bad-token", baseUrl);
    await expect(request("GET", "/tasks/1")).rejects.toMatchObject({
      code: "AUTH_MISSING",
    });
    await server.stop();
  });

  it("throws SdkError with NOT_FOUND on 404", async () => {
    const { baseUrl, server } = startStub([
      { method: "GET", path: "/tasks/999", status: 404, body: { errors: [{ message: "Not found" }] } },
    ]);
    const request = createRequestFn("token", baseUrl);
    await expect(request("GET", "/tasks/999")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await server.stop();
  });

  it("throws SdkError with RATE_LIMITED on 429", async () => {
    const { baseUrl, server } = startStub([
      { method: "GET", path: "/tasks/1", status: 429, body: { errors: [{ message: "Rate limited" }] } },
    ]);
    const request = createRequestFn("token", baseUrl);
    await expect(request("GET", "/tasks/1")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await server.stop();
  });

  it("returns empty envelope for DELETE 204", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(null, { status: 204 });
      },
    });
    const request = createRequestFn("token", `http://localhost:${server.port}`);
    const result = await request("DELETE", "/tasks/123");
    expect(result.data).toBeDefined();
    await server.stop();
  });

  it("throws SdkError on network failure", async () => {
    // Use a port that (very likely) has no server
    const request = createRequestFn("token", "http://localhost:19999");
    await expect(request("GET", "/tasks/1")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});

describe("paginate", () => {
  it("collects multiple pages via offset", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const offset = url.searchParams.get("offset");
        if (!offset) {
          return new Response(
            JSON.stringify({ data: [{ gid: "1" }, { gid: "2" }], next_page: { offset: "page2" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ data: [{ gid: "3" }], next_page: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const request = createRequestFn("token", `http://localhost:${server.port}`);
    const results = await paginate<{ gid: string }>(request, "/tasks");
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.gid)).toEqual(["1", "2", "3"]);
    await server.stop();
  });

  it("respects maxItems limit", async () => {
    const { baseUrl, server } = startStub([
      { method: "GET", path: "/tasks", status: 200, body: { data: [{ gid: "1" }, { gid: "2" }, { gid: "3" }] } },
    ]);
    const request = createRequestFn("token", baseUrl);
    const results = await paginate<{ gid: string }>(request, "/tasks", {}, 2);
    expect(results).toHaveLength(2);
    await server.stop();
  });
});
