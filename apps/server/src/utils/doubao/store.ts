import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdirSync } from "@toonflow/file";
import conf from "@/utils/conf";
import { invalid, pendingStates, type Account, type Asset, type Job, type JobState, type VideoIntent } from "./types";

let database: Database | undefined;

export function dataRoot() {
  const directory = join(dirname(conf.path), "doubao");
  mkdirSync(directory, { recursive: true });
  return directory;
}

function db() {
  if (database) return database;
  database = new Database(join(dataRoot(), "gateway.sqlite"), { create: true });
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, operationId TEXT UNIQUE NOT NULL,
      intentHash TEXT NOT NULL, accountId TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS pendingAccount ON jobs(accountId)
      WHERE state IN ('queued','preparing','needsLogin','needsConfirmation','needsVerification','submitting','submissionUnknown','awaitingTask','generating');
    PRAGMA user_version=1;`);
  // ACT: 重启只把发送中改为未知，不重放任何生成。其他任务由用户显式恢复。
  for (const job of listJobs()) {
    if (job.state === "submitting") patchJob(job.id, { state: "submissionUnknown", message: "提交期间服务重启，请先核对原任务。" });
    else if (job.automatic && !job.initialSent && !job.initialAttempted && ["queued", "preparing"].includes(job.state))
      patchJob(job.id, { state: "failed", errorCode: "PREPARATION_INTERRUPTED", message: "准备期间应用重启，本次尚未发送，账号已释放。" });
  }
  return database;
}

function readBody<T>(row: unknown): T | undefined {
  return row ? JSON.parse((row as { body: string }).body) as T : undefined;
}

export function getMetadata(key: string) {
  return (db().query("SELECT value FROM metadata WHERE key=?").get(key) as { value: string } | null)?.value;
}

export function setMetadata(key: string, value: string) {
  db().query("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

export function listAccounts(): Account[] {
  return db().query("SELECT body FROM accounts ORDER BY rowid").all().map(row => readBody<Account>(row)!);
}

export function getAccount(id: string) {
  const result = readBody<Account>(db().query("SELECT body FROM accounts WHERE id=?").get(id));
  if (!result) invalid("找不到豆包账号", 404, "ACCOUNT_NOT_FOUND");
  return result;
}

export function saveAccount(account: Account) {
  account.updatedAt = new Date().toISOString();
  db().query("INSERT INTO accounts(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(account.id, JSON.stringify(account));
  return account;
}

export function removeAccount(id: string) {
  db().transaction(() => {
    getAccount(id);
    if (listJobs().some(job => job.accountId === id && pendingStates.includes(job.state))) invalid("账号还有未决任务，请先处理原任务", 409, "ACCOUNT_BUSY");
    db().query("DELETE FROM accounts WHERE id=?").run(id);
    if (getMetadata("defaultAccountId") === id) setMetadata("defaultAccountId", "");
  }).immediate();
}

export function publicAccount(account: Account) {
  const { sessionCipher, identityHash, ...publicValue } = account;
  return { ...publicValue, sessionReady: !!sessionCipher && !!identityHash, isDefault: getMetadata("defaultAccountId") === account.id,
    quota: { remaining: null, source: "unknown", localObservedCompleted: listJobs().filter(job => job.accountId === account.id && job.state === "completed").length } };
}

export function saveAsset(asset: Asset) {
  db().query("INSERT INTO assets(id,body) VALUES(?,?) ON CONFLICT(id) DO NOTHING").run(asset.id, JSON.stringify(asset));
  return asset;
}

export function getAsset(id: string) {
  const asset = readBody<Asset>(db().query("SELECT body FROM assets WHERE id=?").get(id));
  if (!asset) invalid("参考图不存在，请重新选择素材", 422, "ASSET_NOT_FOUND");
  return asset;
}

export function listJobs(): Job[] {
  return db().query("SELECT body FROM jobs ORDER BY rowid DESC").all().map(row => readBody<Job>(row)!);
}

export function getJob(id: string) {
  const job = readBody<Job>(db().query("SELECT body FROM jobs WHERE id=?").get(id));
  if (!job) invalid("找不到豆包任务", 404, "JOB_NOT_FOUND");
  return job;
}

export function findJobByOperation(operationId: string) {
  return readBody<Job>(db().query("SELECT body FROM jobs WHERE operationId=?").get(operationId));
}

export function createJob(intent: VideoIntent) {
  return db().transaction(() => {
    const account = getAccount(intent.accountId);
    if (account.state === "disabled") invalid("所选账号已禁用", 409, "ACCOUNT_DISABLED");
    const assets = intent.assetIds.map(getAsset);
    const existing = readBody<Job>(db().query("SELECT body FROM jobs WHERE operationId=?").get(intent.clientRequestId));
    const automatic = existing ? !!existing.automatic : true;
    const intentHash = createHash("sha256").update(JSON.stringify({ ...intent, clientRequestId: undefined,
      assetIds: assets.map(asset => asset.sha256), billing: automatic ? "automaticOfficialSubmission" : "officialConfirmation", watermark: "officialWithoutVisible" })).digest("hex");
    if (existing) {
      if (existing.intentHash !== intentHash) invalid("原操作的内容已变化，请先处理原任务或明确新建任务", 409, "IDEMPOTENCY_CONFLICT");
      return { job: existing, created: false };
    }
    if (listJobs().some(job => job.accountId === account.id && pendingStates.includes(job.state))) invalid("此账号还有未决任务，请先恢复或处理原任务", 409, "ACCOUNT_BUSY");
    const now = new Date().toISOString();
    const job: Job = { ...intent, automatic, id: randomUUID(), intentHash, state: "queued", stateVersion: 1, createdAt: now,
      updatedAt: now, initialSent: false, confirmationSent: false, message: "等待准备官方页面" };
    db().query("INSERT INTO jobs(id,operationId,intentHash,accountId,state,body) VALUES(?,?,?,?,?,?)")
      .run(job.id, intent.clientRequestId, intentHash, account.id, job.state, JSON.stringify(job));
    return { job, created: true };
  }).immediate();
}

export function patchJob(id: string, patch: Partial<Job>, expectedVersion?: number) {
  return db().transaction(() => {
    const current = getJob(id);
    if (expectedVersion !== undefined && current.stateVersion !== expectedVersion) invalid("任务状态已变化，请刷新后操作", 409, "STALE_ACTION");
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(current[key as keyof Job]) === JSON.stringify(value))) return current;
    const job = { ...current, ...patch, id: current.id, stateVersion: current.stateVersion + 1, updatedAt: new Date().toISOString() };
    db().query("UPDATE jobs SET state=?,body=? WHERE id=?").run(job.state, JSON.stringify(job), id);
    return job;
  }).immediate();
}

export function publicJob(job: Job) {
  const { outputPath, referenceUris, ...value } = job;
  return { ...value, hasResult: job.state === "completed" && !!outputPath, progress: null };
}

export function cancelJob(id: string, version: number) {
  const job = getJob(id);
  if (job.initialSent || job.initialAttempted || !(["queued", "preparing", "needsLogin", "needsConfirmation"] as JobState[]).includes(job.state))
    invalid("已发送或受理未知的任务不能在本地取消；停止等待不会停止上游生成", 409, "ALREADY_DISPATCHED");
  return patchJob(id, { state: "cancelled", message: "已在发送前取消" }, version);
}
