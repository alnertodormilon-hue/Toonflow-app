import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", validateFields({ clientRequestId: z.uuid() }, "query"), (req, res) => {
  u.doubao.assertManagement(req);
  const job = u.doubao.findJobByOperation(String(req.query.clientRequestId));
  res.set("Cache-Control", "no-store").json(success(job ? u.doubao.publicJob(job) : null));
});
