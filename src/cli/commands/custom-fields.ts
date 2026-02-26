import { define } from "gunshi";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok } from "../../hateoas/index.ts";
import { resolveProjectRef } from "../../sdk/refs.ts";
import { listProjectCustomFields } from "../../sdk/custom-fields.ts";

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
  run: (ctx) =>
    withErrorHandler("custom-fields", async () => {
      const client = getCliClient();
      const project = await resolveProjectRef(client, String(ctx.values.project));
      const fields = await listProjectCustomFields(client, project.gid);

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
        cf_usage: '--cf "Field Name=Value" (repeatable)',
      });
    }),
});
