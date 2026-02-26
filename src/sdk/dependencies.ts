import { type AsanaClient } from "./client.ts";
import { sdkError } from "./errors.ts";
import { type AsanaTask } from "./types.ts";

export type DepEdge = {
  id: string;
  name: string;
};

const DEP_OPT_FIELDS =
  "gid,name,dependencies,dependencies.gid,dependencies.name,dependents,dependents.gid,dependents.name";

type TaskWithDeps = AsanaTask & {
  dependencies?: { gid: string; name?: string }[] | null;
  dependents?: { gid: string; name?: string }[] | null;
};

export async function getDependencies(
  client: AsanaClient,
  taskGid: string,
): Promise<{ blockedBy: DepEdge[]; blocking: DepEdge[] }> {
  const res = await client.request<TaskWithDeps>("GET", `/tasks/${taskGid}`, {
    query: { opt_fields: DEP_OPT_FIELDS },
  });
  const task = res.data;

  const blockedBy: DepEdge[] = (task.dependencies ?? []).map((d) => ({
    id: d.gid,
    name: d.name ?? d.gid,
  }));

  const blocking: DepEdge[] = (task.dependents ?? []).map((d) => ({
    id: d.gid,
    name: d.name ?? d.gid,
  }));

  return { blockedBy, blocking };
}

export async function hasCycleRisk(
  client: AsanaClient,
  taskGid: string,
  blockedByGid: string,
): Promise<boolean> {
  // BFS from blockedByGid following its dependencies (what it is blocked by).
  // If we reach taskGid, adding blockedByGid as a dependency of taskGid would create a cycle.
  const visited = new Set<string>();
  const queue: string[] = [blockedByGid];
  let visits = 0;

  while (queue.length > 0 && visits < 150) {
    const current = queue.shift();
    if (current === undefined) break;
    if (visited.has(current)) continue;
    visited.add(current);
    visits++;

    if (current === taskGid) return true;

    const res = await client.request<TaskWithDeps>("GET", `/tasks/${current}`, {
      query: { opt_fields: DEP_OPT_FIELDS },
    });
    const deps = res.data.dependencies ?? [];
    for (const dep of deps) {
      if (!visited.has(dep.gid)) {
        queue.push(dep.gid);
      }
    }
  }

  return false;
}

export async function addDependency(
  client: AsanaClient,
  taskGid: string,
  blockedByGid: string,
): Promise<void> {
  if (taskGid === blockedByGid) {
    sdkError(
      "A task cannot depend on itself.",
      "DEPENDENCY_CYCLE_RISK",
      "Choose a different task to depend on.",
    );
  }

  const cycle = await hasCycleRisk(client, taskGid, blockedByGid);
  if (cycle) {
    sdkError(
      `Adding dependency on ${blockedByGid} would create a cycle.`,
      "DEPENDENCY_CYCLE_RISK",
      "Remove the existing dependency chain before adding this one.",
    );
  }

  await client.request<unknown>("POST", `/tasks/${taskGid}/addDependencies`, {
    body: { dependencies: [blockedByGid] },
  });
}

export async function removeDependency(
  client: AsanaClient,
  taskGid: string,
  blockedByGid: string,
): Promise<void> {
  await client.request<unknown>("POST", `/tasks/${taskGid}/removeDependencies`, {
    body: { dependencies: [blockedByGid] },
  });
}
