import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", (req, res) => {
  u.doubao.assertManagement(req);
  res.set("Cache-Control", "no-store").json(success(u.doubao.listJobs().slice(0, 200).map(u.doubao.publicJob)));
});
