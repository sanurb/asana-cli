import { define } from "gunshi";
import { api } from "../lib/http/http-json-client";
import { paginate } from "../lib/asana/paginate";
import { getDefaultWorkspaceGid } from "../lib/asana/workspace";
import { fatal, ok, truncate } from "../output.ts";
import { resolveProjectRef, resolveSectionRef, resolveTaskRef } from "../refs.ts";
import { type AsanaProject, type AsanaSection, type AsanaTag } from "../types.ts";

// ── projects ─────────────────────────────────────────────────────────

export const projects = define({
  name: "projects",
  description: "List all projects in default workspace",
  args: {},
  run: async () => {
    const workspace = await getDefaultWorkspaceGid();
    const items = await paginate<AsanaProject>(`/workspaces/${workspace}/projects`, {
      opt_fields: "gid,name,workspace,archived",
      archived: false,
      limit: 100,
    });
    const formatted = items.map((p) => ({
      id: p.gid,
      name: p.name,
      workspace: p.workspace?.name ?? p.workspace?.gid,
      archived: p.archived ?? false,
    }));
    const { items: truncated, meta } = truncate(formatted);

    ok("projects", {
      ...meta,
      workspace,
      projects: truncated,
    }, [
      {
        command: "asana-cli list --project <name>",
        description: "List tasks in a project",
        params: { name: { required: true, description: "Project name or GID" } },
      },
      {
        command: "asana-cli sections --project <name>",
        description: "List sections in a project",
        params: { name: { required: true, description: "Project name or GID" } },
      },
      {
        command: "asana-cli add-project <name>",
        description: "Create a new project",
        params: { name: { required: true, description: "Project name" } },
      },
    ]);
  },
});

// ── sections ─────────────────────────────────────────────────────────

export const sections = define({
  name: "sections",
  description: "List sections in a project",
  args: {
    project: {
      type: "string" as const,
      description: "Project name or GID",
      short: "p",
      required: true,
    },
  },
  run: async (ctx) => {
    const project = await resolveProjectRef(ctx.values.project!);
    const items = await paginate<AsanaSection>(`/projects/${project.gid}/sections`, {
      opt_fields: "gid,name,project",
      limit: 100,
    });
    const formatted = items.map((s) => ({
      id: s.gid,
      name: s.name,
      projectId: s.project?.gid,
    }));
    const { items: truncated, meta } = truncate(formatted);

    ok("sections", {
      ...meta,
      projectId: project.gid,
      projectName: project.name,
      sections: truncated,
    }, [
      {
        command: "asana-cli list --project <project> [--section <section>]",
        description: "List tasks in a section",
        params: {
          project: { value: project.gid, description: "Project GID" },
          section: { required: true, description: "Section GID" },
        },
      },
      {
        command: "asana-cli add-section <name> --project <project>",
        description: "Add a new section",
        params: {
          name: { required: true, description: "Section name" },
          project: { value: project.gid, description: "Project GID" },
        },
      },
    ]);
  },
});

// ── tags ──────────────────────────────────────────────────────────────

export const tags = define({
  name: "tags",
  description: "List all tags in workspace",
  args: {},
  run: async () => {
    const workspace = await getDefaultWorkspaceGid();
    const items = await paginate<AsanaTag>(`/workspaces/${workspace}/tags`, {
      opt_fields: "gid,name",
      limit: 100,
    });
    const formatted = items.map((t) => ({ id: t.gid, name: t.name ?? t.gid }));
    const { items: truncated, meta } = truncate(formatted);

    ok("tags", {
      ...meta,
      tags: truncated,
    }, [
      {
        command: "asana-cli add <name> --tags <tag-gids>",
        description: "Create a task with tags",
        params: {
          name: { required: true, description: "Task name" },
          "tag-gids": { required: true, description: "Comma-separated tag GIDs" },
        },
      },
    ]);
  },
});

// ── add-project ──────────────────────────────────────────────────────

