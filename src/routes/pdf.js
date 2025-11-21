import express from "express";
import crypto from "node:crypto";
import QRCode from "qrcode";
import puppeteer from "puppeteer";
import { Role } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { getStudySummary } from "../services/summary.js";

const router = express.Router();

const secret = process.env.CONSENT_DOC_SECRET || "dev-consent-secret";

const requireParticipant = (req, res, next) => {
  const user = req.session?.user;
  if (!user) {
    return res.sendStatus(401);
  }
  if (user.role !== Role.PARTICIPANT) {
    return res.sendStatus(403);
  }
  res.locals.user = user;
  next();
};

router.use("/participant/studies", requireParticipant);

const signPayload = (payload) => {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest("hex").slice(0, 24);
};

const buildVerifyUrl = (req, docId) => {
  const base = process.env.PDF_BASE_URL?.replace(/\/$/, "");
  if (base) return `${base}/verify/${docId}`;
  return `${req.protocol}://${req.get("host")}/verify/${docId}`;
};

const renderHtml = (req, view, data) =>
  new Promise((resolve, reject) => {
    req.app.render(view, { layout: false, ...data }, (err, html) => {
      if (err) return reject(err);
      resolve(html);
    });
  });

const launchBrowser = async () =>
  puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

const renderPdf = async (res, html, filename = "consent.pdf") => {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "24px", right: "24px", bottom: "24px", left: "24px" }
    });
    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error) {
    console.error("[pdf] fail:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "PDF_RENDER" });
    }
  } finally {
    try {
      await browser?.close();
    } catch {
      /* noop */
    }
  }
};

const mapPermissions = (studyPermissions, grantedSet) =>
  (studyPermissions || []).map((perm) => {
    const key = perm.permission?.slug || "";
    const required = Boolean(
      perm.required ?? perm.permission?.defaultRequired ?? false
    );
    return {
      key,
      label: perm.permission?.title || key,
      description: perm.permission?.description || "",
      required,
      granted: grantedSet ? grantedSet.has(key) : false,
      sensitive:
        perm.permission?.piiLevel === "IDENTIFIABLE" ||
        perm.permission?.piiLevel === "PSEUDONYMOUS"
    };
  });

