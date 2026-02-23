import { execFileSync } from "node:child_process";

interface SecretsGetJson {
  readonly value: string;
}

const ENV_KEYS: readonly string[] = [
  "ASANA_ACCESS_TOKEN",
  "ASANA_TOKEN",
  "ASANA_PAT",
] as const;

const AGENT_SECRETS_CMD = {
  bin: "secrets",
  args: ["get", "asana_access_token"],
} as const;

let cachedToken: string | undefined;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function normalizeToken(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEnv(key: string): string | undefined {
  // Bun: Bun.env; Node: process.env
  const bunEnv = (globalThis as unknown as { readonly Bun?: { readonly env?: Record<string, string> } }).Bun?.env;
  const fromBun = bunEnv?.[key];
  const fromNode = process.env[key];
  return fromBun ?? fromNode ?? undefined;
}

function readTokenFromEnv(): string | undefined {
  for (const key of ENV_KEYS) {
    const value = getEnv(key);
    const normalized = value !== undefined ? normalizeToken(value) : undefined;
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
}

function parseSecretsOutput(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed) && isString(parsed["value"])) {
        return normalizeToken(parsed["value"]);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  return normalizeToken(trimmed);
}

function readTokenFromAgentSecrets(): string | undefined {
  // Si el bin `secrets` no existe o falla, devolvemos undefined.
  // No tiramos error aquí: el caller decide.
  try {
    const stdout = execFileSync(AGENT_SECRETS_CMD.bin, AGENT_SECRETS_CMD.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return parseSecretsOutput(stdout);
  } catch {
    return undefined;
  }
}

export function getToken(): string | undefined {
  if (cachedToken !== undefined) {
    return cachedToken;
  }

  const fromEnv = readTokenFromEnv();
  if (fromEnv !== undefined) {
    cachedToken = fromEnv;
    return cachedToken;
  }

  const fromSecrets = readTokenFromAgentSecrets();
  cachedToken = fromSecrets;
  return cachedToken;
}

export function clearTokenCache(): void {
  cachedToken = undefined;
}