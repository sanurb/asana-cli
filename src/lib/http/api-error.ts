interface NextActionParamSpec {
    readonly description: string | undefined
    readonly value: string | number | undefined
    readonly default: string | number | undefined
    readonly enum: readonly string[] | undefined
    readonly required: boolean | undefined
  }
  
  interface NextAction {
    readonly command: string
    readonly description: string
    readonly params: Readonly<Record<string, NextActionParamSpec>> | undefined
  }
  
  interface CliError {
    readonly message: string
    readonly code: string
  }
  
  interface CliErrorEnvelope {
    readonly ok: false
    readonly command: string
    readonly error: CliError
    readonly fix: string
    readonly next_actions: readonly NextAction[]
  }
  
  interface BuildApiErrorInput {
    readonly command: string
    readonly status: number
    readonly statusText: string
    readonly body: unknown
    readonly next_actions: readonly NextAction[]
  }
  
  type AsanaErrorCode =
    | "ASANA_BAD_REQUEST"
    | "ASANA_UNAUTHORIZED"
    | "ASANA_FORBIDDEN"
    | "ASANA_NOT_FOUND"
    | "ASANA_CONFLICT"
    | "ASANA_PRECONDITION_FAILED"
    | "ASANA_UNPROCESSABLE"
    | "ASANA_RATE_LIMITED"
    | "ASANA_SERVER_ERROR"
    | "ASANA_HTTP_ERROR"
  
  const STATUS_TO_CODE = {
    400: "ASANA_BAD_REQUEST",
    401: "ASANA_UNAUTHORIZED",
    403: "ASANA_FORBIDDEN",
    404: "ASANA_NOT_FOUND",
    409: "ASANA_CONFLICT",
    412: "ASANA_PRECONDITION_FAILED",
    422: "ASANA_UNPROCESSABLE",
    429: "ASANA_RATE_LIMITED",
  } as const satisfies Readonly<Record<number, AsanaErrorCode>>
  
  const CODE_TO_FIX = {
    ASANA_UNAUTHORIZED:
      "Set ASANA_ACCESS_TOKEN or refresh your agent-secrets lease. Create a token in Asana Developer Console.",
    ASANA_FORBIDDEN:
      "Check that the token user has access to the workspace/project/task. Verify permissions and try again.",
    ASANA_NOT_FOUND:
      "Verify the reference (name/URL/id/GID) and workspace. Try searching by name or listing projects first.",
    ASANA_RATE_LIMITED:
      "Back off and retry. Reduce concurrency or narrow the query surface.",
    ASANA_BAD_REQUEST:
      "Validate input parameters (dates, required fields, enums). Show the target resource to confirm expected shapes.",
    ASANA_UNPROCESSABLE:
      "Validate input parameters (dates, required fields, enums). Show the target resource to confirm expected shapes.",
    ASANA_CONFLICT:
      "Resolve the conflicting state (duplicates, outdated data, or simultaneous edits) and retry.",
    ASANA_PRECONDITION_FAILED:
      "Re-fetch the resource and retry with updated state.",
    ASANA_SERVER_ERROR:
      "Asana may be having issues. Retry with backoff.",
    ASANA_HTTP_ERROR:
      "Inspect inputs and refs. Re-run with a more specific ref (URL or id:xxx) to avoid ambiguity.",
  } as const satisfies Readonly<Record<AsanaErrorCode, string>>
  
  function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null
  }
  
  function isString(value: unknown): value is string {
    return typeof value === "string"
  }
  
  function pickFirstNonEmptyString(values: readonly unknown[]): string | undefined {
    for (const value of values) {
      if (isString(value)) {
        const trimmed = value.trim()
        if (trimmed.length > 0) {
          return trimmed
        }
      }
    }
    return undefined
  }
  
  function extractAsanaMessage(body: unknown): string | undefined {
    if (isString(body)) {
      const trimmed = body.trim()
      return trimmed.length > 0 ? trimmed : undefined
    }
  
    if (!isRecord(body)) {
      return undefined
    }
  
    const errors = body["errors"]
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0]
      if (isRecord(first)) {
        return pickFirstNonEmptyString([first["message"], first["phrase"], first["help"]])
      }
    }
  
    const errorObj = body["error"]
    if (isRecord(errorObj)) {
      return pickFirstNonEmptyString([errorObj["message"]])
    }
  
    return pickFirstNonEmptyString([body["message"]])
  }
  
  function mapStatusToCode(status: number): AsanaErrorCode {
    const direct = (STATUS_TO_CODE as Readonly<Record<number, AsanaErrorCode | undefined>>)[status]
    if (direct !== undefined) {
      return direct
    }
    return status >= 500 ? "ASANA_SERVER_ERROR" : "ASANA_HTTP_ERROR"
  }
  
  function buildFallbackMessage(status: number, statusText: string): string {
    const text = `${status} ${statusText}`.trim()
    return text.length > 0 ? text : "Asana API error"
  }
  
  export function buildApiError(input: BuildApiErrorInput): CliErrorEnvelope {
    const code = mapStatusToCode(input.status)
    const message = extractAsanaMessage(input.body) ?? buildFallbackMessage(input.status, input.statusText)
    const fix = CODE_TO_FIX[code]
  
    return {
      ok: false,
      command: input.command,
      error: { message, code },
      fix,
      next_actions: input.next_actions,
    }
  }