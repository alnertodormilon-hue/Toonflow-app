import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().delete("/", validateFields({ id: z.uuid() }), async (req, res) => {
  u.doubao.assertManagement(req);
  u.doubao.removeAccount(req.body.id);
  await u.doubao.closeAccount(req.body.id, true);
  res.json(success());
});
