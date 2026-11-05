import { createHash, timingSafeEqual } from "node:crypto";

export type PublicAccess = {
  origin: string;
  host: string;
  username: string;
  password: string;
};

export function publicAccessFromEnv(env: NodeJS.ProcessEnv = process.env): PublicAccess | null {
  const raw = env.STUDIO_PUBLIC_ORIGIN?.trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("STUDIO_PUBLIC_ORIGIN 必须是 HTTPS 站点地址"); }
  if (url.protocol !== "https:" || url.origin !== raw.replace(/\/$/, "")) {
    throw new Error("STUDIO_PUBLIC_ORIGIN 必须是无路径的 HTTPS 站点地址");
  }
  const password = env.STUDIO_ACCESS_PASSWORD || "";
  if (password.length < 20 || password.length > 200) {
    throw new Error("线上部署必须设置 20–200 位的 STUDIO_ACCESS_PASSWORD");
  }
  const username = env.STUDIO_ACCESS_USER || "studio";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(username)) {
    throw new Error("STUDIO_ACCESS_USER 只能包含英文、数字、下划线和连字符");
  }
  return { origin: url.origin, host: url.host, username, password };
}

export function validBasicAuth(header: string | undefined, access: PublicAccess): boolean {
  if (!header?.startsWith("Basic ") || header.length > 1000) return false;
  const supplied = Buffer.from(header.slice(6), "base64").toString("utf8");
  const expectedDigest = createHash("sha256").update(access.username + ":" + access.password).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}