export const addProject = define({
  name: "add-project",
  description: "Create a new project",
  args: {
    name: {
      type: "positional" as const,
      description: "Project name",
      required: true,
    },
  },
  run: async (ctx) => {
    const workspace = await getDefaultWorkspaceGid();
    const res = await api<AsanaProject>("POST", "/projects", {
      body: { name: ctx.values.name as string, workspace },
    });
    const gid = res.data.gid;

    ok("add-project", {
      id: gid,
      name: res.data.name,
      workspace: res.data.workspace?.gid,
    }, [
      {
        command: "asana-cli add-section <name> --project <project>",
        description: "Add a section to the new project",
        params: {
          name: { required: true, description: "Section name" },
          project: { value: gid, description: "Project GID" },
        },
      },
      {
        command: "asana-cli add <name> --project <project>",
        description: "Add a task to the new project",
        params: {
          name: { required: true, description: "Task name" },
          project: { value: gid, description: "Project GID" },
        },
      },
      { command: "asana-cli projects", description: "List all projects" },
    ]);
  },
});

// ── add-section ──────────────────────────────────────────────────────

export const addSection = define({
  name: "add-section",
  description: "Create a section in a project",
  args: {
    name: {
      type: "positional" as const,
      description: "Section name",
      required: true,
    },
    project: {
      type: "string" as const,
      description: "Project name or GID",
      short: "p",
      required: true,
    },
  },
  run: async (ctx) => {
    const { name, project: projectRef } = ctx.values;
    const project = await resolveProjectRef(projectRef!);
    const res = await api<AsanaSection>("POST", `/projects/${project.gid}/sections`, {
      body: { name: name as string },
    });

    ok("add-section", {
      id: res.data.gid,
      name: res.data.name,
      projectId: project.gid,
    }, [
      {
        command: "asana-cli sections --project <project>",
        description: "List all sections in the project",
        params: { project: { value: project.gid, description: "Project GID" } },
      },
      {
        command: "asana-cli add <name> --project <project> --section <section>",
        description: "Add a task to this section",
        params: {
          name: { required: true, description: "Task name" },
          project: { value: project.gid, description: "Project GID" },
          section: { value: res.data.gid, description: "Section GID" },
        },
      },
    ]);
  },
});

export const sectionsMove = define({
  name: "sections-move",
  description: "Move task to section within project with optional ordering",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
    project: {
      type: "string" as const,
      description: "Project reference",
      required: true,
    },
    section: {
      type: "string" as const,
      description: "Section reference within project",
      required: true,
    },
    before: {
      type: "string" as const,
      description: "Anchor task before which to insert",
    },
    after: {
      type: "string" as const,
      description: "Anchor task after which to insert",
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    const project = await resolveProjectRef(ctx.values.project as string);
    const section = await resolveSectionRef(project.gid, ctx.values.section as string);
    if (ctx.values.before && ctx.values.after) {
      fatal("Specify at most one ordering anchor: --before or --after.", {
        code: "INVALID_INPUT",
        fix: "Retry with either --before <task-ref> or --after <task-ref>, not both.",
      });
    }

    const body: Record<string, unknown> = { task: task.gid };
    if (ctx.values.before) {
      const anchor = await resolveTaskRef(String(ctx.values.before));
      const inProject = (anchor.projects ?? []).some((p) => p.gid === project.gid);
      if (!inProject) {
        fatal("Anchor task is not in target project.", {
          code: "INVALID_INPUT",
          fix: "Choose --before task that belongs to the same --project.",
        });
      }
      body.insert_before = anchor.gid;
    }
    if (ctx.values.after) {
      const anchor = await resolveTaskRef(String(ctx.values.after));
      const inProject = (anchor.projects ?? []).some((p) => p.gid === project.gid);
      if (!inProject) {
        fatal("Anchor task is not in target project.", {
          code: "INVALID_INPUT",
          fix: "Choose --after task that belongs to the same --project.",
        });
      }
      body.insert_after = anchor.gid;
    }

    await api("POST", `/sections/${section.gid}/addTask`, { body });

    ok("sections move", {
      task: { id: task.gid, name: task.name },
      target_project: { id: project.gid, name: project.name },
      target_section: { id: section.gid, name: section.name },
      placement: ctx.values.before ? "before" : ctx.values.after ? "after" : "append_end",
      anchor_task: ctx.values.before ?? ctx.values.after ?? null,
    });
  },
});
