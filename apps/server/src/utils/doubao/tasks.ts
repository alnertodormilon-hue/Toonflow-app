import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import type { HTTPRequest, Page } from "puppeteer-core";
import { assertIdentity, getProfile, officialJson } from "./browser";
import { dataRoot, getAsset, getJob, patchJob } from "./store";
import { canonical, invalid, object, type Job } from "./types";
import { messageText, referenceUris, responseObjects, uploadedUri, validateInitialRequest, videoObjects, visitValues } from "./protocol";
import { configureVideoPage, writeVideoText, sendVideoText } from "./officialPage";

const pages = new Map<string, Page>();
const preparing = new Map<string, Promise<void>>();
const refreshing = new Map<string, Promise<Job>>();
const opening = new Map<string, Promise<Page>>();
const observers = new Map<string, { until: number; timer?: ReturnType<typeof setTimeout> }>();
const financialOrRights = /付费|收费|扣费|积分|充值|购买|开通会员|版权|侵权|责任|素材授权|授权声明/;

function observeJob(id: string) {
  if (observers.has(id)) return;
  const observer = { until: Date.now() + 45 * 60_000, timer: undefined as ReturnType<typeof setTimeout> | undefined };
  observers.set(id, observer);
  const poll = async () => {
    try {
      const job = await refreshJob(id);
      if (["completed", "failed", "cancelled", "downloadFailed", "needsVerification", "needsLogin", "submissionUnknown"].includes(job.state)) {
        observers.delete(id);
        return;
      }
    } catch {
      // ACT: 只读查询失败保留原任务；不重发、换号或自动恢复下载。
    }
    if (Date.now() >= observer.until) { observers.delete(id); return; }
    observer.timer = setTimeout(() => { void poll(); }, 15000);
    observer.timer.unref?.();
  };
  observer.timer = setTimeout(() => { void poll(); }, 15000);
  observer.timer.unref?.();
}

function updateFailure(id: string, error: unknown, blocked = false) {
  const job = getJob(id);
  if (["completed", "cancelled", "failed"].includes(job.state)) return;
  const stageCodes = { openingPage: "OFFICIAL_PAGE_NOT_READY", selectingVideo: "VIDEO_PARAMETERS_NOT_READY",
    uploadingReferences: "UPLOAD_BINDING_UNKNOWN", writingPrompt: "VIDEO_EDITOR_NOT_READY", sending: "SUBMISSION_NOT_ACKNOWLEDGED" };
  const code = typeof object(error).code === "string" ? object(error).code as string : stageCodes[job.stage ?? "openingPage"];
  const safeMessages: Record<string, string> = {
    LOGIN_REQUIRED: "请在官方窗口完成登录，并在豆包账号设置中保存登录状态。",
    ACCOUNT_MISMATCH: "登录身份与任务账号不一致，请恢复原账号。",
    INTENT_MISMATCH: "实际发送内容或参数不一致，已阻止；请核对完整原文、两图与Mini参数。",
    CONVERSATION_NOT_NEW: "请在官方窗口新建对话后继续，避免和旧视频串联。",
    UPLOAD_BINDING_UNKNOWN: "图片资源未能唯一核验，请停止提交并检查官方页面。",
    DUPLICATE_SUBMISSION_BLOCKED: "已阻止额外生成请求。请只读核对原任务，不要再次点击发送。",
    PAID_OR_RIGHTS_CONFIRMATION: "官方回复涉及费用或素材责任，程序不会继续确认，请本人查看。",
    OFFICIAL_PAGE_NOT_READY: "豆包官方页面加载未完成，本次尚未发送。请检查官方窗口和网络后，在原节点重新开始。",
    VIDEO_PARAMETERS_NOT_READY: "未能自动打开视频模式或设定Mini、15秒、9:16，本次尚未发送。",
    VIDEO_EDITOR_NOT_READY: "官方视频输入框尚未准备完成，本次尚未发送。",
    SUBMISSION_NOT_ACKNOWLEDGED: "已操作发送，但尚未确认受理，请保留原任务并只读核对，不要重发。",
  };
  const attempted = job.initialSent || job.initialAttempted && !blocked;
  patchJob(id, { state: attempted ? job.conversationId ? "needsConfirmation" : "submissionUnknown"
    : code === "LOGIN_REQUIRED" || code === "ACCOUNT_MISMATCH" ? "needsLogin" : "failed",
    initialAttempted: blocked && !job.initialSent ? false : job.initialAttempted,
    errorCode: code, canConfirmParameters: false, message: safeMessages[code] ?? (attempted
      ? "原任务发生异常，请保留记录并只读核对，程序不会重新提交。"
      : "豆包自动准备未完成，本次尚未发送；账号已释放，可在原节点重新开始。") });
}

