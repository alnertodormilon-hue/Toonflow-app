import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";

export default Router().get("/", validateFields({ id: z.uuid() }, "query"), async (req, res) => {
  await u.doubao.assertGateway(req);
  const bytes = await u.doubao.videoContent(String(req.query.id));
  res.set({ "Content-Type": "video/mp4", "Content-Length": String(bytes.length), "Cache-Control": "no-store" }).send(bytes);
});
