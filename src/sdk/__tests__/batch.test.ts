import { describe, it, expect } from "bun:test";
import { runBatch, resolveStepRef, resolveStepArgs, type BatchStepResult } from "../batch.ts";
import { createClient } from "../client.ts";

function makeClient() {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(JSON.stringify({ data: [{ gid: "ws1", name: "Test" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const client = createClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
  return { client, server };
}

describe("resolveStepRef", () => {
  const results: BatchStepResult[] = [
    { ok: true, command: "add", result: { id: "task123", name: "My Task" } },
  ];

  it("returns literal string unchanged", () => {
    expect(resolveStepRef("hello", results)).toBe("hello");
  });

  it("resolves $steps.0.result.id", () => {
    expect(resolveStepRef("$steps.0.result.id", results)).toBe("task123");
  });

  it("throws BATCH_PLAN_INVALID for out-of-range index", () => {
    expect(() => resolveStepRef("$steps.5.result.id", results)).toThrow();
  });

  it("throws BATCH_PLAN_INVALID for missing path", () => {
    expect(() => resolveStepRef("$steps.0.result.missing.deep", results)).toThrow();
  });
});

describe("resolveStepArgs", () => {
  const results: BatchStepResult[] = [
    { ok: true, command: "add", result: { id: "task123" } },
  ];

  it("resolves nested object with ref values", () => {
    const input = { name: "Sub", parent: "$steps.0.result.id" };
    const resolved = resolveStepArgs(input, results) as Record<string, unknown>;
    expect(resolved.parent).toBe("task123");
    expect(resolved.name).toBe("Sub");
  });

  it("resolves refs in arrays", () => {
    const input = ["$steps.0.result.id", "literal"];
    const resolved = resolveStepArgs(input, results) as unknown[];
    expect(resolved[0]).toBe("task123");
    expect(resolved[1]).toBe("literal");
  });

  it("returns non-string primitives unchanged", () => {
    expect(resolveStepArgs(42, results)).toBe(42);
    expect(resolveStepArgs(true, results)).toBe(true);
    expect(resolveStepArgs(null, results)).toBe(null);
  });
});

describe("runBatch", () => {
  it("runs all steps and collects results", async () => {
    const { client, server } = makeClient();
    const results = await runBatch(
      client,
      [
        { command: "add", args: { name: "Task A" } },
        { command: "complete", args: { ref: "task123" } },
      ],
      async (_c, command, args) => ({ command, args }),
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(true);
    await server.stop();
  });

  it("stops on first error when stopOnError is true", async () => {
    const { client, server } = makeClient();
    const results = await runBatch(
      client,
      [
        { command: "step1", args: {} },
        { command: "fail", args: {} },
        { command: "step3", args: {} },
      ],
      async (_c, command) => {
        if (command === "fail") throw new Error("Intentional failure");
        return { command };
      },
      { stopOnError: true },
    );
    expect(results).toHaveLength(2); // step3 was not executed
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    await server.stop();
  });

  it("continues after failure when stopOnError is false", async () => {
    const { client, server } = makeClient();
    const results = await runBatch(
      client,
      [
        { command: "step1", args: {} },
        { command: "fail", args: {} },
        { command: "step3", args: {} },
      ],
      async (_c, command) => {
        if (command === "fail") throw new Error("fail");
        return {};
      },
      { stopOnError: false },
    );
    expect(results).toHaveLength(3);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[2]?.ok).toBe(true);
    await server.stop();
  });

  it("propagates $steps references between steps", async () => {
    const { client, server } = makeClient();
    let receivedParent: unknown;
    const results = await runBatch(
      client,
      [
        { command: "add", args: { name: "Parent" } },
        { command: "subtask-add", args: { parent: "$steps.0.result.gid", name: "Sub" } },
      ],
      async (_c, command, args) => {
        if (command === "subtask-add") receivedParent = args.parent;
        return { gid: "created123", command };
      },
    );
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(true);
    expect(receivedParent).toBe("created123");
    await server.stop();
  });
});