const getEnrollmentWithVersions = async (studyId, participantId) =>
  prisma.enrollment.findUnique({
    where: {
      studyId_participantId: {
        studyId,
        participantId
      }
    },
    include: {
      consentVersions: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

const fetchStudy = async (studyId) =>
  prisma.study.findUnique({
    where: { id: studyId },
    include: {
      researcher: {
        select: { name: true, affiliation: true, email: true }
      },
      permissions: {
        orderBy: { displayOrder: "asc" },
        include: {
          permission: {
            select: {
              slug: true,
              title: true,
              description: true,
              defaultRequired: true,
              defaultAllow: true,
              piiLevel: true
            }
          }
        }
      }
    }
  });

router.get("/participant/studies/:id/pdf/snapshot", async (req, res, next) => {
  try {
    const { id } = req.params;
    const participantId = res.locals.user.id;

    const study = await fetchStudy(id);
    if (!study) return res.sendStatus(404);

    const enrollment = await getEnrollmentWithVersions(id, participantId);
    const versions = enrollment?.consentVersions || [];
    const requestedVersionId = req.query.version ? String(req.query.version) : null;
    const latest = requestedVersionId
      ? versions.find((entry) => entry.id === requestedVersionId) ?? null
      : versions[0] ?? null;
    if (!latest) return res.status(404).send("No saved versions");

    const granted = new Set(
      Array.isArray(latest.decisionsJson?.permissions)
        ? latest.decisionsJson.permissions.map(String)
        : []
    );

    const permissions = mapPermissions(study.permissions, granted);
    const summary = await getStudySummary(study);

    const payload = {
      kind: "snapshot",
      studyId: study.id,
      participantId,
      versionId: latest.id,
      granted: Array.from(granted)
    };

    const docId = signPayload(payload);
    const verifyUrl = buildVerifyUrl(req, docId);
    const qr = await QRCode.toDataURL(verifyUrl);

    const html = await renderHtml(req, "pdf/consent-snapshot", {
      study,
      researcher: study.researcher,
      summary,
      permissions,
      version: latest,
      issuedAt: new Date(),
      docId,
      qr,
      verifyUrl
    });

    const filename = `consent_${study.slug || study.id}_v${latest.version || "latest"}.pdf`;
    await renderPdf(res, html, filename);
    return;
  } catch (error) {
    next(error);
  }
});

router.get("/participant/studies/:id/pdf/history", async (req, res, next) => {
  try {
    const { id } = req.params;
    const participantId = res.locals.user.id;

    const study = await fetchStudy(id);
    if (!study) return res.sendStatus(404);

    const enrollment = await getEnrollmentWithVersions(id, participantId);
    const versions = enrollment?.consentVersions || [];
    if (!versions.length) return res.status(404).send("No saved versions");

    const labels = Object.fromEntries(
      (study.permissions || []).map((perm) => [
        perm.permission?.slug || "",
        perm.permission?.title || perm.permission?.slug || ""
      ])
    );

    const versionDetails = versions.map((version) => {
      const granted = Array.isArray(version.decisionsJson?.permissions)
        ? version.decisionsJson.permissions.map(String)
        : [];
      return {
        id: version.id,
        label: version.version ? `Version ${version.version}` : "Snapshot",
        createdAt: version.createdAt,
        granted,
        grantedLabels: granted.map((key) => labels[key] || key)
      };
    });

    const payload = {
      kind: "history",
      studyId: study.id,
      participantId,
      versions: versionDetails.map((entry) => entry.id)
    };

    const docId = signPayload(payload);
    const verifyUrl = buildVerifyUrl(req, docId);
    const qr = await QRCode.toDataURL(verifyUrl);

    const html = await renderHtml(req, "pdf/consent-ledger", {
      study,
      versions: versionDetails,
      issuedAt: new Date(),
      docId,
      qr,
      verifyUrl
    });

    const filename = `consent_history_${study.slug || study.id}.pdf`;
    await renderPdf(res, html, filename);
    return;
  } catch (error) {
    next(error);
  }
});

router.get("/participant/studies/:id/pdf/diff", async (req, res, next) => {
  try {
    const { id } = req.params;
    const participantId = res.locals.user.id;
    const { vA, vB } = req.query;
    if (!vA || !vB) return res.status(400).send("vA and vB required");

    const study = await fetchStudy(id);
    if (!study) return res.sendStatus(404);

    const versions = await prisma.consentVersion.findMany({
      where: {
        id: { in: [String(vA), String(vB)] },
        enrollment: {
          studyId: id,
          participantId
        }
      },
      select: {
        id: true,
        version: true,
        createdAt: true,
        decisionsJson: true
      }
    });

    const lookup = new Map(versions.map((entry) => [entry.id, entry]));
    const a = lookup.get(String(vA));
    const b = lookup.get(String(vB));
    if (!a || !b) return res.status(404).send("Versions not found");

    const labels = Object.fromEntries(
      (study.permissions || []).map((perm) => [
        perm.permission?.slug || "",
        perm.permission?.title || perm.permission?.slug || ""
      ])
    );

    const setA = new Set(
      Array.isArray(a.decisionsJson?.permissions)
        ? a.decisionsJson.permissions.map(String)
        : []
    );
    const setB = new Set(
      Array.isArray(b.decisionsJson?.permissions)
        ? b.decisionsJson.permissions.map(String)
        : []
    );

    const added = [...setB]
      .filter((key) => !setA.has(key))
      .map((key) => labels[key] || key);
    const removed = [...setA]
      .filter((key) => !setB.has(key))
      .map((key) => labels[key] || key);
    const unchanged = [...setA]
      .filter((key) => setB.has(key))
      .map((key) => labels[key] || key);

    const payload = {
      kind: "diff",
      studyId: study.id,
      participantId,
      from: a.id,
      to: b.id,
      added,
      removed
    };

    const docId = signPayload(payload);
    const verifyUrl = buildVerifyUrl(req, docId);
    const qr = await QRCode.toDataURL(verifyUrl);

    const html = await renderHtml(req, "pdf/consent-diff", {
      study,
      from: a,
      to: b,
      added,
      removed,
      unchanged,
      issuedAt: new Date(),
      docId,
      qr,
      verifyUrl
    });

    const filename = `consent_diff_${study.slug || study.id}_v${a.version || "a"}_v${b.version || "b"}.pdf`;
    await renderPdf(res, html, filename);
    return;
  } catch (error) {
    next(error);
  }
});

router.post("/participant/studies/:id/pdf/receipt", async (req, res, next) => {
  try {
    const { id } = req.params;
    const participantId = res.locals.user.id;
    const action = String(req.body?.action || "").toLowerCase();
    if (!["enrolled", "withdrawn"].includes(action)) {
      return res.status(400).send("Invalid action");
    }

    const study = await fetchStudy(id);
    if (!study) return res.sendStatus(404);

    const enrollment = await getEnrollmentWithVersions(id, participantId);
    const latest = enrollment?.consentVersions?.[0] ?? null;
    const summary = await getStudySummary(study);

    const payload = {
      kind: "receipt",
      studyId: study.id,
      participantId,
      action,
      versionId: latest?.id || null,
      timestamp: Date.now()
    };

    const docId = signPayload(payload);
    const verifyUrl = buildVerifyUrl(req, docId);
    const qr = await QRCode.toDataURL(verifyUrl);

    const html = await renderHtml(req, "pdf/consent-receipt", {
      study,
      enrollment,
      action,
      version: latest,
      summary,
      participant: res.locals.user,
      issuedAt: new Date(),
      docId,
      qr,
      verifyUrl
    });

    const filename = `consent_receipt_${study.slug || study.id}_${action}.pdf`;
    await renderPdf(res, html, filename);
    return;
  } catch (error) {
    next(error);
  }
});

router.get("/__dev/pdf", async (req, res) => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>PDF probe</title>
        <style>
          body { font-family: Inter, sans-serif; padding: 48px; color: #0f172a; }
          h1 { font-size: 24px; margin-bottom: 8px; }
          p { font-size: 14px; line-height: 1.5; }
          .stamp { margin-top: 24px; font-size: 12px; color: #475569; }
        </style>
      </head>
      <body>
        <h1>PDF pipeline check</h1>
        <p>If you can read this inside a PDF viewer, Puppeteer rendered successfully.</p>
        <p class="stamp">Generated ${new Date().toLocaleString()}</p>
      </body>
    </html>
  `;
  await renderPdf(res, html, "pdf-probe.pdf");
});

export default router;
