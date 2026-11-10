import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields({ id: z.uuid() }, "query"), async (req, res) => {
  await u.doubao.assertGateway(req);
  const job = await u.doubao.refreshJob(String(req.query.id));
  res.set("Cache-Control", "no-store").json(success(u.doubao.publicJob(job)));
});
