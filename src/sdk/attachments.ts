import { type AsanaClient } from "./client.ts";
import { sdkError } from "./errors.ts";
import { type AsanaAttachment } from "./types.ts";

const ATTACHMENT_OPT_FIELDS =
  "gid,name,resource_subtype,host,permanent_url,download_url,created_at";

export type AttachmentOpts = {
  url: string;
  name?: string;
};

export async function listAttachments(
  client: AsanaClient,
  taskGid: string,
): Promise<AsanaAttachment[]> {
  return client.paginate<AsanaAttachment>(`/tasks/${taskGid}/attachments`, {
    opt_fields: ATTACHMENT_OPT_FIELDS,
  });
}

export async function attachLink(
  client: AsanaClient,
  taskGid: string,
  opts: AttachmentOpts,
): Promise<AsanaAttachment> {
  let parsed: URL;
  try {
    parsed = new URL(opts.url);
  } catch {
    sdkError(
      `Invalid URL: "${opts.url}"`,
      "INVALID_URL",
      "Provide a fully-qualified http or https URL.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    sdkError(
      `URL protocol "${parsed.protocol}" is not allowed. Only http and https are supported.`,
      "INVALID_URL",
      "Use an http:// or https:// URL.",
    );
  }

  const body: Record<string, string> = {
    parent: taskGid,
    resource_subtype: "external",
    url: opts.url,
  };
  if (opts.name !== undefined) {
    body["name"] = opts.name;
  }

  const res = await client.request<AsanaAttachment>("POST", "/attachments", { body });
  return res.data;
}
