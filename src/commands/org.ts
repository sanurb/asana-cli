import { define } from "gunshi";
import { api, paginate, getDefaultWorkspaceGid } from "../api.ts";
import { ok, truncate } from "../output.ts";
import { resolveProjectRef } from "../refs.ts";
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

    ok("sections", {
      count: items.length,
      projectId: project.gid,
      projectName: project.name,
      sections: items.map((s) => ({
        id: s.gid,
        name: s.name,
        projectId: s.project?.gid,
      })),
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
