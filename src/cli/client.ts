/**
 * CLI-layer client singleton.
 *
 * The CLI is a single-invocation process. Module-level state here is intentional.
 * Global flags (--workspace, --cf) are captured once during arg parsing and used
 * to configure the client and custom field resolution.
 */

import { createClient, type AsanaClient, type ClientConfig } from "../sdk/client.ts";
import { SdkError } from "../sdk/errors.ts";
import { fatal } from "../hateoas/output.ts";

let _client: AsanaClient | undefined;
let _customFields: readonly string[] = [];

/**
 * Must be called once in cli.ts after parsing global flags.
 * Sets the singleton client and custom field entries for this process.
 */
export function setupCliClient(config: ClientConfig, customFields: readonly string[]): void {
  _client = createClient(config);
  _customFields = customFields;
}

/**
 * Returns the singleton AsanaClient. Throws if not yet set up.
 * All command `run` functions call this.
 */
export function getCliClient(): AsanaClient {
  if (!_client) {
    fatal("CLI client not initialized. This is a bug.", {
      code: "COMMAND_FAILED",
      fix: "Report this issue.",
    });
  }
  return _client;
}

/**
 * Returns the custom field entries from --cf flags.
 */
export function getCliCustomFields(): readonly string[] {
  return _customFields;
}

/**
 * Translates an SdkError to a fatal() call (process.exit).
 * Call this at the top of command run functions to normalize errors.
 */
export function handleSdkError(err: unknown, command: string): never {
  if (err instanceof SdkError) {
    fatal(err.message, {
      code: err.code as Parameters<typeof fatal>[1]["code"],
      fix: err.fix,
      command,
      nextActions: [{ command: "asana-cli --help", description: "Show available commands" }],
    });
  }
  throw err;
}

/**
 * Wraps a command run function to catch SdkErrors and convert to fatal().
 */
export function withErrorHandler<T>(
  command: string,
  fn: () => Promise<T>,
): Promise<T> {
  return fn().catch((err: unknown) => handleSdkError(err, command));
}
