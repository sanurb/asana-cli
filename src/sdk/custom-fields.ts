import { type AsanaClient } from "./client.ts";
import { type AsanaCustomFieldDefinition } from "./types.ts";
import { sdkError } from "./errors.ts";

type CustomFieldSetting = {
  readonly custom_field: AsanaCustomFieldDefinition;
};

const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function parsePair(raw: string): { fieldName: string; value: string } {
  const idx = raw.indexOf("=");
  if (idx <= 0 || idx === raw.length - 1) {
    sdkError(
      `Invalid custom field entry "${raw}".`,
      "INVALID_CUSTOM_FIELD_VALUE",
      'Use "Field Name=Value" format.',
    );
  }
  return {
    fieldName: raw.slice(0, idx).trim(),
    value: raw.slice(idx + 1).trim(),
  };
}

function resolveFieldDefinition(
  defs: readonly AsanaCustomFieldDefinition[],
  fieldName: string,
): AsanaCustomFieldDefinition {
  const matches = defs.filter((x) => normalizeName(x.name) === normalizeName(fieldName));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    sdkError(
      `Custom field "${fieldName}" is ambiguous in this project.`,
      "AMBIGUOUS_REF",
      "Use a unique custom field name within the project.",
    );
  }
  sdkError(
    `Custom field "${fieldName}" not found in project scope.`,
    "NOT_FOUND",
    "Run 'asana-cli custom-fields --project <ref>' and use an exact field name.",
  );
}

function parseNumberValue(raw: string, fieldName: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    sdkError(
      `Invalid number for custom field "${fieldName}": "${raw}".`,
      "INVALID_CUSTOM_FIELD_VALUE",
      `Use "Field Name=<number>" (for example: "${fieldName}=3.14").`,
    );
  }
  return parsed;
}

function parseDateValue(raw: string, fieldName: string): string {
  if (!DATE_VALUE_PATTERN.test(raw)) {
    sdkError(
      `Invalid date for custom field "${fieldName}": "${raw}".`,
      "INVALID_CUSTOM_FIELD_VALUE",
      `Use "${fieldName}=YYYY-MM-DD".`,
    );
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    sdkError(
      `Invalid calendar date for custom field "${fieldName}": "${raw}".`,
      "INVALID_CUSTOM_FIELD_VALUE",
      `Use a valid ISO date value in "${fieldName}=YYYY-MM-DD".`,
    );
  }
  return raw;
}

function parseEnumValue(raw: string, field: AsanaCustomFieldDefinition): string {
  const options = field.enum_options ?? [];
  const lower = normalizeName(raw);
  const match = options.find((o) => normalizeName(o.name ?? "") === lower);
  if (!match) {
    const allowed = options.map((o) => `${o.name ?? o.gid} (${o.gid})`).join(", ");
    sdkError(
      `Invalid enum option "${raw}" for custom field "${field.name}".`,
      "INVALID_CUSTOM_FIELD_VALUE",
      `Use "${field.name}=<option-name>" with one of: ${allowed || "no options configured"}.`,
    );
  }
  return match.gid;
}

function parseValue(field: AsanaCustomFieldDefinition, rawValue: string): string | number {
  const kind = field.resource_subtype ?? field.type ?? "text";
  if (kind === "enum") return parseEnumValue(rawValue, field);
  if (kind === "number") return parseNumberValue(rawValue, field.name);
  if (kind === "date") return parseDateValue(rawValue, field.name);
  return rawValue;
}

export async function listProjectCustomFields(
  client: AsanaClient,
  projectGid: string,
): Promise<AsanaCustomFieldDefinition[]> {
  const res = await client.request<CustomFieldSetting[]>(
    "GET",
    `/projects/${projectGid}/custom_field_settings`,
    {
      query: {
        opt_fields: [
          "custom_field.gid",
          "custom_field.name",
          "custom_field.type",
          "custom_field.resource_subtype",
          "custom_field.enum_options",
          "custom_field.enum_options.gid",
          "custom_field.enum_options.name",
        ].join(","),
        limit: 100,
      },
    },
  );
  return res.data.map((x) => x.custom_field);
}

export async function buildCustomFieldsPayload(
  client: AsanaClient,
  projectGid: string | undefined,
  entries: readonly string[],
): Promise<Record<string, string | number> | undefined> {
  if (entries.length === 0) return undefined;
  if (!projectGid) {
    sdkError(
      "Custom field resolution requires project scope.",
      "MISSING_PROJECT_SCOPE",
      'Add --project <ref> when using --cf "Field=Value".',
    );
  }

  const defs = await listProjectCustomFields(client, projectGid);
  const payload: Record<string, string | number> = {};

  for (const raw of entries) {
    const pair = parsePair(raw);
    const field = resolveFieldDefinition(defs, pair.fieldName);
    payload[field.gid] = parseValue(field, pair.value);
  }

  return payload;
}
