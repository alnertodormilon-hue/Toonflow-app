import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";

export default Router().get("/", validateFields({ id: z.uuid() }, "query"), async (req, res) => {
  u.doubao.assertManagement(req);
  const bytes = await u.doubao.videoContent(String(req.query.id));
  res.set({ "Content-Type": "video/mp4", "Content-Length": String(bytes.length), "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="doubao-${req.query.id}.mp4"` }).send(bytes);
});
