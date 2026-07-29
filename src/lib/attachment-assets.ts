import type { Attachment } from "../types";

export interface AttachmentAsset {
  relativePath: string;
  mimeType: string;
}

export function attachmentRenderAsset(attachment: Pick<Attachment, "relativePath" | "mimeType" | "renderRelativePath" | "renderMimeType">): AttachmentAsset {
  return {
    relativePath: attachment.renderRelativePath ?? attachment.relativePath,
    mimeType: attachment.renderMimeType ?? attachment.mimeType,
  };
}

export function attachmentPreviewAsset(attachment: Pick<Attachment, "relativePath" | "mimeType" | "renderRelativePath" | "renderMimeType" | "previewRelativePath" | "previewMimeType">): AttachmentAsset {
  const render = attachmentRenderAsset(attachment);
  return {
    relativePath: attachment.previewRelativePath ?? render.relativePath,
    mimeType: attachment.previewMimeType ?? render.mimeType,
  };
}

export function attachmentAssetPaths(attachment: Pick<Attachment, "relativePath" | "renderRelativePath" | "previewRelativePath">) {
  return [attachment.relativePath, attachment.renderRelativePath, attachment.previewRelativePath]
    .filter((path): path is string => Boolean(path));
}
