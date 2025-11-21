import express from "express";

const router = express.Router();

router.get("/verify/:hash", (req, res) => {
  const { hash } = req.params;
  res.render("verify/result", {
    layout: false,
    hash,
    issued: Boolean(hash)
  });
});

export default router;
