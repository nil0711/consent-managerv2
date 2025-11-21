import express from "express";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";

const router = express.Router();

router.get("/dev/demo-users", async (_req, res) => {
  const [researchers, participants] = await Promise.all([
    prisma.user.findMany({
      where: { role: "RESEARCHER" },
      select: { email: true },
      take: 10
    }),
    prisma.user.findMany({
      where: { role: "PARTICIPANT" },
      select: { email: true },
      take: 10
    })
  ]);

  const renderList = (rows) =>
    rows.map((row) => `<li>${row.email}</li>`).join("") || "<li>None found.</li>";

  res
    .type("html")
    .send(
      `<div style="font-family:ui-sans-serif,system-ui,-apple-system;background:#0b1225;color:#e2e8f0;line-height:1.5;padding:16px;min-height:100vh;">
        <h2 style="margin-top:0;">Demo logins (password = <code>demo</code>)</h2>
        <h3>Researchers</h3>
        <ul>${renderList(researchers)}</ul>
        <h3>Participants</h3>
        <ul>${renderList(participants)}</ul>
        <p><a href="/login" style="color:#fbbf24;text-decoration:none;">Go to login →</a></p>
      </div>`
    );
});

router.get("/dev/view-check", (req, res) => {
  const viewsRoot = req.app.get("views");
  const rootArray = Array.isArray(viewsRoot) ? viewsRoot : [viewsRoot];
  const resolvedRoot = rootArray[0];
  const target = path.join(resolvedRoot, "partials", "study-modal.ejs");

  let partialsList = [];
  try {
    partialsList = fs.readdirSync(path.join(resolvedRoot, "partials"));
  } catch (error) {
    partialsList = [`<partials dir error: ${error.message}>`];
  }

  res.json({
    viewsRoot: rootArray,
    expected: target,
    exists: fs.existsSync(target),
    partialsDirListing: partialsList
  });
});

router.get("/__dev/modal-probe/:id", (req, res) => {
  try {
    const ctx = {
      study: {
        id: req.params.id,
        title: `Probe ${req.params.id}`,
        summary: "",
        purpose: ""
      },
      owner: { name: "Probe", institution: "Dev" },
      collected: [],
      retention: null,
      effort: null,
      risk: { level: "Low" },
      permissions: [],
      userEnrollment: { status: "UNENROLLED" },
      chatFallback: "",
      contextVersion: Date.now()
    };

    res.set("Cache-Control", "no-store");
    return res.render("partials/study-modal", { ...ctx, layout: false });
  } catch (error) {
    console.error("[modal-probe] ejs-fail", error?.message);
    return res.status(500).json({ error: "EJS", message: error?.message });
  }
});

export default router;
