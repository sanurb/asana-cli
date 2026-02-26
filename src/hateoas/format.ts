import type { AsanaTask, AsanaStory, AsanaAttachment } from '../sdk/types.ts';

export type FormattedTask = {
  id: string;
  name: string;
  notes?: string;
  completed: boolean;
  due_on: string | null;
  due_at: string | null;
  assignee?: string;
  assignee_gid?: string;
  projectIds: string[];
  projectNames?: string[];
  section?: string;
  parentId?: string;
  permalink_url?: string;
  tags?: string[];
  custom_fields?: { id: string; name: string; type?: string; value: string | null }[];
};

export type FormattedStory = {
  id: string;
  type?: string;
  text?: string;
  created_at?: string;
  created_by?: string;
};

export type FormattedAttachment = {
  id: string;
  name: string;
  type: string | null;
  host: string | null;
  url: string | null;
  created_at: string | null;
};

export function formatTask(t: AsanaTask): FormattedTask {
  return {
    id: t.gid,
    name: t.name,
    notes: t.notes ?? undefined,
    completed: t.completed ?? false,
    due_on: t.due_on ?? null,
    due_at: t.due_at ?? null,
    assignee: t.assignee?.name ?? t.assignee?.gid ?? undefined,
    assignee_gid: t.assignee?.gid ?? undefined,
    projectIds: t.projects?.map((p) => p.gid) ?? [],
    projectNames: t.projects?.map((p) => p.name) ?? undefined,
    section: t.memberships?.[0]?.section?.name ?? undefined,
    parentId: t.parent?.gid ?? undefined,
    permalink_url: t.permalink_url ?? undefined,
    tags: t.tags != null && t.tags.length > 0
      ? t.tags.map((x) => x.name ?? x.gid)
      : undefined,
    custom_fields: t.custom_fields?.map((f) => ({
      id: f.gid,
      name: f.name ?? f.gid,
      type: f.resource_subtype,
      value: f.display_value ?? null,
    })),
  };
}

export function formatStory(s: AsanaStory): FormattedStory {
  return {
    id: s.gid,
    type: s.type,
    text: s.text,
    created_at: s.created_at,
    created_by: s.created_by?.name ?? s.created_by?.gid ?? undefined,
  };
}

export function formatAttachment(a: AsanaAttachment): FormattedAttachment {
  return {
    id: a.gid,
    name: a.name ?? a.gid,
    type: a.resource_subtype ?? null,
    host: a.host ?? null,
    url: a.permanent_url ?? a.download_url ?? null,
    created_at: a.created_at ?? null,
  };
}
