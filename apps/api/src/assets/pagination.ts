import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { digest, fail } from "@album/server-core";
/** Process-scoped signing key: a restart expires outstanding cursors. */
const cursorSecret = randomBytes(32);
export function pageLimit(value: number | undefined) {
  const limit = value ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail("INVALID_REQUEST");
  return limit;
}
export function validateSearch(q: string | undefined) {
  if (
    q !== undefined &&
    (typeof q !== "string" || [...q].length < 1 || [...q].length > 100)
  )
    fail("INVALID_REQUEST");
  return q?.normalize("NFC") ?? null;
}
export function pageCursor(
  scope: string,
  wid: string,
  filters: unknown,
  position: { id: string; value?: string },
) {
  const payload = Buffer.from(
    JSON.stringify({
      scope,
      wid,
      filters: digest(JSON.stringify(filters)),
      position,
      expires: Date.now() + 3600000,
    }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", cursorSecret).update(payload).digest("base64url")
  );
}
export function readPageCursor(
  token: string | null | undefined,
  scope: string,
  wid: string,
  filters: unknown,
): { id: string; value?: string } | null {
  if (token === undefined || token === null) return null;
  try {
    if (typeof token !== "string" || token.length < 1 || token.length > 2048)
      throw Error();
    const [payload, signature, ...rest] = token.split(".");
    if (rest.length || !payload || !signature) throw Error();
    const expected = createHmac("sha256", cursorSecret)
        .update(payload)
        .digest(),
      actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw Error();
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      parsed.scope !== scope ||
      parsed.wid !== wid ||
      parsed.filters !== digest(JSON.stringify(filters)) ||
      !Number.isSafeInteger(parsed.expires) ||
      parsed.expires <= Date.now() ||
      !parsed.position ||
      typeof parsed.position.id !== "string" ||
      parsed.position.id.length < 1 ||
      parsed.position.id.length > 128 ||
      (parsed.position.value !== undefined &&
        typeof parsed.position.value !== "string")
    )
      throw Error();
    return parsed.position;
  } catch {
    fail("INVALID_CURSOR");
  }
}
