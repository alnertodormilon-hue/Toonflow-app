import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ name: z.string().trim().min(1).max(80) }), (req, res) => {
  u.doubao.assertManagement(req);
  res.status(201).json(success(u.doubao.createAccount(req.body.name)));
});
