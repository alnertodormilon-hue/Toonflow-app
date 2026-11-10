import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ id: z.uuid(), mode: z.enum(["prepare", "reconcile", "download"]), stateVersion: z.number().int().positive() }), async (req, res) => {
  u.doubao.assertManagement(req);
  res.json(success(u.doubao.publicJob(await u.doubao.resumeJob(req.body.id, req.body.mode, req.body.stateVersion))));
});
