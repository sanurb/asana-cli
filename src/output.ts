// ── HATEOAS JSON Output ─────────────────────────────────────────────

type NextActionParam = {
  description?: string;
  value?: string | number;
  default?: string | number;
  enum?: string[];
  required?: boolean;
};

export type NextAction = {
  command: string;
  description: string;
  params?: Record<string, NextActionParam>;
};

type TruncationMeta = {
  truncated: boolean;
  total: number;
  showing: number;
};

export const MAX_LIST_ITEMS = 50;

/**
 * Truncates an array and returns truncation metadata for context-safe output.
 */
export function truncate<T>(items: T[], limit = MAX_LIST_ITEMS): { items: T[]; meta: TruncationMeta } {
  return {
    items: items.slice(0, limit),
    meta: {
      truncated: items.length > limit,
      total: items.length,
      showing: Math.min(items.length, limit),
    },
  };
}

export function ok(
  command: string,
  result: unknown,
  nextActions: NextAction[] = [],
) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        command: `asana-cli ${command}`,
        result,
        next_actions: nextActions,
      },
      null,
      2,
    ),
  );
}

type ErrorCode =
  | "AUTH_MISSING"
  | "NOT_FOUND"
  | "AMBIGUOUS_REF"
  | "API_ERROR"
  | "INVALID_INPUT"
  | "NO_WORKSPACE"
  | "COMMAND_FAILED"
  | "WORKSPACE_NOT_FOUND"
  | "AMBIGUOUS_WORKSPACE"
  | "ASSIGNEE_EMAIL_LOOKUP_FORBIDDEN"
  | "INVALID_CUSTOM_FIELD_VALUE"
  | "MISSING_PROJECT_SCOPE"
  | "MULTI_HOME_AMBIGUITY"
  | "DEPENDENCY_CYCLE_RISK"
  | "INVALID_URL"
  | "COMMENT_PERMISSION_DENIED"
  | "BATCH_PLAN_INVALID";

export function fatal(
  message: string,
  opts: { code?: ErrorCode; fix?: string; command?: string; nextActions?: NextAction[] } = {},
): never {
  console.error(
    JSON.stringify({
      ok: false,
      command: opts.command !== undefined ? `asana-cli ${opts.command}` : "asana-cli",
      error: {
        message,
        code: opts.code ?? "COMMAND_FAILED",
      },
      fix: opts.fix ?? "Check the error message and retry with corrected input.",
      next_actions: opts.nextActions ?? [
        { command: "asana-cli --help", description: "Show available commands" },
      ],
    }),
  );
  process.exit(1);
}
