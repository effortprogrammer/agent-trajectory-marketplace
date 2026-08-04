const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function filenameFromUrl(url: string, contentType?: string | null): string {
  try {
    const name = new URL(url, window.location.href).pathname.split("/").pop();
    if (name && name.includes(".")) return decodeURIComponent(name);
  } catch {}

  const extension = contentType ? EXTENSION_BY_TYPE[contentType.split(";")[0] ?? ""] : undefined;
  return `generation.${extension ?? "bin"}`;
}

function clickDownload(href: string, filename: string, openInNewTab = false) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  if (openInNewTab) anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Download a generated image or video. Fetching to a blob makes `download`
 * reliable for same-origin and CORS-enabled media; the direct-link fallback
 * still handles storage URLs that intentionally disallow fetch access.
 */
export async function downloadMedia(url: string, filename?: string): Promise<void> {
  if (typeof document === "undefined" || !url) return;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed with ${response.status}`);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    clickDownload(objectUrl, filename ?? filenameFromUrl(url, blob.type));
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    clickDownload(url, filename ?? filenameFromUrl(url), true);
  }
}
