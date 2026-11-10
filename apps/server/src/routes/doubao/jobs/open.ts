import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ id: z.uuid() }), async (req, res) => {
  u.doubao.assertManagement(req);
  res.json(success(u.doubao.publicJob(await u.doubao.openJob(req.body.id))));
});
