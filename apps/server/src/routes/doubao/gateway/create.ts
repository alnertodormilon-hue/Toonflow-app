import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ clientRequestId: z.uuid(), accountId: z.uuid().optional(), model: z.literal("seedance_v2.0_mini"),
  prompt: z.string().min(1).max(100000).refine(value => !!value.trim(), "请输入完整提示词"), duration: z.literal(15), ratio: z.literal("9:16"), resolution: z.literal("720p"),
  assetIds: z.tuple([z.string().regex(/^[a-f0-9]{64}$/), z.string().regex(/^[a-f0-9]{64}$/)]) }), async (req, res) => {
  await u.doubao.assertGateway(req);
  const { clientRequestId, model, prompt, duration, ratio, resolution, assetIds } = req.body;
  const existing = u.doubao.findJobByOperation(clientRequestId);
  const accountId = req.body.accountId || existing?.accountId || u.doubao.getMetadata("defaultAccountId");
  if (!accountId) throw Object.assign(new Error("请先在豆包账号设置中选择默认账号"), { status: 422, code: "ACCOUNT_REQUIRED" });
  const result = u.doubao.createJob({ clientRequestId, accountId, model, prompt, duration, ratio, resolution, assetIds });
  if (result.created) void u.doubao.prepareJob(result.job.id);
  res.status(result.created ? 202 : 200).json(success(u.doubao.publicJob(result.job)));
});
