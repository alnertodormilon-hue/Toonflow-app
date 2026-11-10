import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { readFile } from "@toonflow/file";
import { assertAppRequest, getAppOrigin } from "@/utils/mcp/control";
import { decryptSession, encryptSession } from "./credentials";
import { getJob, getMetadata, setMetadata, patchJob } from "./store";
import { invalid } from "./types";

export { acceptAsset } from "./assets";
export { createAccount, openAccount, captureAccount, updateAccount, closeAccount, supported } from "./browser";
export { listAccounts, getAccount, publicAccount, removeAccount, listJobs, getJob, findJobByOperation, createJob, publicJob, cancelJob, getMetadata } from "./store";
export { prepareJob, refreshJob, openJob, resumeJob } from "./tasks";

let keyPromise: Promise<string> | undefined;

function localRequest(req: Request) {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? ""))
    invalid("豆包本机接口仅允许本机访问", 403, "LOCAL_ONLY");
}

export function assertManagement(req: Request) {
  localRequest(req);
  assertAppRequest(req);
}

async function gatewayKey(create = false) {
  const stored = getMetadata("gatewayKeyCipher");
  if (!stored && !create) invalid("请先在豆包账号设置中配置供应商", 401, "AUTH_INVALID");
  keyPromise ??= (async () => {
    if (stored) return decryptSession(stored);
    const key = randomBytes(32).toString("base64url");
    setMetadata("gatewayKeyCipher", await encryptSession(key));
    return key;
  })().catch(error => { keyPromise = undefined; throw error; });
  return keyPromise;
}

export async function configure(req: Request) {
  assertManagement(req);
  const port = req.socket.localPort;
  if (!port) invalid("无法确定本机服务地址", 503, "SERVICE_ADDRESS_UNKNOWN");
  return { providerId: "doubaoLocalVideo", baseUrl: `http://127.0.0.1:${port}/api/doubao/gateway`,
    apiKey: await gatewayKey(true), accountId: "" };
}

export async function assertGateway(req: Request) {
  localRequest(req);
  if (req.get("origin")) getAppOrigin(req);
  const expected = await gatewayKey();
  const actual = req.get("authorization") ?? "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(actual), hash(`Bearer ${expected}`))) invalid("本机网关Key无效", 401, "AUTH_INVALID");
}

export async function videoContent(id: string) {
  const job = getJob(id);
  if (job.state !== "completed" || !job.outputPath || !job.sha256) invalid("视频尚未完整保存，请先恢复原任务", 409, "RESULT_NOT_READY");
  const bytes = await readFile(job.outputPath).catch(() => {
    patchJob(id, { state: "downloadFailed", outputPath: undefined, errorCode: "RESULT_FILE_UNAVAILABLE", message: "本地视频文件不可读取，请恢复原视频下载。" });
    invalid("原视频文件暂不可读取，请恢复下载", 409, "RESULT_FILE_UNAVAILABLE");
  });
  if (bytes.length !== job.bytes || createHash("sha256").update(bytes).digest("hex") !== job.sha256) {
    patchJob(id, { state: "downloadFailed", outputPath: undefined, errorCode: "DOWNLOAD_INTEGRITY_FAILED", message: "本地视频完整性检查失败，请恢复原视频下载。" });
    invalid("已保存视频完整性检查失败，请恢复原任务下载", 409, "DOWNLOAD_INTEGRITY_FAILED");
  }
  return bytes;
}
