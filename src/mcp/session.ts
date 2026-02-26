/**
 * MCP session state — in-memory per connection.
 *
 * Agents can persist arbitrary JSON-serializable values across execute() calls
 * within the same MCP connection. Injected into the sandbox as `context`.
 */

export type SessionState = Map<string, unknown>;

export function createSession(): SessionState {
  return new Map<string, unknown>();
}

/**
 * Returns a plain-object snapshot of the session (for structured-clone into worker).
 */
export function snapshotSession(session: SessionState): Record<string, unknown> {
  return Object.fromEntries(session.entries());
}

/**
 * Applies a session key update from the worker.
 */
export function applySessionUpdate(
  session: SessionState,
  key: string,
  value: unknown,
): void {
  session.set(key, value);
}

/**
 * Clears session state (on connection close or explicit reset).
 */
export function clearSession(session: SessionState): void {
  session.clear();
}