async function intercept(id: string, request: HTTPRequest) {
  if (request.isInterceptResolutionHandled()) return;
  const url = new URL(request.url());
  if (url.origin !== "https://www.doubao.com" || url.pathname !== "/chat/completion" || request.method() !== "POST") {
    await request.continue();
    return;
  }
  try {
    let job = getJob(id);
    const page = pages.get(id);
    if (!page || ["cancelled", "completed", "failed"].includes(job.state)) invalid("本任务不再允许提交", 409, "DUPLICATE_SUBMISSION_BLOCKED");
    await assertIdentity(job.accountId, page);
    job = getJob(id);
    if (["cancelled", "completed", "failed"].includes(job.state)) invalid("任务已结束", 409, "DUPLICATE_SUBMISSION_BLOCKED");
    const data = JSON.parse(request.postData() ?? "{}");
    if (!job.initialSent) {
      const binding = validateInitialRequest(object(data), job);
      patchJob(id, { initialSent: true, sendStartedAt: job.sendStartedAt ?? new Date().toISOString(),
        localMessageId: binding.localMessageId, localMessageIds: binding.localMessageIds, state: "submitting", errorCode: undefined,
        message: "已记录一次发送动作，正在等待官方回执。" });
    } else {
      const messages = object(data).messages;
      const text = Array.isArray(messages) && messages.length === 1 ? canonical(messageText(messages[0])) : "";
      const expected = ["确认生成", "确认，开始生成", "确认"].flatMap(value => [value, `生成视频：${value}，${job.ratio}，${job.duration}s，${job.resolution}`]);
      if (!(job.state === "needsConfirmation" || job.automatic && job.confirmationAttempted)
        || !job.canConfirmParameters || job.confirmationSent || !job.conversationId
        || object(data).conversation_id !== job.conversationId || !expected.includes(text))
        invalid("禁止重复发送或接受未核对的确认条件", 409, "DUPLICATE_SUBMISSION_BLOCKED");
      if (referenceUris(messages[0]).length) invalid("确认阶段不允许替换或追加参考图", 409, "INTENT_MISMATCH");
      const localMessageId = object(messages[0]).local_message_id;
      if (typeof localMessageId !== "string" || !localMessageId) invalid("确认请求缺少消息标识", 409, "INTENT_MISMATCH");
      patchJob(id, { confirmationSent: true, confirmationLocalMessageId: localMessageId, canConfirmParameters: false,
        state: "submitting", message: "已记录同会话参数确认一次，等待原任务回执。" });
    }
    if (!request.isInterceptResolutionHandled()) await request.continue();
    observeJob(id);
  } catch (error) {
    if (!request.isInterceptResolutionHandled()) await request.abort("blockedbyclient");
    updateFailure(id, error, true);
  }
}

