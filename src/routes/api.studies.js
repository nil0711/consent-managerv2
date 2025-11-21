import express from "express";
import { Prisma, EnrollmentStatus, Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getStudySummary, summaryTextFromField } from "../services/summary.js";
import {
  ensureTrendingOrder,
  toSeenSet,
  updateSeenSession
} from "../lib/trending-cache.js";

const isMissingRelation = (error, modelName) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2021" &&
  (!modelName || (typeof error.meta?.cause === "string" && error.meta.cause.includes(modelName)));

const api = express.Router();

api.use((req, res, next) => {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  res.locals.user = user;
  next();
});

api.get("/studies/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;

    const study = await prisma.study.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        tags: true,
        status: true,
        joinCode: true,
        createdAt: true,
        summaryGroq: true,
        retentionMonths: true,
        reviewTimeMin: true,
        permissions: {
          orderBy: [{ displayOrder: "asc" }],
          include: {
            permission: {
              select: {
                slug: true,
                title: true,
                defaultRequired: true,
                defaultAllow: true
              }
            }
          }
        }
      }
    });

    if (!study) {
      return res.status(404).json({ error: "not_found" });
    }

    const enrollment =
      user.role === Role.PARTICIPANT
        ? await prisma.enrollment.findUnique({
            where: {
              studyId_participantId: {
                studyId: id,
                participantId: user.id
              }
            },
            select: { status: true }
          })
        : null;

    const summaryDoc = await getStudySummary(study);
    const summary = summaryDoc?.summary ||
      summaryTextFromField(study.summaryGroq) ||
      (study.description || "").slice(0, 160);

    let grantRows = [];
    if (user.role === Role.PARTICIPANT) {
      try {
        grantRows = await prisma.permissionGrant.findMany({
          where: {
            studyId: id,
            userId: user.id
          }
        });
      } catch (error) {
        if (!isMissingRelation(error, "PermissionGrant")) throw error;
        grantRows = [];
      }
    }
    const grants = new Map(grantRows.map((row) => [row.permKey, row.granted]));

    const permissions = (study.permissions || []).map((row) => {
      const key = row.permission?.slug || "";
      const label = row.permission?.title || key || "Permission";
      const isRequired = Boolean(
        row.required ?? row.permission?.defaultRequired ?? false
      );
      const defaultAllow =
        row.defaultAllow ?? row.permission?.defaultAllow ?? false;
      const granted = isRequired
        ? true
        : grants.has(key)
        ? grants.get(key)
        : defaultAllow;
      return {
        key,
        label,
        isRequired,
        granted: Boolean(granted),
        isLocked: isRequired
      };
    });

    let versions = [];
    try {
      versions = await prisma.studyVersion.findMany({
        where: { studyId: id },
        orderBy: [{ version: "desc" }],
        take: 12,
        select: {
          id: true,
          version: true,
          createdAt: true
        }
      });
    } catch (error) {
      if (!isMissingRelation(error, "StudyVersion")) throw error;
      versions = [];
    }

    res.json({
      id: study.id,
      code: study.joinCode,
      title: study.title,
      tags: study.tags ?? [],
      status: study.status,
      enrollmentStatus: enrollment?.status ?? "UNENROLLED",
      summary,
      createdAt: study.createdAt,
      permissions,
      versions
    });
  } catch (error) {
    next(error);
  }
});

api.post("/studies/:id/enroll", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    if (user.role !== Role.PARTICIPANT) {
      return res.status(403).json({ error: "forbidden" });
    }

    const enrollment = await prisma.enrollment.upsert({
      where: {
        studyId_participantId: {
          studyId: id,
          participantId: user.id
        }
      },
      create: {
        studyId: id,
        participantId: user.id,
        status: EnrollmentStatus.ENROLLED,
        joinedAt: new Date(),
        leftAt: null
      },
      update: {
        status: EnrollmentStatus.ENROLLED,
        joinedAt: new Date(),
        leftAt: null
      },
      select: { status: true }
    });

    res.json({ ok: true, enrollmentStatus: enrollment.status });
  } catch (error) {
    if (error.code === "P2002") {
      return res.json({ ok: true, enrollmentStatus: EnrollmentStatus.ENROLLED });
    }
    next(error);
  }
});

