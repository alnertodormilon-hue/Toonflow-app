import { canonical, invalid, object, type Job } from "./types";

export function messageText(message: unknown) {
  const blocks = object(message).content_block;
  if (!Array.isArray(blocks)) return "";
  return blocks.map(block => object(object(object(block).content).text_block).text).filter(value => typeof value === "string").join("\n");
}

export function referenceUris(message: unknown) {
  const blocks = object(message).content_block;
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap(block => {
    const attachments = object(object(object(block).content).attachment_block).attachments;
    return Array.isArray(attachments) ? attachments.map(value => object(object(value).image).uri).filter(value => typeof value === "string") as string[] : [];
  });
}

export function validateInitialRequest(payload: Record<string, any>, job: Job) {
  const ability = object(payload.chat_ability);
  let params = ability.ability_param;
  if (typeof params === "string") params = JSON.parse(params);
  params = object(params);
  if (ability.ability_type !== 17 || params.model !== job.model || Number(params.duration) !== job.duration
    || params.ratio !== job.ratio || params.resolution !== job.resolution)
    invalid("请在官方窗口选择Mini、15秒、9:16、720p；当前请求参数与任务不一致", 409, "INTENT_MISMATCH");
  const messages = payload.messages;
  if (!Array.isArray(messages) || messages.length !== 1) invalid("生成请求消息结构发生变化，请停止并检查", 409, "INTENT_MISMATCH");
  const actualText = canonical(messageText(messages[0]));
  const expected = [job.prompt, `生成视频：${job.prompt}，${job.ratio}，${job.duration}s，${job.resolution}`].map(canonical);
  if (!expected.includes(actualText)) invalid("实际发送正文与冻结提示词不一致，已阻止提交", 409, "INTENT_MISMATCH");
  const cached = object(params.input_box_content).user_input_content;
  if (typeof cached !== "string" || canonical(cached) !== canonical(job.prompt)) invalid("输入框缓存与冻结原文不一致", 409, "INTENT_MISMATCH");
  const refs = referenceUris(messages[0]);
  if (job.referenceUris?.length !== 2 || JSON.stringify(refs) !== JSON.stringify(job.referenceUris))
    invalid("实际图片数量或顺序与已上传参考图不一致，已阻止提交", 409, "INTENT_MISMATCH");
  const localMessageId = object(messages[0]).local_message_id;
  if (typeof localMessageId !== "string" || !localMessageId) invalid("请求缺少可恢复消息标识", 409, "INTENT_MISMATCH");
  if (payload.conversation_id && payload.conversation_id !== "0") invalid("请在官方窗口新建对话后提交，避免与旧任务串联", 409, "CONVERSATION_NOT_NEW");
  return { localMessageId };
}

export function visitValues(value: unknown, visitor: (key: string, value: unknown) => void, depth = 0) {
  if (depth > 20 || !value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    visitor(key, item);
    if (item && typeof item === "object") visitValues(item, visitor, depth + 1);
    else if (["event_data", "data"].includes(key) && typeof item === "string" && /^[\[{]/.test(item)) {
      let parsed: unknown;
      try { parsed = JSON.parse(item); } catch { continue; }
      visitValues(parsed, visitor, depth + 1);
    }
  }
}

export function responseObjects(text: string) {
  if (text.length > 20 * 1024 * 1024) invalid("官方响应过大，请只读恢复原任务", 409, "UPSTREAM_RESPONSE_TOO_LARGE");
  const objects: Record<string, any>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!data || data === "[DONE]") continue;
    try { objects.push(object(JSON.parse(data))); } catch { /* SSE事件名与空行不作为业务数据。 */ }
  }
  if (!objects.length) { try { objects.push(object(JSON.parse(text))); } catch { /* 不把未知响应解释为受理成功。 */ } }
  return objects;
}

export function uploadedUri(value: unknown) {
  const uris = new Set<string>();
  visitValues(value, (key, item) => {
    if (key.toLowerCase() === "uri" && typeof item === "string" && /^[a-z0-9][a-z0-9_./-]{1,1024}$/i.test(item)) uris.add(item);
  });
  if (uris.size !== 1) invalid("不能唯一核对已上传图片资源，请停止提交", 409, "UPLOAD_BINDING_UNKNOWN");
  return [...uris][0]!;
}

export function videoObjects(message: unknown) {
  const blocks = object(message).content_block;
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap(block => {
    const creations = object(object(object(block).content).creation_block).creations;
    return Array.isArray(creations) ? creations.map(value => object(object(value).video)).filter(value => Object.keys(value).length) : [];
  });
}
