import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, rm } from "@toonflow/file";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { findExecutable } from "@toonflow/tool-browser/host";
import { dataRoot, getAccount, listAccounts, listJobs, publicAccount, saveAccount, setMetadata } from "./store";
import { decryptSession, encryptSession } from "./credentials";
import { invalid, object, pendingStates, type Account } from "./types";

type Profile = { browser: Browser; page: Page };
const profiles = new Map<string, Promise<Profile>>();
const officialOrigin = "https://www.doubao.com";
const readPaths = new Set(["/alice/profile/self_brief", "/im/chain/single", "/creativity/resource/get_without_watermark"]);

export function profilePath(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) invalid("账号标识无效");
  return join(dataRoot(), "profiles", id);
}

export function supported() { return process.platform === "win32"; }

export async function officialJson(page: Page, pathname: string, body: unknown) {
  if (!readPaths.has(pathname)) invalid("不允许的官方读取接口", 403);
  if (new URL(page.url()).origin !== officialOrigin) invalid("请先在豆包官方页面完成登录", 409, "LOGIN_REQUIRED");
  const result = await page.evaluate(async ({ pathname, body }) => {
    const response = await fetch(pathname, { method: "POST", credentials: "include",
      headers: { "Content-Type": pathname.startsWith("/im/") ? "application/json; encoding=utf-8" : "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { transportStatus: response.status };
    return response.json();
  }, { pathname, body });
  if (object(result).transportStatus) invalid("豆包读取请求失败，请在官方窗口检查登录状态", 409, "UPSTREAM_READ_FAILED");
  return object(result);
}

export async function identity(page: Page) {
  const result = await officialJson(page, "/alice/profile/self_brief", {});
  const id = object(object(result.data).profile_brief).entity_id;
  if (result.code !== 0 || !id) invalid("尚未登录豆包，请在官方窗口完成登录后保存", 409, "LOGIN_REQUIRED");
  return createHash("sha256").update(String(id)).digest("hex");
}

export async function getProfile(id: string) {
  if (!supported()) invalid("豆包账号管理首版仅支持Windows", 422, "PLATFORM_UNSUPPORTED");
  const account = getAccount(id);
  if (account.state === "disabled") invalid("账号已禁用", 409, "ACCOUNT_DISABLED");
  let pending = profiles.get(id);
  if (pending) return pending;
  pending = (async () => {
    const directory = profilePath(id);
    await mkdir(directory, { recursive: true });
    const browser = await puppeteer.launch({ executablePath: await findExecutable(""), headless: false, pipe: true,
      userDataDir: directory, defaultViewport: null, args: ["--no-first-run", "--no-default-browser-check"] });
    browser.once("disconnected", () => { profiles.delete(id); });
    try {
      const page = (await browser.pages())[0] ?? await browser.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(`${officialOrigin}/chat/`, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (account.sessionCipher) {
        const snapshot = object(JSON.parse(await decryptSession(account.sessionCipher)));
        const current = await identity(page).catch(() => undefined);
        if (!current && Array.isArray(snapshot.cookies)) {
          const cookies = snapshot.cookies.filter((cookie: unknown) => {
            const domain = String(object(cookie).domain ?? "").replace(/^\./, "");
            return domain === "doubao.com" || domain.endsWith(".doubao.com");
          });
          await browser.defaultBrowserContext().setCookie(...cookies);
          if (object(snapshot.localStorage)) await page.evaluate((values: Record<string, unknown>) => {
            globalThis.localStorage.clear();
            for (const [key, value] of Object.entries(values)) if (typeof value === "string") globalThis.localStorage.setItem(key, value);
          }, object(snapshot.localStorage));
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        } else if (current && account.identityHash && current !== account.identityHash) {
          invalid("浏览器账号与已保存身份不一致，请重新登录原账号", 409, "ACCOUNT_MISMATCH");
        }
      }
      return { browser, page };
    } catch (error) { await browser.close(); throw error; }
  })();
  profiles.set(id, pending);
  pending.catch(() => { if (profiles.get(id) === pending) profiles.delete(id); });
  return pending;
}

export async function openAccount(id: string) {
  const { page } = await getProfile(id);
  await page.bringToFront();
  return publicAccount(getAccount(id));
}

export async function captureAccount(id: string) {
  const account = getAccount(id);
  const { browser, page } = await getProfile(id);
  const identityHash = await identity(page);
  if (account.identityHash && account.identityHash !== identityHash) invalid("当前登录身份发生变化，请新建账号档案", 409, "ACCOUNT_MISMATCH");
  if (listAccounts().some(value => value.id !== id && value.identityHash === identityHash))
    invalid("该官方账号已有本地档案，请使用原档案，避免重复计算和并发生成", 409, "ACCOUNT_ALREADY_EXISTS");
  const cookies = (await browser.defaultBrowserContext().cookies()).filter(cookie => {
    const domain = cookie.domain.replace(/^\./, "");
    return domain === "doubao.com" || domain.endsWith(".doubao.com");
  });
  if (!cookies.some(cookie => cookie.name === "sessionid")) invalid("官方登录凭据不完整，请重新登录", 409, "LOGIN_REQUIRED");
  const localStorage = await page.evaluate(() => Object.fromEntries(Object.entries(globalThis.localStorage)));
  const sessionCipher = await encryptSession(JSON.stringify({ cookies, localStorage, userAgent: await browser.userAgent() }));
  saveAccount({ ...account, identityHash, sessionCipher, state: "active" });
  return publicAccount(getAccount(id));
}

export function createAccount(name: string) {
  if (!supported()) invalid("豆包账号管理首版仅支持Windows", 422, "PLATFORM_UNSUPPORTED");
  const now = new Date().toISOString();
  const account: Account = { id: randomUUID(), name: name.trim(), state: "needsLogin", createdAt: now, updatedAt: now };
  return publicAccount(saveAccount(account));
}

export function updateAccount(id: string, patch: { name?: string; enabled?: boolean; isDefault?: boolean }) {
  const account = getAccount(id);
  if (patch.enabled === false && listJobs().some(job => job.accountId === id && pendingStates.includes(job.state)))
    invalid("账号还有未决任务，暂时不能禁用", 409, "ACCOUNT_BUSY");
  if (patch.isDefault) setMetadata("defaultAccountId", id);
  return publicAccount(saveAccount({ ...account, name: patch.name?.trim() ?? account.name,
    state: patch.enabled === undefined ? account.state : patch.enabled ? account.sessionCipher ? "active" : "needsLogin" : "disabled" }));
}

export async function closeAccount(id: string, removeProfile = false) {
  const pending = profiles.get(id);
  if (pending) await (await pending).browser.close();
  profiles.delete(id);
  if (removeProfile) await rm(profilePath(id), { recursive: true, force: true });
}

export async function assertIdentity(id: string, page: Page) {
  const account = getAccount(id);
  if (account.state !== "active" || !account.identityHash || await identity(page) !== account.identityHash)
    invalid("请核对并保存当前账号的官方登录状态", 409, "ACCOUNT_MISMATCH");
}
