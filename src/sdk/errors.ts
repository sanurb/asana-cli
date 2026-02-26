/**
 * Typed SDK errors.
 *
 * Every SDK function throws an SdkError instead of calling process.exit().
 * Callers (CLI layer, MCP layer) catch and translate to their output format.
 */

export type SdkErrorCode =
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
  | "BATCH_PLAN_INVALID"
  | "NETWORK_ERROR"
  | "RATE_LIMITED";

export class SdkError extends Error {
  readonly code: SdkErrorCode;
  /** Human-readable remediation hint. */
  readonly fix: string;

  constructor(message: string, code: SdkErrorCode, fix = "Check the error message and retry.") {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.fix = fix;
  }
}

export function isSdkError(value: unknown): value is SdkError {
  return value instanceof SdkError;
}

/** Convenience constructor — throws immediately. */
export function sdkError(message: string, code: SdkErrorCode, fix?: string): never {
  throw new SdkError(message, code, fix);
}
