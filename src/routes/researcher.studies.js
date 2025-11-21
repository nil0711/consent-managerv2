import express from "express";
import slugify from "slugify";
import archiver from "archiver";
import { PermissionSource, PiiLevel, StudyStatus, Visibility } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { generateJoinCode } from "../lib/join-code.js";
import { generateUniqueSlug } from "../lib/study-slug.js";

const router = express.Router();

const isMissingRelation = (error, modelName) =>
  error?.code === "P2021" &&
  (!modelName || (typeof error.meta?.cause === "string" && error.meta.cause.includes(modelName)));

const requireResearcherJson = (req, res, next) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  if (user.role !== "RESEARCHER") {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  res.locals.user = user;
  return next();
};

router.use(requireResearcherJson);

const normalizeTitle = (value) => (typeof value === "string" ? value.trim() : "");
const normalizeSummary = (value) => (typeof value === "string" ? value.trim() : "");

const ensureOwnStudy = (studyId, ownerId, select) =>
  prisma.study.findFirst({
    where: { id: studyId, ownerId },
    select
  });

const studyStatusLabel = (status) => {
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

const studyResponseFields = {
  id: true,
  title: true,
  summary: true,
  status: true,
  joinCode: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  droppedAt: true
};

const serializeStudy = (study) => ({
  ...study,
  statusLabel: studyStatusLabel(study.status)
});

const clampDescription = (value) => value.slice(0, 1000);

const buildPermissionSlug = (title) => {
  const base =
    slugify(title, {
      lower: true,
      strict: true,
      trim: true
    })
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "perm";
  return base.length < 3 ? `${base}-${Date.now().toString(36).slice(-4)}` : base;
};

const serializePermissionLink = (permission, link) => ({
  id: permission.id,
  permissionId: permission.id,
  linkId: link.id,
  slug: permission.slug,
  title: permission.title,
  description: permission.description,
  source: permission.source,
  required: Boolean(link.required),
  sensitive: Boolean(link.sensitive),
  flags: {
    required: Boolean(link.required),
    sensitive: Boolean(link.sensitive)
  }
});

router.post("/studies", async (req, res, next) => {
  try {
    const user = res.locals.user;
    const title = normalizeTitle(req.body?.title);
    if (!title) {
      return res.status(400).json({ ok: false, error: "invalid_title" });
    }
    const summary = normalizeSummary(req.body?.summary || "");

    const study = await prisma.$transaction(async (tx) => {
      const slug = await generateUniqueSlug(title, { client: tx });
      const joinCode = await generateJoinCode({ client: tx });
      return tx.study.create({
        data: {
          title,
          slug,
          summary,
          description: summary,
          ownerId: user.id,
          status: StudyStatus.RECRUITING,
          visibility: Visibility.PUBLIC,
          joinCode,
          reviewTimeMin: 10,
          retentionMonths: 12,
          tags: []
        },
        select: studyResponseFields
      });
    });

    return res.json({ ok: true, study: serializeStudy(study) });
  } catch (error) {
    next(error);
  }
});

router.get("/permissions/search", async (req, res, next) => {
  try {
    const query = normalizeTitle(req.query.q);
    if (!query) {
      return res.json({ ok: true, results: [] });
    }
    const matches = await prisma.permission.findMany({
      where: {
        title: {
          contains: query,
          mode: "insensitive"
        }
      },
      orderBy: [{ title: "asc" }],
      take: 16
    });
    const seen = new Set();
    const results = [];
    for (const match of matches) {
      if (seen.has(match.slug)) continue;
      seen.add(match.slug);
      results.push({
        id: match.id,
        slug: match.slug,
        title: match.title,
        source: match.source.toLowerCase()
      });
      if (results.length >= 8) break;
    }
    return res.json({ ok: true, results });
  } catch (error) {
    next(error);
  }
});

router.post("/studies/:studyId/permissions", async (req, res, next) => {
  try {
    const { studyId } = req.params;
    const user = res.locals.user;
    const study = await ensureOwnStudy(studyId, user.id, {
      select: { id: true, status: true }
    });
    if (!study) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (study.status === StudyStatus.ARCHIVED || study.status === StudyStatus.DROPPED) {
      return res.status(409).json({ ok: false, error: "locked" });
    }

    const existingId = typeof req.body?.permissionId === "string" ? req.body.permissionId.trim() : "";
    let permission = null;

    if (existingId) {
      permission = await prisma.permission.findUnique({ where: { id: existingId } });
      if (!permission) {
        return res.status(404).json({ ok: false, error: "permission_not_found" });
      }
    } else {
      const title = normalizeTitle(req.body?.title);
      if (!title) {
        return res.status(400).json({ ok: false, error: "invalid_title" });
      }
      const description = clampDescription(normalizeSummary(req.body?.description || ""));
      const slug = buildPermissionSlug(title);
      permission = await prisma.permission.upsert({
        where: { slug },
        update: {},
        create: {
          slug,
          title,
          description,
          category: "custom",
          piiLevel: PiiLevel.NONE,
          defaultRequired: false,
          defaultAllow: false,
          order: 0,
          source: PermissionSource.CUSTOM
        }
      });
    }

    const currentCount = await prisma.studyPermission.count({ where: { studyId } });

    const link = await prisma.studyPermission.upsert({
      where: {
        studyId_permissionId: {
          studyId,
          permissionId: permission.id
        }
      },
      update: {},
      create: {
        studyId,
        permissionId: permission.id,
        required: false,
        sensitive: false,
        defaultAllow: false,
        displayOrder: currentCount + 1
      }
    });

    return res.json({ ok: true, permission: serializePermissionLink(permission, link) });
  } catch (error) {
    next(error);
  }
});

router.post("/studies/:studyId/permissions/:permId/flags", async (req, res, next) => {
  try {
    const { studyId, permId } = req.params;
    const user = res.locals.user;
    const study = await ensureOwnStudy(studyId, user.id, {
      select: { id: true }
    });
    if (!study) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const payload = {};
    if (typeof req.body?.required === "boolean") {
      payload.required = req.body.required;
    }
    if (typeof req.body?.sensitive === "boolean") {
      payload.sensitive = req.body.sensitive;
    }
    if (!Object.keys(payload).length) {
      return res.status(400).json({ ok: false, error: "no_fields" });
    }

    let link = await prisma.studyPermission.findFirst({
      where: {
        studyId,
        id: permId
      },
      select: {
        id: true,
        permissionId: true
      }
    });

    if (!link) {
      link = await prisma.studyPermission.findUnique({
        where: {
          studyId_permissionId: {
            studyId,
            permissionId: permId
          }
        },
        select: {
          id: true,
          permissionId: true
        }
      });
    }

    if (!link) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const updated = await prisma.studyPermission.update({
      where: link.id
        ? { id: link.id }
        : {
            studyId_permissionId: {
              studyId,
              permissionId: permId
            }
          },
      data: payload,
      select: {
        id: true,
        permissionId: true,
        required: true,
        sensitive: true
      }
    });

    return res.json({
      ok: true,
      permissionId: updated.permissionId || link.permissionId,
      required: Boolean(updated.required),
      sensitive: Boolean(updated.sensitive)
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    next(error);
  }
});

router.post("/studies/:id/archive", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    const study = await ensureOwnStudy(id, user.id, {
      select: { id: true, status: true }
    });
    if (!study) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (study.status === StudyStatus.ARCHIVED) {
      return res.json({ ok: true, status: StudyStatus.ARCHIVED, statusLabel: studyStatusLabel(study.status) });
    }
    const updated = await prisma.study.update({
      where: { id },
      data: {
        status: StudyStatus.ARCHIVED,
        archivedAt: new Date()
      },
      select: studyResponseFields
    });
    return res.json({ ok: true, study: serializeStudy(updated) });
  } catch (error) {
    next(error);
  }
});

router.post("/studies/:id/unarchive", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    const study = await ensureOwnStudy(id, user.id, {
      select: { id: true, status: true }
    });
    if (!study) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    const nextStatus = study.status === StudyStatus.COMPLETED ? StudyStatus.COMPLETED : StudyStatus.ACTIVE;
    const updated = await prisma.study.update({
      where: { id },
      data: {
        status: nextStatus,
        archivedAt: null
      },
      select: studyResponseFields
    });
    return res.json({ ok: true, study: serializeStudy(updated) });
  } catch (error) {
    next(error);
  }
});