async function observeResponse(id: string, text: string) {
  const job = getJob(id);
  if (["completed", "cancelled", "failed"].includes(job.state)) return;
  let conversationId = job.conversationId;
  let needsVerification = false;
  for (const item of responseObjects(text)) visitValues(item, (key, value) => {
    if (key === "conversation_id" && typeof value === "string" && value !== "0" && /^[a-zA-Z0-9_-]{1,160}$/.test(value)) {
      if (conversationId && conversationId !== value) invalid("回执会话归属不一致", 409, "INTENT_MISMATCH");
      conversationId = value;
    }
    if ((key === "type" && value === "verify") || (key === "error_code" && String(value) === "710022004")) needsVerification = true;
  });
  if (needsVerification) {
    patchJob(id, { conversationId, state: "needsVerification", message: "请本人在官方窗口完成验证；之后先核对原任务，程序不会重放生成。" });
    return;
  }
  if (!conversationId) {
    patchJob(id, { state: "submissionUnknown", message: "没有取得可追踪的会话回执，请保留任务并只读核对，不要重投。" });
    return;
  }
  patchJob(id, { conversationId, state: "awaitingTask", message: "消息已取得会话标识，等待实际视频任务。" });
  await refreshJob(id);
  observeJob(id);
}

async function createTaskPage(id: string) {
  const existing = pages.get(id);
  if (existing && !existing.isClosed()) return existing;
  const job = getJob(id);
  const { browser } = await getProfile(job.accountId);
  const page = await browser.newPage();
  pages.set(id, page);
  if (!getJob(id).initialSent) patchJob(id, { referenceUris: [] });
  page.once("close", () => { if (pages.get(id) === page) pages.delete(id); });
  await page.setRequestInterception(true);
  await page.setBypassServiceWorker(true);
  page.on("request", request => { void intercept(id, request).catch(() => updateFailure(id, new Error("官方请求拦截异常"))); });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin !== "https://www.doubao.com" || url.pathname !== "/chat/completion") return;
    void response.text().then(text => observeResponse(id, text)).catch(error => updateFailure(id, error));
  });
  await page.goto(`https://www.doubao.com/chat/${job.conversationId ? encodeURIComponent(job.conversationId) : ""}`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  return page;
}

function taskPage(id: string) {
  let operation = opening.get(id);
  if (!operation) {
    operation = createTaskPage(id).finally(() => opening.delete(id));
    opening.set(id, operation);
  }
  return operation;
}

async function prepare(id: string) {
  let job = getJob(id);
  if (job.initialSent || job.initialAttempted || ["completed", "cancelled", "failed"].includes(job.state)) invalid("原任务已开始或结束，请仅查询原任务", 409, "ALREADY_DISPATCHED");
  patchJob(id, { state: "preparing", stage: "openingPage", message: "正在打开关联账号的豆包官方页面。", errorCode: undefined });
  const page = await taskPage(id);
  await assertIdentity(job.accountId, page);
  job = getJob(id);
  if (job.state === "cancelled") return;
  patchJob(id, { stage: "selectingVideo", message: "正在自动切换视频生成，并设定Mini、15秒、9:16。" });
  await configureVideoPage(page);
  if (getJob(id).state === "cancelled") return;
  patchJob(id, { stage: "uploadingReferences", message: "正在自动上传并核对两张参考图。" });
  if (job.referenceUris?.length !== 2) {
    const uris: string[] = [...(job.referenceUris ?? [])];
    for (const assetId of job.assetIds.slice(uris.length)) {
      if (getJob(id).state === "cancelled") return;
      const input = await page.waitForSelector('input[type="file"][accept*=".png"]', { timeout: 30000 });
      if (!input) invalid("官方页面尚未出现图片上传入口", 409, "UPLOAD_BINDING_UNKNOWN");
      const asset = getAsset(assetId);
      if (createHash("sha256").update(await readFile(asset.path)).digest("hex") !== asset.sha256)
        invalid("冻结参考图字节发生变化", 409, "INTENT_MISMATCH");
      const uploaded = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.protocol === "https:" && url.searchParams.get("Action") === "CommitImageUpload";
      }, { timeout: 90000 });
      const [response] = await Promise.all([uploaded, input.uploadFile(asset.path)]);
      if (!response.ok()) invalid("官方参考图上传失败", 409, "UPLOAD_BINDING_UNKNOWN");
      uris.push(uploadedUri(await response.json()));
      patchJob(id, { referenceUris: [...uris] });
    }
    patchJob(id, { referenceUris: uris });
  }
  if (getJob(id).state === "cancelled") return;
  patchJob(id, { stage: "writingPrompt", message: "正在自动填写完整提示词。" });
  await writeVideoText(page, job.prompt);
  if (getJob(id).state === "cancelled") return;
  if (!job.automatic) {
    patchJob(id, { state: "needsConfirmation", message: "旧版任务保留官方确认方式，请在官方窗口核对后发送一次。" });
    await page.bringToFront();
    return;
  }
  await sendVideoText(page, () => {
    const current = getJob(id);
    if (current.state !== "preparing" || current.initialAttempted || current.initialSent) invalid("本任务不再允许发送", 409, "DUPLICATE_SUBMISSION_BLOCKED");
    patchJob(id, { initialAttempted: true, sendStartedAt: new Date().toISOString(), state: "submitting", stage: "sending",
      message: "正在自动提交一次，等待豆包受理。" }, current.stateVersion);
  });
  observeJob(id);
}

