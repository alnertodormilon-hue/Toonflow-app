import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ data: z.string().min(1).max(14000000) }), async (req, res) => {
  await u.doubao.assertGateway(req);
  const { path, ...asset } = await u.doubao.acceptAsset(req.body.data);
  res.status(201).json(success(asset));
});
