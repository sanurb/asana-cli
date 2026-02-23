import { define } from "gunshi";
import { readFile } from "node:fs/promises";
import { fatal, ok } from "../output.ts";
import { spawn } from "node:child_process";

type BatchStep = {
  readonly command: string;
  readonly args?: Record<string, unknown>;
};

type BatchPlan = {
  readonly steps: readonly BatchStep[];
};

type StepResult = {
  readonly ok: boolean;
  readonly command: string;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly fix?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePlan(raw: string): BatchPlan {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return { steps: parsed as BatchStep[] };
  if (isObject(parsed) && Array.isArray(parsed.steps)) return { steps: parsed.steps as BatchStep[] };
  fatal("Batch plan must be an array of steps or { steps: [...] }.", {
    code: "BATCH_PLAN_INVALID",
    fix: "Use --file with JSON: {\"steps\":[{\"command\":\"add\",\"args\":{\"name\":\"X\"}}]}",
  });
}

function resolvePathRef(expression: string, results: readonly StepResult[]): unknown {
  if (!expression.startsWith("$steps.")) return expression;
  const parts = expression.split(".");
  const index = Number(parts[1]);
  if (!Number.isInteger(index) || index < 0 || index >= results.length) {
    fatal(`Invalid batch reference "${expression}".`, {
      code: "BATCH_PLAN_INVALID",
      fix: "Use references like $steps.0.result.id where step index already exists.",
    });
  }
  let current: unknown = results[index];
  for (let i = 2; i < parts.length; i += 1) {
    const key = parts[i];
    if (!isObject(current) || !(key in current)) {
      fatal(`Batch reference "${expression}" could not be resolved.`, {
        code: "BATCH_PLAN_INVALID",
        fix: "Ensure referenced step succeeds and the target path exists.",
      });
    }
    current = current[key];
  }
  return current;
}

function resolveArgs(input: unknown, results: readonly StepResult[]): unknown {
  if (typeof input === "string") {
    return resolvePathRef(input, results);
  }
  if (Array.isArray(input)) return input.map((x) => resolveArgs(x, results));
  if (isObject(input)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = resolveArgs(v, results);
    return out;
  }
  return input;
}

function toArgv(step: BatchStep, resolvedArgs: Record<string, unknown> | undefined): string[] {
  const argv = step.command.trim().split(/\s+/).filter(Boolean);
  if (!resolvedArgs) return argv;

  for (const [key, value] of Object.entries(resolvedArgs)) {
    if (key === "_") {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) argv.push(String(v));
      continue;
    }
    const flag = `--${key}`;
    if (typeof value === "boolean") {
      if (value) argv.push(flag);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        argv.push(flag, String(item));
      }
      continue;
    }
    argv.push(flag, String(value));
  }
  return argv;
}

async function runStep(argv: string[]): Promise<StepResult> {
  const executable = process.argv[0];
  const script = process.argv[1];
  const args = script ? [script, ...argv] : argv;
  return await new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", () => {
      const combined = (stdout.trim() || stderr.trim());
      try {
        const parsed = JSON.parse(combined) as StepResult;
        resolve(parsed);
      } catch {
        resolve({
          ok: false,
          command: `asana-cli ${argv.join(" ")}`,
          error: { message: combined || "Step did not return parseable JSON", code: "BATCH_STEP_PARSE_ERROR" },
          fix: "Run the failing step directly to inspect output.",
        });
      }
    });
  });
}

export const batch = define({
  name: "batch",
  description: "Execute ordered CLI steps from a JSON plan",
  args: {
    file: {
      type: "string" as const,
      description: "Path to plan JSON file",
      required: true,
    },
    "stop-on-error": {
      type: "boolean" as const,
      description: "Stop at first failed step",
    },
    continue: {
      type: "boolean" as const,
      description: "Continue executing after failed steps",
    },
  },
  run: async (ctx) => {
    const raw = await readFile(String(ctx.values.file), "utf8");
    const plan = parsePlan(raw);
    const results: StepResult[] = [];
    const stopOnError = Boolean(ctx.values["stop-on-error"] || !ctx.values.continue);

    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];
      if (!step || typeof step.command !== "string") {
        fatal(`Invalid batch step at index ${i}.`, {
          code: "BATCH_PLAN_INVALID",
          fix: "Each step must include { command: string, args?: object }.",
        });
      }
      if (step.command.trim().startsWith("batch")) {
        fatal("Nested batch commands are not allowed.", {
          code: "BATCH_PLAN_INVALID",
          fix: "Expand nested operations into top-level steps.",
        });
      }
      const resolvedArgs = resolveArgs(step.args, results) as Record<string, unknown> | undefined;
      const argv = toArgv(step, resolvedArgs);
      const result = await runStep(argv);
      results.push(result);
      if (!result.ok && stopOnError) break;
    }

    const failed = results.filter((x) => !x.ok).length;
    ok("batch", {
      mode: stopOnError ? "stop-on-error" : "continue",
      summary: {
        total_steps: plan.steps.length,
        executed_steps: results.length,
        success_count: results.length - failed,
        error_count: failed,
        ok: failed === 0,
      },
      steps: results.map((r, index) => ({
        step: index,
        ok: r.ok,
        command: r.command,
        result: r.result,
        error: r.error,
        fix: r.fix,
      })),
    });
  },
});