api.post("/studies/:id/unenroll", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    if (user.role !== Role.PARTICIPANT) {
      return res.status(403).json({ error: "forbidden" });
    }

    const updated = await prisma.enrollment.update({
      where: {
        studyId_participantId: {
          studyId: id,
          participantId: user.id
        }
      },
      data: {
        status: EnrollmentStatus.WITHDRAWN,
        leftAt: new Date()
      },
      select: { status: true }
    });

    res.json({ ok: true, enrollmentStatus: updated.status });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "not_enrolled" });
    }
    next(error);
  }
});

api.post("/studies/:id/permissions/:permKey", async (req, res, next) => {
  try {
    const { id, permKey } = req.params;
    const user = res.locals.user;
    if (user.role !== Role.PARTICIPANT) {
      return res.status(403).json({ error: "forbidden" });
    }

    const normalizedKey = String(permKey || "").trim();
    if (!normalizedKey) {
      return res.status(400).json({ error: "invalid_permission" });
    }

    const perm = await prisma.studyPermission.findFirst({
      where: {
        studyId: id,
        permission: { slug: normalizedKey }
      },
      select: {
        required: true,
        defaultAllow: true,
        permission: {
          select: {
            slug: true,
            defaultRequired: true,
            defaultAllow: true
          }
        }
      }
    });

    if (!perm) {
      return res.status(404).json({ error: "permission_not_found" });
    }

    const isRequired = Boolean(perm.required ?? perm.permission?.defaultRequired ?? false);
    if (isRequired) {
      return res.status(400).json({ error: "permission_locked" });
    }

    const granted = Boolean(req.body?.granted);

    try {
      await prisma.permissionGrant.upsert({
        where: {
          studyId_userId_permKey: {
            studyId: id,
            userId: user.id,
            permKey: normalizedKey
          }
        },
        create: {
          studyId: id,
          userId: user.id,
          permKey: normalizedKey,
          granted
        },
        update: {
          granted
        }
      });
    } catch (error) {
      if (isMissingRelation(error, "PermissionGrant")) {
        return res.status(503).json({ error: "permissions_unavailable" });
      }
      throw error;
    }

    res.json({ ok: true, granted });
  } catch (error) {
    next(error);
  }
});

api.post("/studies/join", async (req, res, next) => {
  try {
    const rawCode = req.body?.code;
    if (!rawCode || typeof rawCode !== "string") {
      return res.status(400).json({ error: "missing_code" });
    }
    const normalized = rawCode.trim().toUpperCase();
    if (!normalized) {
      return res.status(400).json({ error: "missing_code" });
    }

    const study = await prisma.study.findFirst({
      where: { joinCode: normalized },
      select: { id: true }
    });

    if (!study) {
      return res.status(404).json({ error: "not_found" });
    }

    res.json({ ok: true, id: study.id });
  } catch (error) {
    next(error);
  }
});

api.get("/studies/:id/versions", async (req, res, next) => {
  try {
    const { id } = req.params;
    let versions = [];
    try {
      versions = await prisma.studyVersion.findMany({
        where: { studyId: id },
        orderBy: [{ version: "desc" }],
        select: {
          id: true,
          version: true,
          createdAt: true
        }
      });
    } catch (error) {
      if (!isMissingRelation(error, "StudyVersion")) throw error;
      versions = [];
    }
    res.json(versions);
  } catch (error) {
    next(error);
  }
});

api.get("/studies/:id/consent/latest", async (req, res, next) => {
  try {
    const { id } = req.params;
    let latest = null;
    try {
      latest = await prisma.studyVersion.findFirst({
        where: { studyId: id },
        orderBy: [{ version: "desc" }],
        select: { filePath: true }
      });
    } catch (error) {
      if (!isMissingRelation(error, "StudyVersion")) throw error;
      latest = null;
    }
    if (!latest?.filePath) {
      return res.status(404).end();
    }
    return res.download(latest.filePath);
  } catch (error) {
    next(error);
  }
});

api.get("/trending", async (req, res, next) => {
  try {
    const user = res.locals.user;
    const offset = Math.max(
      0,
      Number.parseInt(String(req.query.offset ?? "0"), 10) || 0
    );
    const rawLimit = Number.parseInt(String(req.query.limit ?? "10"), 10);
    const limit = Math.min(Math.max(rawLimit || 10, 1), 20);

    const seenSet = toSeenSet(req.session?.trendingSeen);
    const items = await ensureTrendingOrder(
      req,
      user.id,
      user.role,
      new Set(seenSet)
    );

    const batch = items.slice(offset, offset + limit);
    batch.forEach((item) => seenSet.add(item.id));
    updateSeenSession(req, seenSet);

    res.json(batch);
  } catch (error) {
    next(error);
  }
});

export default api;
