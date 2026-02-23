import { define } from "gunshi";
import { resolveProjectRef } from "../refs.ts";
import { ok } from "../output.ts";
import { listProjectCustomFields } from "../lib/asana/custom-fields";

export const customFields = define({
  name: "custom-fields",
  description: "List custom field definitions for a project",
  args: {
    project: {
      type: "string" as const,
      description: "Project reference",
      required: true,
    },
  },
  run: async (ctx) => {
    const project = await resolveProjectRef(ctx.values.project as string);
    const fields = await listProjectCustomFields(project.gid);

    ok("custom-fields", {
      project: { id: project.gid, name: project.name },
      fields: fields.map((f) => ({
        id: f.gid,
        name: f.name,
        type: f.resource_subtype ?? f.type ?? "text",
        enum_options: (f.enum_options ?? []).map((o) => ({
          id: o.gid,
          name: o.name ?? o.gid,
        })),
      })),
      cf_usage: "--cf \"Field Name=Value\" (repeatable)",
    });
  },
});
