import express from "express";
import crypto from "node:crypto";
import QRCode from "qrcode";
import puppeteer from "puppeteer";
import { StudyStatus } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { requireResearcher } from "../middleware/auth.js";
import { loadStudyContext } from "./study.js";
import { getStudySummary } from "../services/summary.js";
import { generateJoinCode } from "../lib/join-code.js";
import { generateUniqueSlug } from "../lib/study-slug.js";

const researcher = express.Router();

researcher.use(requireResearcher);

const consentSecret = process.env.CONSENT_DOC_SECRET || "dev-consent-secret";

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
    console.error("[researcher-export] pdf fail", error);
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

const signPayload = (payload) => {
  const hmac = crypto.createHmac("sha256", consentSecret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest("hex").slice(0, 24);
};

const humanizeStatus = (status) => {
  switch (status) {
    case StudyStatus.RECRUITING:
      return "Recruiting";
    case StudyStatus.ACTIVE:
      return "Active";
    case StudyStatus.COMPLETED:
      return "Completed";
    case StudyStatus.ARCHIVED:
      return "Archived";
    case StudyStatus.DROPPED:
      return "Dropped";
    default:
      return "Study";
  }
};

const mapPermissionsForView = (permissions = []) =>
  permissions.map((perm) => ({
    id: perm.permissionId || perm.id,
    permissionId: perm.permissionId || perm.id,
    linkId: perm.linkId || perm.studyPermissionId || perm.id,
    slug: perm.permissionSlug || perm.slug || perm.key || perm.id,
    label: perm.label || perm.name || "Permission",
    description: perm.description || "",
    blurb: perm.blurb || "",
    required: Boolean(perm.required),
    sensitive: Boolean(perm.sensitive)
  }));

const mapPermissionsForPdf = (studyPermissions = []) =>
  studyPermissions.map((perm) => {
    const key = perm.permission?.slug || perm.permissionId || perm.id;
    const required = Boolean(perm.required ?? perm.permission?.defaultRequired ?? false);
    const templateSensitive =
      perm.permission?.piiLevel === "IDENTIFIABLE" ||
      perm.permission?.piiLevel === "PSEUDONYMOUS";
    const sensitive = typeof perm.sensitive === "boolean" ? perm.sensitive : templateSensitive;
    return {
      key,
      label: perm.permission?.title || key,
      description: perm.permission?.description || "",
      required,
      sensitive,
      granted: required
    };
  });

const ensureOwnStudy = (studyId, researcherId, args = {}) =>
  prisma.study.findFirst({
    where: { id: studyId, ownerId: researcherId },
    ...args
  });

const countEnrollments = (studyId) =>
  prisma.enrollment.count({ where: { studyId } });

const formatTags = (tags) => (Array.isArray(tags) ? tags : []);

researcher.get("/studies/:id/modal", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user || req.session?.user;
    const baseStudy = await ensureOwnStudy(id, user.id, {
      select: {
        id: true,
        title: true,
        status: true,
        slug: true,
        joinCode: true,
        tags: true,
        researcher: {
          select: {
            name: true,
            affiliation: true,
            email: true
          }
        }
      }
    });

    if (!baseStudy) {
      return res.status(404).send("Not found");
    }

    const context = await loadStudyContext(id, user.id);
    if (!context) {
      return res.status(404).send("Not found");
    }

    const totalParticipants = await countEnrollments(id);
    const isArchived = baseStudy.status === StudyStatus.ARCHIVED;
    const canDrop = baseStudy.status !== StudyStatus.DROPPED;
    const canShare = !isArchived && baseStudy.status !== StudyStatus.DROPPED;

    res.set("Cache-Control", "no-store");
    return res.render("partials/researcher-study", {
      layout: false,
      study: {
        id: baseStudy.id,
        title: baseStudy.title,
        status: baseStudy.status,
        tags: formatTags(baseStudy.tags),
        joinCode: baseStudy.joinCode || "",
        slug: baseStudy.slug
      },
      owner: context.owner,
      permissions: mapPermissionsForView(context.permissions || []),
      summary: context.summaryDetails,
      summaryText: context.study.summary,
      retention: context.retention,
      effort: context.effort,
      risk: context.risk,
      statusChips: context.statusChips,
      consentVersion: context.consentVersion,
      stats: {
        participants: totalParticipants,
        updatedLabel: context.consentVersion?.updatedLabel || null
      },
      isArchived,
      canDrop,
      canShare,
      statusLabel: humanizeStatus(baseStudy.status)
    });
  } catch (error) {
    next(error);
  }
});

