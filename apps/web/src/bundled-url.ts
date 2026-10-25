/** Bundled assets share Vite's deployment base, including project Pages prefixes. */
export function bundledAssetUrl(
  path: string,
  baseUrl = import.meta.env.BASE_URL,
  documentUrl = document.baseURI,
): string {
  return new URL(path.replace(/^\/+/, ""), new URL(baseUrl, documentUrl)).href;
}
