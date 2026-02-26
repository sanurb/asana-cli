import { describe, it, expect } from "bun:test";
import { resolveTaskRef, resolveProjectRef } from "../refs.ts";
import { createClient } from "../client.ts";
import type { AsanaTask } from "../types.ts";

function makeTaskStub(tasks: AsanaTask[], workspaceGid = "ws1") {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      // GID lookup
      const taskMatch = url.pathname.match(/^\/tasks\/(\d+)$/);
      if (taskMatch) {
        const task = tasks.find((t) => t.gid === taskMatch[1]);
        if (!task) {
          return new Response(JSON.stringify({ errors: [{ message: "Task not found" }] }), {
            status: 404, headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ data: task }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      // My tasks list
      if (url.pathname === "/tasks") {
        return new Response(JSON.stringify({ data: tasks }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      // Workspace
      if (url.pathname === "/workspaces") {
        return new Response(JSON.stringify({ data: [{ gid: workspaceGid, name: "Test WS" }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
}

const TASKS: AsanaTask[] = [
  { gid: "111", name: "Buy milk" },
  { gid: "222", name: "Deploy to production" },
  { gid: "333", name: "Deploy staging first" },
];

describe("resolveTaskRef", () => {
  it("resolves by raw GID", async () => {
    const server = makeTaskStub(TASKS);
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    const task = await resolveTaskRef(client, "111");
    expect(task.gid).toBe("111");
    await server.stop();
  });

  it("resolves by id: prefix", async () => {
    const server = makeTaskStub(TASKS);
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    const task = await resolveTaskRef(client, "id:222");
    expect(task.gid).toBe("222");
    await server.stop();
  });

  it("resolves by Asana URL", async () => {
    const server = makeTaskStub(TASKS);
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    const task = await resolveTaskRef(client, "https://app.asana.com/0/0/111/f");
    expect(task.gid).toBe("111");
    await server.stop();
  });

  it("resolves by exact name", async () => {
    const server = makeTaskStub(TASKS);
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    const task = await resolveTaskRef(client, "Buy milk");
    expect(task.gid).toBe("111");
    await server.stop();
  });

  it("resolves by partial name (single match)", async () => {
    const server = makeTaskStub(TASKS);
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    const task = await resolveTaskRef(client, "Buy");
    expect(task.gid).toBe("111");
    await server.stop();
  });

  it("throws AMBIGUOUS_REF for partial name with multiple matches", async () => {
    const server = makeTaskStub(TASKS);
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    await expect(resolveTaskRef(client, "Deploy")).rejects.toMatchObject({
      code: "AMBIGUOUS_REF",
    });
    await server.stop();
  });

  it("throws NOT_FOUND for unknown name", async () => {
    const server = makeTaskStub(TASKS);
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    await expect(resolveTaskRef(client, "Nonexistent Task")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await server.stop();
  });

  it("throws INVALID_INPUT for empty ref", async () => {
    const server = makeTaskStub(TASKS);
    const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    await expect(resolveTaskRef(client, "")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await server.stop();
  });
});