researcher.post("/studies/:id/archive", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user || req.session?.user;
    const study = await ensureOwnStudy(id, user.id, { select: { id: true, status: true } });
    if (!study) {
      return res.status(404).json({ error: "not_found" });
    }

    if (study.status === StudyStatus.ARCHIVED) {
      return res.json({ ok: true, status: StudyStatus.ARCHIVED, statusLabel: humanizeStatus(study.status) });
    }

    const updated = await prisma.study.update({
      where: { id },
      data: { status: StudyStatus.ARCHIVED, archivedAt: new Date() },
      select: { status: true }
    });

    return res.json({ ok: true, status: updated.status, statusLabel: humanizeStatus(updated.status) });
  } catch (error) {
    next(error);
  }
});

researcher.post("/studies/:id/unarchive", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user || req.session?.user;
    const study = await ensureOwnStudy(id, user.id, { select: { id: true } });
    if (!study) {
      return res.status(404).json({ error: "not_found" });
    }

    const updated = await prisma.study.update({
      where: { id },
      data: {
        status: StudyStatus.ACTIVE,
        archivedAt: null
      },
      select: { status: true }
    });

    return res.json({ ok: true, status: updated.status, statusLabel: humanizeStatus(updated.status) });
  } catch (error) {
    next(error);
  }
});

researcher.post("/studies/:id/clone", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user || req.session?.user;

    const base = await ensureOwnStudy(id, user.id, {
      include: {
        permissions: {
          include: {
            template: {
              select: {
                id: true,
                key: true,
                label: true,
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

    if (!base) {
      return res.status(404).json({ error: "not_found" });
    }

    const cloneTitle = `Copy of ${base.title}`.slice(0, 140);

    const cloned = await prisma.$transaction(async (tx) => {
      const slug = await generateUniqueSlug(cloneTitle, { client: tx });
      const joinCode = await generateJoinCode({ client: tx });

      const newStudy = await tx.study.create({
        data: {
          title: cloneTitle,
          slug,
          joinCode,
          description: base.description,
          summaryGroq: base.summaryGroq,
          tags: formatTags(base.tags),
          retentionMonths: base.retentionMonths,
          reviewTimeMin: base.reviewTimeMin,
          visibility: base.visibility,
          ownerId: user.id,
          status: StudyStatus.RECRUITING
        }
      });

      if (Array.isArray(base.permissions) && base.permissions.length) {
        await tx.studyPermission.createMany({
          data: base.permissions.map((perm, idx) => ({
            studyId: newStudy.id,
            permissionId: perm.permissionId,
            required: perm.required,
            defaultAllow: perm.defaultAllow,
            displayOrder: typeof perm.displayOrder === "number" ? perm.displayOrder : idx
          }))
        });
      }

      return newStudy;
    });

    return res.json({ ok: true, studyId: cloned.id });
  } catch (error) {
    console.error("[researcher] clone failed", error);
    next(error);
  }
});

researcher.delete("/studies/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user || req.session?.user;
    const study = await ensureOwnStudy(id, user.id, { select: { id: true } });
    if (!study) {
      return res.status(404).json({ error: "not_found" });
    }

    const total = await countEnrollments(id);
    if (total > 0) {
      return res.status(409).json({ error: "in_use" });
    }

    await prisma.study.update({
      where: { id },
      data: {
        status: StudyStatus.DROPPED,
        droppedAt: new Date()
      }
    });
    return res.json({ ok: true, status: StudyStatus.DROPPED });
  } catch (error) {
    next(error);
  }
});

researcher.get("/studies/:id/export", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user || req.session?.user;

    const study = await ensureOwnStudy(id, user.id, {
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

    if (!study) {
      return res.status(404).send("Not found");
    }

    const latestVersion = await prisma.studyVersion.findFirst({
      where: { studyId: id },
      orderBy: { version: "desc" }
    });

    if (!latestVersion) {
      return res.status(404).send("No versions to export");
    }

    const summary = await getStudySummary(study);
    const permissions = mapPermissionsForPdf(study.permissions || []);

    const payload = {
      kind: "study_export",
      studyId: study.id,
      issuedAt: new Date().toISOString()
    };
    const docId = signPayload(payload);
    const verifyUrl = buildVerifyUrl(req, docId);
    const qr = await QRCode.toDataURL(verifyUrl);

    const html = await renderHtml(req, "pdf/consent-snapshot", {
      study,
      researcher: study.researcher,
      summary,
      permissions,
      version: latestVersion,
      issuedAt: new Date(),
      docId,
      qr,
      verifyUrl
    });

    const filename = `study_${study.slug || study.id}_snapshot.pdf`;
    await renderPdf(res, html, filename);
  } catch (error) {
    next(error);
  }
});

export default researcher;
