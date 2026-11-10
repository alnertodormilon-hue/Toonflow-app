import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", async (req, res) => {
  res.set("Cache-Control", "no-store").json(success(await u.doubao.configure(req)));
});
