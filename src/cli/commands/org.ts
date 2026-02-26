import { define } from "gunshi";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok, truncate } from "../../hateoas/index.ts";
import { resolveProjectRef, resolveSectionRef, resolveTaskRef } from "../../sdk/refs.ts";
import { listProjects, addProject } from "../../sdk/projects.ts";
import { listSections, addSection, moveTaskToSection } from "../../sdk/sections.ts";
import { listTags } from "../../sdk/tags.ts";
import { fatal } from "../../hateoas/output.ts";

// ── projects ─────────────────────────────────────────────────────────

export const projects = define({
  name: "projects",
  description: "List all projects in default workspace",
  args: {},
  run: () => withErrorHandler("projects", async () => {
    const client = getCliClient();
    const raw = await listProjects(client);
    const formatted = raw.map((p) => ({
      id: p.gid,
      name: p.name,
      workspace: p.workspace?.name ?? p.workspace?.gid,
      archived: p.archived ?? false,
    }));
    const { items: truncated, meta } = truncate(formatted);

    ok("projects", {
      ...meta,
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
  }),
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
  run: (ctx) => withErrorHandler("sections", async () => {
    const client = getCliClient();
    const project = await resolveProjectRef(client, ctx.values.project as string);
    const raw = await listSections(client, project.gid);
    const formatted = raw.map((s) => ({
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
  }),
});

// ── tags ──────────────────────────────────────────────────────────────

export const tags = define({
  name: "tags",
  description: "List all tags in workspace",
  args: {},
  run: () => withErrorHandler("tags", async () => {
    const client = getCliClient();
    const raw = await listTags(client);
    const formatted = raw.map((t) => ({ id: t.gid, name: t.name ?? t.gid }));
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
  }),
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
  run: (ctx) => withErrorHandler("add-project", async () => {
    const client = getCliClient();
    const workspaceGid = await client.getWorkspaceGid();
    const project = await addProject(client, ctx.values.name as string, workspaceGid);

    ok("add-project", {
      id: project.gid,
      name: project.name,
      workspace: project.workspace?.gid,
    }, [
      {
        command: "asana-cli add-section <name> --project <project>",
        description: "Add a section to the new project",
        params: {
          name: { required: true, description: "Section name" },
          project: { value: project.gid, description: "Project GID" },
        },
      },
      {
        command: "asana-cli add <name> --project <project>",
        description: "Add a task to the new project",
        params: {
          name: { required: true, description: "Task name" },
          project: { value: project.gid, description: "Project GID" },
        },
      },
      { command: "asana-cli projects", description: "List all projects" },
    ]);
  }),
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
  run: (ctx) => withErrorHandler("add-section", async () => {
    const client = getCliClient();
    const project = await resolveProjectRef(client, ctx.values.project as string);
    const section = await addSection(client, project.gid, ctx.values.name as string);

    ok("add-section", {
      id: section.gid,
      name: section.name,
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
          section: { value: section.gid, description: "Section GID" },
        },
      },
    ]);
  }),
});

// ── sections-move ─────────────────────────────────────────────────────

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
  run: (ctx) => withErrorHandler("sections-move", async () => {
    if (ctx.values.before && ctx.values.after) {
      fatal("Specify at most one ordering anchor: --before or --after.", {
        code: "INVALID_INPUT",
        fix: "Retry with either --before <task-ref> or --after <task-ref>, not both.",
      });
    }

    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    const project = await resolveProjectRef(client, ctx.values.project as string);
    const section = await resolveSectionRef(client, project.gid, ctx.values.section as string);

    const opts: { insertBefore?: string; insertAfter?: string } = {};

    if (ctx.values.before) {
      const anchor = await resolveTaskRef(client, ctx.values.before as string);
      const inProject = (anchor.projects ?? []).some((p) => p.gid === project.gid);
      if (!inProject) {
        fatal("Anchor task is not in target project.", {
          code: "INVALID_INPUT",
          fix: "Choose --before task that belongs to the same --project.",
        });
      }
      opts.insertBefore = anchor.gid;
    }

    if (ctx.values.after) {
      const anchor = await resolveTaskRef(client, ctx.values.after as string);
      const inProject = (anchor.projects ?? []).some((p) => p.gid === project.gid);
      if (!inProject) {
        fatal("Anchor task is not in target project.", {
          code: "INVALID_INPUT",
          fix: "Choose --after task that belongs to the same --project.",
        });
      }
      opts.insertAfter = anchor.gid;
    }

    await moveTaskToSection(client, section.gid, task.gid, opts);

    ok("sections-move", {
      task: { id: task.gid, name: task.name },
      target_project: { id: project.gid, name: project.name },
      target_section: { id: section.gid, name: section.name },
      placement: ctx.values.before ? "before" : ctx.values.after ? "after" : "append_end",
      anchor_task: ctx.values.before ?? ctx.values.after ?? null,
    });
  }),
});
