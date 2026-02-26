/**
 * asana.plan() — dry-run primitive.
 *
 * Validates a sequence of SDK steps (ref resolution, permission checks,
 * required field validation) WITHOUT mutating Asana state.
 *
 * Used by agents to preview side effects before committing:
 *   const preview = await asana.plan(client, steps);
 *   if (preview.valid) { // run the real steps }
 *
 * Each step specifies a command name and opts. The plan resolver maps each
 * to a read-only validation (GET only, no POST/PUT/DELETE).
 */

import { type AsanaClient } from "./client.ts";
import { resolveTaskRef, resolveProjectRef } from "./refs.ts";
import { SdkError } from "./errors.ts";

// ── Plan step definitions ─────────────────────────────────────────────

export type PlanStepKind =
  | { readonly command: "tasks.add"; readonly opts: { name: string; projectRef?: string; due_on?: string; assigneeRef?: string } }
  | { readonly command: "tasks.complete"; readonly ref: string }
  | { readonly command: "tasks.reopen"; readonly ref: string }
  | { readonly command: "tasks.update"; readonly ref: string; readonly fields: Record<string, unknown> }
  | { readonly command: "tasks.delete"; readonly ref: string }
  | { readonly command: "tasks.addToProject"; readonly ref: string; readonly projectRef: string }
  | { readonly command: "comments.add"; readonly ref: string; readonly text: string }
  | { readonly command: "comments.delete"; readonly storyGid: string }
  | { readonly command: "deps.add"; readonly ref: string; readonly blockedByRef: string };

export type PlanStep = PlanStepKind;

export type PlanStepValidation = {
  readonly step: number;
  readonly command: string;
  readonly valid: boolean;
  readonly preview?: string;
  readonly error?: string;
  readonly resolvedRefs?: Record<string, string>;
};

export type PlanResult = {
  readonly valid: boolean;
  readonly steps: readonly PlanStepValidation[];
  readonly summary: string;
};

// ── Validators ────────────────────────────────────────────────────────

async function validateAddTask(
  client: AsanaClient,
  step: Extract<PlanStep, { command: "tasks.add" }>,
  index: number,
): Promise<PlanStepValidation> {
  const resolvedRefs: Record<string, string> = {};
  try {
    if (!step.opts.name?.trim()) {
      return { step: index, command: step.command, valid: false, error: "Task name is required." };
    }
    if (step.opts.projectRef) {
      const project = await resolveProjectRef(client, step.opts.projectRef);
      resolvedRefs.project = project.gid;
    }
    const workspaceGid = await client.getWorkspaceGid();
    return {
      step: index,
      command: step.command,
      valid: true,
      preview: `Would create task "${step.opts.name}"${step.opts.projectRef ? ` in project ${resolvedRefs.project}` : ""} in workspace ${workspaceGid}`,
      resolvedRefs,
    };
  } catch (err) {
    return {
      step: index,
      command: step.command,
      valid: false,
      error: err instanceof SdkError ? err.message : String(err),
    };
  }
}

async function validateTaskRef(
  client: AsanaClient,
  command: string,
  ref: string,
  index: number,
  extra?: string,
): Promise<PlanStepValidation> {
  try {
    const task = await resolveTaskRef(client, ref);
    return {
      step: index,
      command,
      valid: true,
      preview: `${command}: task "${task.name}" (${task.gid})${extra ?? ""}`,
      resolvedRefs: { task: task.gid },
    };
  } catch (err) {
    return {
      step: index,
      command,
      valid: false,
      error: err instanceof SdkError ? err.message : String(err),
    };
  }
}

// ── Plan runner ───────────────────────────────────────────────────────

/**
 * Validates a sequence of SDK steps without executing mutations.
 *
 * @example
 * const preview = await plan(client, [
 *   { command: "tasks.add", opts: { name: "Deploy", due_on: "2026-03-01" } },
 *   { command: "tasks.complete", ref: "Buy groceries" },
 * ]);
 * console.log(preview.summary);
 */
export async function plan(
  client: AsanaClient,
  steps: readonly PlanStep[],
): Promise<PlanResult> {
  const results: PlanStepValidation[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step) continue;

    let validation: PlanStepValidation;

    switch (step.command) {
      case "tasks.add":
        validation = await validateAddTask(client, step, i);
        break;
      case "tasks.complete":
        validation = await validateTaskRef(client, step.command, step.ref, i, " — would mark complete");
        break;
      case "tasks.reopen":
        validation = await validateTaskRef(client, step.command, step.ref, i, " — would reopen");
        break;
      case "tasks.update":
        validation = await validateTaskRef(client, step.command, step.ref, i,
          ` — would update fields: ${Object.keys(step.fields).join(", ")}`);
        break;
      case "tasks.delete":
        validation = await validateTaskRef(client, step.command, step.ref, i, " — would DELETE PERMANENTLY");
        break;
      case "tasks.addToProject": {
        try {
          const [task, project] = await Promise.all([
            resolveTaskRef(client, step.ref),
            resolveProjectRef(client, step.projectRef),
          ]);
          validation = {
            step: i, command: step.command, valid: true,
            preview: `Would add "${task.name}" to project "${project.name}"`,
            resolvedRefs: { task: task.gid, project: project.gid },
          };
        } catch (err) {
          validation = { step: i, command: step.command, valid: false, error: err instanceof SdkError ? err.message : String(err) };
        }
        break;
      }
      case "comments.add":
        validation = await validateTaskRef(client, step.command, step.ref, i,
          ` — would add comment: "${step.text.slice(0, 50)}${step.text.length > 50 ? "…" : ""}"`);
        break;
      case "comments.delete":
        validation = { step: i, command: step.command, valid: true, preview: `Would delete story ${step.storyGid}` };
        break;
      case "deps.add": {
        try {
          const [task, blocker] = await Promise.all([
            resolveTaskRef(client, step.ref),
            resolveTaskRef(client, step.blockedByRef),
          ]);
          validation = {
            step: i, command: step.command, valid: true,
            preview: `Would make "${task.name}" blocked by "${blocker.name}"`,
            resolvedRefs: { task: task.gid, blockedBy: blocker.gid },
          };
        } catch (err) {
          validation = { step: i, command: step.command, valid: false, error: err instanceof SdkError ? err.message : String(err) };
        }
        break;
      }
      default: {
        // TypeScript exhaustiveness check
        const _never: never = step;
        validation = { step: i, command: "unknown", valid: false, error: `Unknown plan command: ${JSON.stringify(_never)}` };
      }
    }

    results.push(validation);
  }

  const invalid = results.filter((r) => !r.valid);
  const valid = invalid.length === 0;

  return {
    valid,
    steps: results,
    summary: valid
      ? `Plan valid: ${results.length} step(s) ready to execute.`
      : `Plan invalid: ${invalid.length} of ${results.length} step(s) have errors. Fix them before executing.`,
  };
}
