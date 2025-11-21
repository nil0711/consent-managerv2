import express from "express";

const router = express.Router();

router.get("/docs/participant", (_req, res) => {
  res.render("docs/participant", { title: "Participant onboarding", pageKind: "" });
});

router.get("/docs/researcher", (_req, res) => {
  res.render("docs/researcher", { title: "Researcher quickstart", pageKind: "" });
});

router.get("/docs/consent", (_req, res) => {
  res.render("docs/consent", { title: "Consent rules & FAQ", pageKind: "" });
});

export default router;
