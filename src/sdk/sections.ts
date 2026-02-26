import { type AsanaClient } from "./client.ts";
import { type AsanaSection } from "./types.ts";

const SECTION_OPT_FIELDS = "gid,name,project";

export async function listSections(
  client: AsanaClient,
  projectGid: string,
): Promise<AsanaSection[]> {
  return client.paginate<AsanaSection>(`/projects/${projectGid}/sections`, {
    opt_fields: SECTION_OPT_FIELDS,
  });
}

export async function addSection(
  client: AsanaClient,
  projectGid: string,
  name: string,
): Promise<AsanaSection> {
  const res = await client.request<AsanaSection>("POST", `/projects/${projectGid}/sections`, {
    query: { opt_fields: SECTION_OPT_FIELDS },
    body: { name },
  });
  return res.data;
}

export async function moveTaskToSection(
  client: AsanaClient,
  sectionGid: string,
  taskGid: string,
  opts: { insertBefore?: string; insertAfter?: string } = {},
): Promise<void> {
  const body: Record<string, string> = { task: taskGid };
  if (opts.insertBefore !== undefined) body.insert_before = opts.insertBefore;
  if (opts.insertAfter !== undefined) body.insert_after = opts.insertAfter;

  await client.request("POST", `/sections/${sectionGid}/addTask`, {
    body,
  });
}
