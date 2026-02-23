import { getRuntimeCustomFields } from "./cli-context";
import { api } from "../http/http-json-client";
import { fatal } from "../../output.ts";

type EnumOption = {
  readonly gid: string;
  readonly name?: string;
};

type CustomFieldDefinition = {
  readonly gid: string;
  readonly name: string;
  readonly resource_subtype?: string;
  readonly type?: string;
  readonly enum_options?: readonly EnumOption[];
};

type CustomFieldSetting = {
  readonly custom_field: CustomFieldDefinition;
};

type ResolvedCustomFieldMap = Record<string, string | number>;

const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function parsePair(raw: string): { fieldName: string; value: string } {
  const idx = raw.indexOf("=");
  if (idx <= 0 || idx === raw.length - 1) {
    fatal(`Invalid --cf value "${raw}".`, {
      code: "INVALID_CUSTOM_FIELD_VALUE",
      fix: "Use repeatable --cf \"Field Name=Value\" format.",
    });
  }
  return {
    fieldName: raw.slice(0, idx).trim(),
    value: raw.slice(idx + 1).trim(),
  };
}

export async function listProjectCustomFields(projectGid: string): Promise<CustomFieldDefinition[]> {
  const res = await api<CustomFieldSetting[]>("GET", `/projects/${projectGid}/custom_field_settings`, {
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
  });
  return res.data.map((x) => x.custom_field);
}

function resolveFieldDefinition(defs: readonly CustomFieldDefinition[], fieldName: string): CustomFieldDefinition {
  const matches = defs.filter((x) => normalizeName(x.name) === normalizeName(fieldName));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    fatal(`Custom field "${fieldName}" is ambiguous in this project.`, {
      code: "AMBIGUOUS_REF",
      fix: "Use a unique custom field name within the project.",
    });
  }
  fatal(`Custom field "${fieldName}" not found in project scope.`, {
    code: "NOT_FOUND",
    fix: "Run 'asana-cli custom-fields --project <ref>' and use an exact field name.",
  });
}

function parseNumberValue(raw: string, fieldName: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    fatal(`Invalid number for custom field "${fieldName}": "${raw}".`, {
      code: "INVALID_CUSTOM_FIELD_VALUE",
      fix: `Use --cf "${fieldName}=<number>" (for example: --cf "${fieldName}=3.14").`,
    });
  }
  return parsed;
}

function parseDateValue(raw: string, fieldName: string): string {
  if (!DATE_VALUE_PATTERN.test(raw)) {
    fatal(`Invalid date for custom field "${fieldName}": "${raw}".`, {
      code: "INVALID_CUSTOM_FIELD_VALUE",
      fix: `Use --cf "${fieldName}=YYYY-MM-DD".`,
    });
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    fatal(`Invalid calendar date for custom field "${fieldName}": "${raw}".`, {
      code: "INVALID_CUSTOM_FIELD_VALUE",
      fix: `Use a valid ISO date value in --cf "${fieldName}=YYYY-MM-DD".`,
    });
  }
  return raw;
}

function parseEnumValue(raw: string, field: CustomFieldDefinition): string {
  const options = field.enum_options ?? [];
  const lower = normalizeName(raw);
  const match = options.find((o) => normalizeName(o.name ?? "") === lower);
  if (!match) {
    const allowed = options.map((o) => `${o.name ?? o.gid} (${o.gid})`).join(", ");
    fatal(`Invalid enum option "${raw}" for custom field "${field.name}".`, {
      code: "INVALID_CUSTOM_FIELD_VALUE",
      fix: `Use --cf "${field.name}=<option-name>" with one of: ${allowed || "no options configured"}.`,
    });
  }
  return match.gid;
}

function parseValue(field: CustomFieldDefinition, rawValue: string): string | number {
  const kind = field.resource_subtype ?? field.type ?? "text";
  if (kind === "enum") return parseEnumValue(rawValue, field);
  if (kind === "number") return parseNumberValue(rawValue, field.name);
  if (kind === "date") return parseDateValue(rawValue, field.name);
  return rawValue;
}

export async function buildCustomFieldsPayload(projectGid: string | undefined): Promise<ResolvedCustomFieldMap | undefined> {
  const entries = getRuntimeCustomFields();
  if (entries.length === 0) return undefined;
  if (!projectGid) {
    fatal("Custom field resolution requires project scope.", {
      code: "MISSING_PROJECT_SCOPE",
      fix: "Add --project <ref> when using --cf \"Field=Value\".",
    });
  }

  const defs = await listProjectCustomFields(projectGid);
  const payload: ResolvedCustomFieldMap = {};

  for (const raw of entries) {
    const pair = parsePair(raw);
    const field = resolveFieldDefinition(defs, pair.fieldName);
    payload[field.gid] = parseValue(field, pair.value);
  }

  return payload;
}