export function prepareJob(id: string) {
  let operation = preparing.get(id);
  if (!operation) {
    operation = prepare(id).catch(error => updateFailure(id, error)).finally(() => preparing.delete(id));
    preparing.set(id, operation);
  }
  return operation;
}

function allowedMedia(value: string) {
  const url = new URL(value);
  const suffixes = ["doubaocdn.com", "byteimg.com", "ibytedtos.com", "douyin.com", "douyinvod.com", "volces.com"];
  return url.protocol === "https:" && !url.username && !url.password && suffixes.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

function videoIdentifier(video: Record<string, any>) {
  const model = typeof video.video_model === "string" ? object(JSON.parse(video.video_model)) : object(video.video_model);
  return video.vid ?? model.video_id;
}

async function download(id: string, page: Page, video: Record<string, any>) {
  const original = getJob(id);
  const vid = videoIdentifier(video);
  if (typeof vid !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(vid)) invalid("视频标识无效", 409, "VIDEO_BINDING_UNKNOWN");
  patchJob(id, { state: "downloading", videoId: vid, message: "上游视频已完成，正在获取官方无可见水印导出。" });
  const exported = await officialJson(page, "/creativity/resource/get_without_watermark", { vid: [vid] });
  const data = object(exported.data);
  const item = object(object(data.download_video)[vid]);
  if (exported.code !== 0 || data.without_watermark !== true || item.vid !== vid || typeof item.download_url !== "string")
    invalid("官方无可见水印导出暂不可用", 409, "OFFICIAL_EXPORT_UNAVAILABLE");
  let url = item.download_url;
  let response: Response | undefined;
  for (let redirects = 0; redirects < 4; redirects++) {
    if (!allowedMedia(url)) invalid("官方媒体来源不在已核验范围", 409, "MEDIA_SOURCE_UNSUPPORTED");
    response = await fetch(url, { redirect: "manual", headers: { Accept: "video/mp4", "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(90000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) invalid("媒体重定向无效", 409, "DOWNLOAD_INTEGRITY_FAILED");
    url = new URL(location, url).toString();
  }
  if (!response?.ok || !response.body) invalid("视频下载未成功，保留原任务等待恢复", 409, "DOWNLOAD_FAILED");
  const expected = Number(response.headers.get("content-length")) || 0;
  if (expected > 100 * 1024 * 1024) { await response.body.cancel(); invalid("结果超过100MiB交付限制", 413, "RESULT_TOO_LARGE"); }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100 * 1024 * 1024) invalid("结果超过100MiB交付限制", 413, "RESULT_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks, size);
  if (size < 12 || expected && expected !== size || bytes.subarray(4, 8).toString() !== "ftyp")
    invalid("视频长度或MP4格式检查失败", 409, "DOWNLOAD_INTEGRITY_FAILED");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const directory = join(dataRoot(), "videos");
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${id}.mp4`);
  try { await writeAtomic(target, bytes, { exclusive: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (createHash("sha256").update(await readFile(target)).digest("hex") !== sha256) {
      if (original.state !== "downloadFailed" || !original.sha256 || sha256 !== original.sha256) throw error;
      await writeAtomic(target, bytes);
    }
  }
  return patchJob(id, { state: "completed", outputPath: target, bytes: size, sha256, errorCode: undefined,
    message: "官方无可见水印视频已完整保存，可在原视频节点继续取回。" });
}

async function refresh(id: string, allowDownload: boolean) {
  const job = getJob(id);
  if ((job.initialSent || job.initialAttempted) && !job.conversationId && job.state === "submitting" && Date.now() - Date.parse(job.updatedAt) > 90000)
    return patchJob(id, { state: "submissionUnknown", message: "发送后仍未取得可追踪回执，请只读核对；不会重新提交。" });
  if (!job.conversationId || !job.initialSent || ["completed", "cancelled", "failed"].includes(job.state)) return job;
  if (job.state === "downloadFailed" && !allowDownload) return job;
  const { page } = await getProfile(job.accountId);
  await assertIdentity(job.accountId, page);
  const result = await officialJson(page, "/im/chain/single", {
    cmd: 3100, uplink_body: { pull_singe_chain_uplink_body: { conversation_id: job.conversationId,
      anchor_index: 9007199254740991, conversation_type: job.conversationType ?? 3, direction: 1, limit: 100,
      ext: {}, filter: { index_list: [] }, evaluate_ab_params: "", evaluate_common_params: "", option: { lazy_load_strategy: 0 } } },
    sequence_id: randomUUID(), channel: 2, version: "1",
  });
  if (result.status_code !== 0) invalid("原会话暂不可读取，请稍后只读恢复", 409, "UPSTREAM_READ_FAILED");
  const messages = object(object(result.downlink_body).pull_singe_chain_downlink_body).messages;
  if (!Array.isArray(messages)) invalid("原会话结构发生变化", 409, "UPSTREAM_READ_FAILED");
  const initialIds = job.localMessageIds ?? [job.localMessageId];
  const questions = initialIds.map(localId => messages.find(value => object(value).local_message_id === localId));
  if (questions.some(value => !value)) return patchJob(id, Date.now() - Date.parse(job.sendStartedAt ?? job.updatedAt) < 90000
    ? { state: "awaitingTask", message: "已取得会话回执，正在等待本次图片与正文消息同步。" }
    : { state: "submissionUnknown", message: "未找到本任务全部实际消息，保留原任务，只读核对。" });
  const expected = [job.prompt, `生成视频：${job.prompt}，${job.ratio}，${job.duration}s，${job.resolution}`].map(canonical);
  if (!expected.includes(canonical(questions.map(messageText).filter(Boolean).join("\n")))
    || JSON.stringify(questions.flatMap(referenceUris)) !== JSON.stringify(job.referenceUris))
    invalid("服务端原文或图片绑定不一致，停止取回", 409, "INTENT_MISMATCH");
  const users = messages.filter(value => object(value).user_type === 1);
  if (users.some(value => ![...initialIds, job.confirmationLocalMessageId].includes(object(value).local_message_id)))
    invalid("原会话存在其他用户消息，无法唯一绑定任务", 409, "CONVERSATION_AMBIGUOUS");
  const replies = messages.filter(value => object(value).user_type !== 1);
  const videos = replies.flatMap(videoObjects);
  const finished = videos.filter(video => video.status === 3 && video.download_url);
  if (finished.length > 1) invalid("原任务出现多个视频，不自动选择", 409, "MULTIPLE_VIDEO_RESULTS");
  if (finished.length === 1) {
    if (job.videoId && videoIdentifier(finished[0]!) !== job.videoId)
      invalid("原视频标识发生变化，停止下载", 409, "VIDEO_BINDING_UNKNOWN");
    try { return await download(id, page, finished[0]!); }
    catch (error) { return patchJob(id, { state: "downloadFailed", errorCode: object(error).code ?? "DOWNLOAD_FAILED",
      message: "上游视频已生成，但导出或下载未完成。请恢复下载，不要重新生成。" }); }
  }
  if (job.videoId) return patchJob(id, { state: "downloadFailed", message: "未找到已绑定视频的完成对象，请稍后恢复原视频下载。" });
  const tasks = replies.flatMap(value => {
    try { const list = JSON.parse(String(object(object(value).ext).ai_creation_tool_list ?? "[]")); return Array.isArray(list) ? list : []; }
    catch { return []; }
  });
  if (tasks.some(value => ![undefined, null, 0, "0", ""].includes(object(value).fail_code)))
    return patchJob(id, { state: "failed", errorCode: "UPSTREAM_VIDEO_FAILED", message: "官方原视频任务返回失败；程序未重新提交。" });
  if (videos.length || tasks.length) return patchJob(id, { state: "generating", message: "已发现本任务视频对象，正在等待原视频完成。" });
  const clarifying = replies.find(value => object(object(value).ext).is_creation_clarifying === "1");
  if (clarifying) {
    if (job.confirmationSent || job.confirmationAttempted) return patchJob(id, { state: "awaitingTask", message: "已确认原参数，等待实际视频任务；不会重复确认。" });
    const text = messageText(clarifying);
    const safe = !financialOrRights.test(text) && /(?:15\s*秒|15s)/i.test(text) && text.includes("9:16") && /Mini/i.test(text) && /720p/i.test(text);
    const current = patchJob(id, { state: "needsConfirmation", canConfirmParameters: safe,
      errorCode: safe ? undefined : "CONFIRMATION_NOT_ALLOWED",
      message: safe ? "官方要求确认原参数。" : "官方确认条件无法严格核对或涉及新授权，已停止自动提交。" });
    if (!job.automatic || !safe) return current;
    const task = await taskPage(id);
    await assertIdentity(job.accountId, task);
    await writeVideoText(task, "确认生成");
    await sendVideoText(task, () => {
      const latest = getJob(id);
      if (latest.confirmationAttempted || latest.confirmationSent || !latest.canConfirmParameters)
        invalid("原参数确认已操作，不能再次提交", 409, "DUPLICATE_SUBMISSION_BLOCKED");
      patchJob(id, { state: "submitting", confirmationAttempted: true, message: "正在自动确认同一任务的原参数一次。" }, latest.stateVersion);
    });
    return getJob(id);
  }
  return patchJob(id, { state: "awaitingTask", message: "已找到原消息，实际视频任务尚未出现；继续查询，不重发。" });
}

export function refreshJob(id: string, allowDownload = false) {
  let operation = refreshing.get(id);
  if (!operation) {
    operation = refresh(id, allowDownload).finally(() => refreshing.delete(id));
    refreshing.set(id, operation);
  }
  return operation;
}

export async function openJob(id: string) {
  const page = await taskPage(id);
  await page.bringToFront();
  return getJob(id);
}

export async function resumeJob(id: string, mode: "prepare" | "reconcile" | "download", version: number) {
  const job = getJob(id);
  if (job.stateVersion !== version) invalid("任务状态已变化，请刷新后恢复", 409, "STALE_ACTION");
  if (mode === "prepare") {
    if (job.initialSent || job.initialAttempted || ["completed", "cancelled", "failed"].includes(job.state)) invalid("此任务只允许原任务查询", 409, "ALREADY_DISPATCHED");
    void prepareJob(id);
    return getJob(id);
  }
  const result = await refreshJob(id, mode === "download");
  if (result.conversationId) observeJob(id);
  return result;
}
