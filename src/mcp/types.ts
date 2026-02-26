/**
 * JSON-RPC 2.0 and MCP protocol types.
 *
 * Only the subset needed for the asana-cli MCP server is defined here.
 * Ref: https://spec.modelcontextprotocol.io/specification/
 */

// ── JSON-RPC ─────────────────────────────────────────────────────────

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
};

export type JsonRpcNotification = {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
};

export type JsonRpcResponse<T = unknown> = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: T;
};

export type JsonRpcErrorResponse = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse | JsonRpcErrorResponse;

// Standard error codes
export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ── MCP protocol ─────────────────────────────────────────────────────

export type McpClientInfo = {
  readonly name: string;
  readonly version: string;
};

export type McpInitializeParams = {
  readonly protocolVersion: string;
  readonly capabilities: Record<string, unknown>;
  readonly clientInfo?: McpClientInfo;
};

export type McpInitializeResult = {
  readonly protocolVersion: string;
  readonly capabilities: { readonly tools: Record<string, unknown> };
  readonly serverInfo: { readonly name: string; readonly version: string };
};

export type McpToolInputSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
};

export type McpTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpToolInputSchema;
};

export type McpToolsListResult = {
  readonly tools: readonly McpTool[];
};

export type McpCallToolParams = {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
  readonly _meta?: { readonly progressToken?: string | number };
};

export type McpTextContent = {
  readonly type: "text";
  readonly text: string;
};

export type McpCallToolResult = {
  readonly content: readonly McpTextContent[];
  readonly isError?: boolean;
};

export type McpProgressNotificationParams = {
  readonly progressToken: string | number;
  readonly progress: number;
  readonly total?: number;
  readonly message?: string;
};

// ── Worker bridge protocol ────────────────────────────────────────────

export type WorkerCallMessage = {
  readonly type: "call";
  readonly id: number;
  readonly namespace: string;
  readonly method: string;
  readonly args: readonly unknown[];
};

export type WorkerResultMessage = {
  readonly type: "result";
  readonly id: number;
  readonly value: unknown;
};

export type WorkerErrorMessage = {
  readonly type: "error";
  readonly id: number;
  readonly error: {
    readonly message: string;
    readonly code?: string;
    readonly fix?: string;
  };
};

export type WorkerProgressMessage = {
  readonly type: "progress";
  readonly message: string;
};

export type WorkerSessionUpdateMessage = {
  readonly type: "session-update";
  readonly key: string;
  readonly value: unknown;
};

export type WorkerDoneMessage = {
  readonly type: "done";
  readonly value: unknown;
};

export type WorkerFatalMessage = {
  readonly type: "fatal";
  readonly error: {
    readonly message: string;
    readonly code?: string;
    readonly fix?: string;
  };
};

export type MainToWorkerMessage = WorkerResultMessage | WorkerErrorMessage;
export type WorkerToMainMessage =
  | WorkerCallMessage
  | WorkerProgressMessage
  | WorkerSessionUpdateMessage
  | WorkerDoneMessage
  | WorkerFatalMessage;
