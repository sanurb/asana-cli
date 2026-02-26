import { describe, it, expect } from "bun:test";
import { createClient } from "../client.ts";
import { SdkError } from "../errors.ts";

function makeWorkspaceStub(workspaces: Array<{ gid: string; name: string }>) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/workspaces") {
        return new Response(JSON.stringify({ data: workspaces }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

describe("createClient", () => {
  it("throws SdkError AUTH_MISSING when token is empty", () => {
    expect(() => createClient({ token: "" })).toThrow(SdkError);
    expect(() => createClient({ token: "  " })).toThrow(SdkError);
  });

  it("resolves workspace from lexicographic fallback", async () => {
    const server = makeWorkspaceStub([
      { gid: "200", name: "Zebra Corp" },
      { gid: "100", name: "Alpha Inc" },
    ]);
    const client = createClient({ token: "test-token", baseUrl: `http://localhost:${server.port}` });
    const gid = await client.getWorkspaceGid();
    // Lexicographic fallback: "Alpha Inc" < "Zebra Corp" → gid 100
    expect(gid).toBe("100");
    const ws = await client.getWorkspace();
    expect(ws.source).toBe("fallback");
    await server.stop();
  });

  it("respects explicit workspaceRef GID", async () => {
    const server = makeWorkspaceStub([
      { gid: "200", name: "Zebra Corp" },
      { gid: "100", name: "Alpha Inc" },
    ]);
    const client = createClient({
      token: "test-token",
      baseUrl: `http://localhost:${server.port}`,
      workspaceRef: "200",
    });
    const gid = await client.getWorkspaceGid();
    expect(gid).toBe("200");
    const ws = await client.getWorkspace();
    expect(ws.source).toBe("explicit");
    await server.stop();
  });

  it("throws WORKSPACE_NOT_FOUND for unknown explicit ref", async () => {
    const server = makeWorkspaceStub([{ gid: "100", name: "Alpha Inc" }]);
    const client = createClient({
      token: "test-token",
      baseUrl: `http://localhost:${server.port}`,
      workspaceRef: "999",
    });
    await expect(client.getWorkspaceGid()).rejects.toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
    });
    await server.stop();
  });

  it("throws NO_WORKSPACE when no workspaces exist", async () => {
    const server = makeWorkspaceStub([]);
    const client = createClient({
      token: "test-token",
      baseUrl: `http://localhost:${server.port}`,
    });
    await expect(client.getWorkspaceGid()).rejects.toMatchObject({
      code: "NO_WORKSPACE",
    });
    await server.stop();
  });

  it("caches workspace after first resolution", async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/workspaces") callCount++;
        return new Response(JSON.stringify({ data: [{ gid: "100", name: "A" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    await client.getWorkspaceGid();
    await client.getWorkspaceGid();
    await client.getWorkspaceGid();
    expect(callCount).toBe(1); // Only one API call despite 3 invocations
    await server.stop();
  });
});
