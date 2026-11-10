import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().put("/", validateFields({ id: z.uuid(), name: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional(), isDefault: z.boolean().optional() }), (req, res) => {
  u.doubao.assertManagement(req);
  const { id, name, enabled, isDefault } = req.body;
  res.json(success(u.doubao.updateAccount(id, { name, enabled, isDefault })));
});
