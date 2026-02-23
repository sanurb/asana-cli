type ParsedCliContext = {
  readonly args: string[];
  readonly workspaceRef?: string;
  readonly customFields: readonly string[];
};

let runtimeWorkspaceRef: string | undefined;
let runtimeCustomFields: readonly string[] = [];

function readValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Flag ${args[index]} requires a value.`);
  }
  return value;
}

/**
 * Extracts global flags that should work across all commands without each
 * command having to redeclare them.
 */
export function parseGlobalCliContext(rawArgs: readonly string[]): ParsedCliContext {
  const args = [...rawArgs];
  const passthrough: string[] = [];
  const customFields: string[] = [];
  let workspaceRef: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--workspace") {
      workspaceRef = readValue(args, i);
      i += 1;
      continue;
    }

    if (arg === "--cf") {
      customFields.push(readValue(args, i));
      i += 1;
      continue;
    }

    passthrough.push(arg);
  }

  runtimeWorkspaceRef = workspaceRef;
  runtimeCustomFields = customFields;

  return {
    args: passthrough,
    workspaceRef,
    customFields,
  };
}

export function getRuntimeWorkspaceRef(): string | undefined {
  return runtimeWorkspaceRef;
}

export function getRuntimeCustomFields(): readonly string[] {
  return runtimeCustomFields;
}
