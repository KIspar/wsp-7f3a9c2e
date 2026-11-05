import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/server/app";
import { publicAccessFromEnv, validBasicAuth } from "../apps/server/access";
import { createStore } from "../apps/server/store";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

describe("线上工作台入口", () => {
  it("rejects insecure configuration and invalid credentials", () => {
    expect(publicAccessFromEnv({})).toBeNull();
    expect(() => publicAccessFromEnv({ STUDIO_PUBLIC_ORIGIN: "http://studio.example" })).toThrow("HTTPS");
    expect(() => publicAccessFromEnv({ STUDIO_PUBLIC_ORIGIN: "https://studio.example" })).toThrow("STUDIO_ACCESS_PASSWORD");
    const access = publicAccessFromEnv({ STUDIO_PUBLIC_ORIGIN: "https://studio.example", STUDIO_ACCESS_PASSWORD: "test-password-long-enough-123" })!;
    expect(validBasicAuth("Basic " + Buffer.from("studio:test-password-long-enough-123").toString("base64"), access)).toBe(true);
    expect(validBasicAuth("Basic " + Buffer.from("studio:wrong-password").toString("base64"), access)).toBe(false);
  });

  it("requires a password for pages and media and accepts only its HTTPS origin", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "studio-public-access-"));
    folders.push(folder);
    const store = createStore(folder, process.cwd());
    const access = publicAccessFromEnv({ STUDIO_PUBLIC_ORIGIN: "https://studio.example", STUDIO_ACCESS_PASSWORD: "test-password-long-enough-123" })!;
    const app = await createApp(store, { worker: false, publicAccess: access });
    const host = { host: "studio.example" };
    const authorization = "Basic " + Buffer.from("studio:test-password-long-enough-123").toString("base64");
    const granted = { ...host, authorization };
    try {
      expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
      const denied = await app.inject({ url: "/api/bootstrap", headers: host });
      expect(denied.statusCode).toBe(401);
      expect(denied.headers["www-authenticate"]).toContain("Basic");
      expect((await app.inject({ url: "/media/missing.jpg", headers: host })).statusCode).toBe(401);
      expect((await app.inject({ url: "/", headers: host })).statusCode).toBe(401);
      expect((await app.inject({ url: "/api/bootstrap", headers: { ...granted, host: "other.example" } })).statusCode).toBe(403);
      const boot = await app.inject({ url: "/api/bootstrap", headers: granted });
      expect(boot.statusCode).toBe(200);
      const token = boot.json().token;
      const settings = store.settings();
      expect((await app.inject({ method: "PUT", url: "/api/settings", headers: { ...granted, origin: "https://evil.example", "x-studio-token": token }, payload: settings })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url: "/api/settings", headers: { ...granted, origin: access.origin, "x-studio-token": token }, payload: settings })).statusCode).toBe(200);
    } finally { await app.close(); store.close(); }
  });
});
