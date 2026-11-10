import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ id: z.uuid(), stateVersion: z.number().int().positive() }), (req, res) => {
  u.doubao.assertManagement(req);
  res.json(success(u.doubao.publicJob(u.doubao.cancelJob(req.body.id, req.body.stateVersion))));
});
