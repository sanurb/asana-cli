import * as tasks from "./tasks.ts";
import * as projects from "./projects.ts";
import * as sections from "./sections.ts";
import * as comments from "./comments.ts";
import * as attachments from "./attachments.ts";
import * as subtasks from "./subtasks.ts";
import * as dependencies from "./dependencies.ts";
import * as users from "./users.ts";
import * as tags from "./tags.ts";
import * as customFields from "./custom-fields.ts";
import * as batch from "./batch.ts";
import * as workspace from "./workspace.ts";
import * as plan from "./plan.ts";
import * as parallel from "./parallel.ts";

export {
  tasks,
  projects,
  sections,
  comments,
  attachments,
  subtasks,
  dependencies,
  users,
  tags,
  customFields,
  batch,
  workspace,
};

export type { AsanaClient, ClientConfig, WorkspaceSource } from "./client.ts";
export { createClient, createClientFromEnv } from "./client.ts";
export type { SdkError, SdkErrorCode } from "./errors.ts";
export { isSdkError } from "./errors.ts";
export { resolveTaskRef, resolveProjectRef, resolveSectionRef, requireProjectScope } from "./refs.ts";
export type * from "./types.ts";
