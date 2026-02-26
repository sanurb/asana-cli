import { type AsanaClient } from "./client.ts";
import { isSdkError, SdkError } from "./errors.ts";
import { type AsanaStory, STORY_OPT_FIELDS } from "./types.ts";

export async function listComments(
  client: AsanaClient,
  taskGid: string,
): Promise<AsanaStory[]> {
  return client.paginate<AsanaStory>(`/tasks/${taskGid}/stories`, {
    opt_fields: STORY_OPT_FIELDS,
  });
}

export async function addComment(
  client: AsanaClient,
  taskGid: string,
  text: string,
): Promise<AsanaStory> {
  const res = await client.request<AsanaStory>("POST", `/tasks/${taskGid}/stories`, {
    body: { text },
  });
  return res.data;
}

function is403(err: SdkError): boolean {
  return (
    err.code === "API_ERROR" &&
    (err.message.includes("403") || err.message.toLowerCase().includes("forbidden"))
  );
}

export async function updateComment(
  client: AsanaClient,
  storyGid: string,
  text: string,
): Promise<AsanaStory> {
  try {
    const res = await client.request<AsanaStory>("PUT", `/stories/${storyGid}`, {
      body: { text },
    });
    return res.data;
  } catch (err) {
    if (isSdkError(err) && is403(err)) {
      throw new SdkError(
        `Permission denied updating story ${storyGid}.`,
        "COMMENT_PERMISSION_DENIED",
        "You can only edit your own comments.",
      );
    }
    throw err;
  }
}

export async function deleteComment(
  client: AsanaClient,
  storyGid: string,
): Promise<void> {
  try {
    await client.request<unknown>("DELETE", `/stories/${storyGid}`);
  } catch (err) {
    if (isSdkError(err) && is403(err)) {
      throw new SdkError(
        `Permission denied deleting story ${storyGid}.`,
        "COMMENT_PERMISSION_DENIED",
        "You can only delete your own comments.",
      );
    }
    throw err;
  }
}

export async function getLastCommentByUser(
  client: AsanaClient,
  taskGid: string,
  userGid: string,
): Promise<AsanaStory | undefined> {
  const stories = await listComments(client, taskGid);
  const byUser = stories.filter((s) => s.created_by?.gid === userGid);
  byUser.sort((a, b) => {
    const ta = a.created_at ?? "";
    const tb = b.created_at ?? "";
    return tb.localeCompare(ta);
  });
  return byUser[0];
}
