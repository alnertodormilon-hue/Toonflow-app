import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", async (req, res) => {
  await u.doubao.assertGateway(req);
  res.set("Cache-Control", "no-store").json(success({ models: [{ id: "seedance_v2.0_mini", label: "Seedance 2.0 Mini（账号自动提交）", type: "video" }],
    defaultAccountId: u.doubao.getMetadata("defaultAccountId") || null, submission: "automaticOfficialSubmission", remaining: null }));
});