router.delete("/studies/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    const study = await ensureOwnStudy(id, user.id, {
      select: { id: true, status: true }
    });
    if (!study) {
      return res.status(404).json({ ok: false, error: "not_found" });
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

const csvEscape = (value) => {
  if (value === null || typeof value === "undefined") return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const rowsToCsv = (rows, columns) => {
  const header = columns.map((col) => csvEscape(col.header)).join(",");
  const data = rows.map((row) => columns.map((col) => csvEscape(col.map ? col.map(row) : row[col.key])).join(","));
  return [header, ...data].join("\n");
};

const fileWriters = {
  csv: (rows, columns) => rowsToCsv(rows, columns),
  ndjson: (rows) => rows.map((row) => JSON.stringify(row)).join("\n")
};

router.get("/studies/:id/export", async (req, res, next) => {
  try {
    const { id } = req.params;
    const format = String(req.query.format || "csv").toLowerCase() === "ndjson" ? "ndjson" : "csv";
    const user = res.locals.user;
    const study = await ensureOwnStudy(id, user.id, {
      select: {
        id: true,
        title: true,
        joinCode: true
      }
    });
    if (!study) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const [enrollments, studyPermissions, grants, versions, consentVersions, events] = await Promise.all([
      prisma.enrollment.findMany({
        where: { studyId: id },
        select: {
          id: true,
          participantId: true,
          status: true,
          joinedAt: true,
          user: {
            select: { name: true, email: true }
          }
        }
      }),
      prisma.studyPermission.findMany({
        where: { studyId: id },
        include: {
          permission: {
            select: {
              id: true,
              slug: true,
              title: true
            }
          }
        }
      }),
      prisma.permissionGrant.findMany({
        where: { studyId: id }
      }),
      prisma.studyVersion.findMany({
        where: { studyId: id },
        orderBy: [{ version: "asc" }]
      }),
      prisma.consentVersion.findMany({
        where: {
          enrollment: {
            studyId: id
          }
        },
        include: {
          enrollment: {
            select: {
              id: true,
              participantId: true
            }
          }
        }
      }),
      prisma.auditLog
        .findMany({
          where: {
            metaJson: {
              path: ["studyId"],
              equals: id
            }
          },
          orderBy: [{ createdAt: "asc" }]
        })
        .catch((error) => {
          if (isMissingRelation(error, "AuditLog")) return [];
          throw error;
        })
    ]);

    const permissionBySlug = new Map();
    for (const entry of studyPermissions) {
      if (entry.permission?.slug) {
        permissionBySlug.set(entry.permission.slug, entry);
      }
    }

    const participantsRows = enrollments.map((entry) => ({
      enrollmentId: entry.id,
      participantId: entry.participantId,
      name: entry.user?.name || "",
      email: entry.user?.email || "",
      status: entry.status,
      joinedAt: entry.joinedAt ? new Date(entry.joinedAt).toISOString() : null
    }));

    const permissionsRows = grants.map((grant) => {
      const link = permissionBySlug.get(grant.permKey) || null;
      return {
        participantId: grant.userId,
        permissionSlug: grant.permKey,
        title: link?.permission?.title || grant.permKey,
        required: Boolean(link?.required),
        sensitive: Boolean(link?.sensitive),
        granted: Boolean(grant.granted),
        grantedAt: grant.updatedAt ? new Date(grant.updatedAt).toISOString() : null
      };
    });

    const versionRows = versions.map((version) => ({
      versionId: version.id,
      studyId: version.studyId,
      version: version.version,
      createdAt: version.createdAt ? new Date(version.createdAt).toISOString() : null,
      filePath: version.filePath || ""
    }));

    const ledgerRows = consentVersions.map((entry) => ({
      consentId: entry.id,
      enrollmentId: entry.enrollmentId,
      participantId: entry.enrollment?.participantId || null,
      version: entry.version,
      createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
      receiptHash: entry.receiptHash
    }));

    const eventRows = events.map((event) => ({
      id: event.id,
      action: event.action,
      actorId: event.userId || null,
      createdAt: event.createdAt ? new Date(event.createdAt).toISOString() : null,
      meta: event.metaJson || null
    }));

    const formatter = fileWriters[format];
    const ext = format === "csv" ? "csv" : "ndjson";
    const appendFile = (name, rows, columns) => {
      const payload = formatter(rows, columns);
      archive.append(payload, { name: `${name}.${ext}` });
    };

    const today = new Date();
    const stamp = today.toISOString().slice(0, 10).replace(/-/g, "");
    const archiveName = `study_export_${study.joinCode || study.id}_${stamp}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.attachment(archiveName);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => next(err));
    archive.pipe(res);

    appendFile("participants", participantsRows, [
      { key: "enrollmentId", header: "enrollment_id" },
      { key: "participantId", header: "participant_id" },
      { key: "name", header: "name" },
      { key: "email", header: "email" },
      { key: "status", header: "status" },
      { key: "joinedAt", header: "joined_at" }
    ]);

    appendFile("permissions", permissionsRows, [
      { key: "participantId", header: "participant_id" },
      { key: "permissionSlug", header: "permission_slug" },
      { key: "title", header: "title" },
      { key: "required", header: "required" },
      { key: "sensitive", header: "sensitive" },
      { key: "granted", header: "granted" },
      { key: "grantedAt", header: "granted_at" }
    ]);

    appendFile("versions", versionRows, [
      { key: "versionId", header: "version_id" },
      { key: "studyId", header: "study_id" },
      { key: "version", header: "version" },
      { key: "createdAt", header: "created_at" },
      { key: "filePath", header: "file_path" }
    ]);

    appendFile("consent_ledger", ledgerRows, [
      { key: "consentId", header: "consent_id" },
      { key: "enrollmentId", header: "enrollment_id" },
      { key: "participantId", header: "participant_id" },
      { key: "version", header: "version" },
      { key: "createdAt", header: "created_at" },
      { key: "receiptHash", header: "receipt_hash" }
    ]);

    appendFile("events", eventRows, [
      { key: "id", header: "event_id" },
      { key: "action", header: "action" },
      { key: "actorId", header: "actor_id" },
      { key: "createdAt", header: "timestamp" },
      {
        header: "meta",
        map: (row) => JSON.stringify(row.meta || {})
      }
    ]);

    archive.finalize();
  } catch (error) {
    next(error);
  }
});

router.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("[researcher-api]", err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

export default router;
