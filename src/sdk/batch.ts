import { type AsanaClient } from "./client.ts";
import { sdkError } from "./errors.ts";

export type BatchStep = {
  readonly command: string;
  readonly args?: Record<string, unknown>;
};

export type BatchStepResult = {
  readonly ok: boolean;
  readonly command: string;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly fix?: string;
};

export type BatchOpts = {
  readonly stopOnError?: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function resolveStepRef(expression: string, results: readonly BatchStepResult[]): unknown {
  if (!expression.startsWith("$steps.")) return expression;
  const parts = expression.split(".");
  const index = Number(parts[1]);
  if (!Number.isInteger(index) || index < 0 || index >= results.length) {
    sdkError(
      `Invalid batch reference "${expression}".`,
      "BATCH_PLAN_INVALID",
      "Use references like $steps.0.result.id where step index already exists.",
    );
  }
  let current: unknown = results[index];
  for (let i = 2; i < parts.length; i += 1) {
    const key = parts[i];
    if (!isObject(current) || !(key in current)) {
      sdkError(
        `Batch reference "${expression}" could not be resolved.`,
        "BATCH_PLAN_INVALID",
        "Ensure referenced step succeeds and the target path exists.",
      );
    }
    current = current[key];
  }
  return current;
}

export function resolveStepArgs(input: unknown, results: readonly BatchStepResult[]): unknown {
  if (typeof input === "string") return resolveStepRef(input, results);
  if (Array.isArray(input)) return input.map((x) => resolveStepArgs(x, results));
  if (isObject(input)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = resolveStepArgs(v, results);
    return out;
  }
  return input;
}

export async function runBatch(
  client: AsanaClient,
  steps: BatchStep[],
  sdkDispatch: (
    client: AsanaClient,
    command: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>,
  opts: BatchOpts = {},
): Promise<BatchStepResult[]> {
  const stopOnError = opts.stopOnError !== false;
  const results: BatchStepResult[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || typeof step.command !== "string") {
      sdkError(
        `Invalid batch step at index ${i}.`,
        "BATCH_PLAN_INVALID",
        "Each step must include { command: string, args?: object }.",
      );
    }
    if (step.command.trim().startsWith("batch")) {
      sdkError(
        "Nested batch commands are not allowed.",
        "BATCH_PLAN_INVALID",
        "Expand nested operations into top-level steps.",
      );
    }

    const resolvedArgs = resolveStepArgs(step.args, results) as Record<string, unknown>;

    try {
      const result = await sdkDispatch(client, step.command.trim(), resolvedArgs);
      results.push({ ok: true, command: step.command, result });
    } catch (err: unknown) {
      const stepResult: BatchStepResult = {
        ok: false,
        command: step.command,
        error: isObject(err) ? { message: (err as { message?: unknown }).message, code: (err as { code?: unknown }).code } : String(err),
        fix: isObject(err) ? String((err as { fix?: unknown }).fix ?? "") : undefined,
      };
      results.push(stepResult);
      if (stopOnError) break;
    }
  }

  return results;
}
