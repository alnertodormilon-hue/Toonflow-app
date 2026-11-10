const rules = [
  { type: "input", field: "baseUrl" as const, title: "本机网关地址", value: "", props: { placeholder: "在设置→豆包账号中一键配置" } },
  { type: "input", field: "apiKey" as const, title: "本机网关Key", value: "", props: { type: "password", showPassword: true, autocomplete: "off" } },
  { type: "input", field: "accountId" as const, title: "固定账号ID（留空使用默认账号）", value: "" },
] as const;

function endpoint(base: string, path: string) {
  const url = new URL(base.replace(/\/+$/, "") + path);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.hash)
    throw new Error("豆包本机网关必须是本机HTTP地址");
  return url.toString();
}

async function jsonRequest(context: ProviderContext, path: string, body?: unknown) {
  const response = await context.tool.fetch(endpoint(String(context.config.baseUrl), path), {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${context.config.apiKey}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: context.signal,
  });
  const value = await response.json() as { code: number; data: any; message: string };
  if (!response.ok || value.code !== 200) throw Object.assign(new Error(value.message || `本机网关请求失败（${response.status}）`),
    { code: value.data?.code ?? "DOUBAO_GATEWAY_ERROR", status: response.status });
  return value.data;
}

function wait(signal: AbortSignal | undefined) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(done, 3000);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export default {
  id: "doubaoLocalVideo",
  label: "豆包本机视频",
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%233b82f6'/%3E%3Cpath d='M10 8h5a8 8 0 0 1 0 16h-5zm4 4v8h1a4 4 0 0 0 0-8z' fill='white'/%3E%3C/svg%3E",
  version: "1.1.0",
  readme: "Windows自有账号。在设置→豆包账号保存登录并选择默认账号后，画布点击生成将自动准备素材和提交。登录、人机验证及新的付费或素材授权提示需要本人处理；受理未知不自动换号重投。准确免费余额仍显示未知。",
  rules,
  models: [{ id: "seedance_v2.0_mini", label: "Seedance 2.0 Mini（账号自动提交）", type: "video", mode: [["imageReference:2"]], audio: true,
    durationResolutionMap: [{ duration: [15], resolution: ["720p"] }] }],
  async getPrice() { return { price: "账号权益", tips: "准确免费余额未知；请在官方窗口核对本次权益。" }; },
  async generateVideo(request) {
    if (request.model !== "seedance_v2.0_mini" || request.duration !== 15 || request.ratio !== "9:16" || request.resolution !== "720p")
      throw new Error("豆包首版仅支持Mini、15秒、9:16、720p");
    if (request.firstFrame || request.lastFrame || request.videos?.length || request.audios?.length || request.generateAudio === false)
      throw new Error("豆包首版只接收两张普通PNG参考图并保留原生音轨，不支持首尾帧、音视频参考或静音控制");
    if (request.images?.length !== 2 || request.images.some(image => image.type === "url" || image.mimeType !== "image/png"))
      throw new Error("请选择两张本机PNG作为普通参考图");
    const operationId = request.other?.operationId;
    if (typeof operationId !== "string" || !/^[0-9a-f-]{36}$/i.test(operationId))
      throw new Error("豆包任务需要稳定操作号，请通过视频节点发起或传入operationId；断线后沿用同一操作号");
    if (!request.prompt.trim()) throw new Error("请输入完整提示词");
    const assetIds: string[] = [];
    for (const input of request.images) {
      this.signal?.throwIfAborted();
      const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.type === "base64" ? input.data : "";
      const asset = await jsonRequest(this, "/asset", { data });
      assetIds.push(asset.id);
    }
    let job = await jsonRequest(this, "/create", { clientRequestId: operationId, model: request.model, prompt: request.prompt,
      duration: request.duration, ratio: request.ratio, resolution: request.resolution, assetIds,
      ...(this.config.accountId ? { accountId: this.config.accountId } : {}) });
    const end = Date.now() + 45 * 60_000;
    while (Date.now() < end) {
      this.signal?.throwIfAborted();
      if (job.state === "completed") {
        const response = await this.tool.fetch(endpoint(this.config.baseUrl, `/content?id=${encodeURIComponent(job.id)}`), {
          headers: { Authorization: `Bearer ${this.config.apiKey}` }, signal: this.signal,
        });
        if (!response.ok) throw new Error("原视频读取失败，请恢复同一任务，不要重新生成");
        const expected = Number(response.headers.get("content-length"));
        if (expected > 100 * 1024 * 1024) { await response.body?.cancel(); throw new Error("视频超过100MiB交付限制"); }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("原视频内容为空");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 100 * 1024 * 1024) throw new Error("视频超过100MiB交付限制");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        if (!size || expected && expected !== size) throw new Error("原视频下载长度不符，请恢复同一任务");
        return [{ mediaType: "video", type: "binary", data: new Uint8Array(Buffer.concat(chunks, size)), mimeType: "video/mp4" }];
      }
      if (["needsLogin", "needsConfirmation", "needsVerification", "submissionUnknown", "downloadFailed"].includes(job.state))
        throw Object.assign(new Error(`${job.message} 操作号：${operationId}。请在设置→豆包账号处理后，回原节点继续。`), { code: "DOUBAO_ACTION_REQUIRED" });
      if (["failed", "cancelled"].includes(job.state)) throw Object.assign(new Error(job.message || "原任务已结束"), { code: job.state === "cancelled" ? "DOUBAO_CANCELLED" : "DOUBAO_FAILED" });
      await wait(this.signal);
      job = await jsonRequest(this, `/task?id=${encodeURIComponent(job.id)}`);
    }
    throw Object.assign(new Error("本次等待已结束，原任务保留；请用相同操作号继续查询。"), { code: "DOUBAO_ACTION_REQUIRED" });
  },
} satisfies ProviderDefinition<typeof rules>;
