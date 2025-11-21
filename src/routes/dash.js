import { Router } from "express";
import { EnrollmentStatus, Role, StudyStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import getTrendingForUser from "../services/trending.js";
import { summaryTextFromField } from "../services/summary.js";
import {
  ensureTrendingOrder,
  toSeenSet,
  updateSeenSession,
  TRENDING_FIRST_PAGE
} from "../lib/trending-cache.js";

export const dash = Router();

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  next();
}

dash.get("/participant", requireAuth, async (req, res, next) => {
  try {
    const user = req.session.user;
    if (user.role !== Role.PARTICIPANT) return res.redirect("/researcher");

    const q = (req.query.q || "").trim();
    const rawTab = (req.query.tab || "all").toLowerCase();
    const allowedTabs = new Set(["enrolled", "completed", "withdrawn"]);
    const tab = allowedTabs.has(rawTab) ? rawTab : "all";
    const statusByTab = {
      enrolled: EnrollmentStatus.ENROLLED,
      completed: EnrollmentStatus.COMPLETED,
      withdrawn: EnrollmentStatus.WITHDRAWN
    };

    const enrollments = await prisma.enrollment.findMany({
      where: {
        participantId: user.id,
        hiddenAt: null,
        ...(statusByTab[tab] ? { status: statusByTab[tab] } : {})
      },
      orderBy: [
        { joinedAt: "desc" },
        { id: "desc" }
      ],
      select: {
        id: true,
        status: true,
        study: {
          select: {
            id: true,
            title: true,
            slug: true,
            tags: true,
            status: true,
            joinCode: true,
            description: true,
            summaryGroq: true
          }
        }
      }
    });

    let studies = enrollments
      .filter((row) => row.study)
      .map((row) => ({
        enrollmentId: row.id,
        id: row.study.id,
        title: row.study.title,
        tags: row.study.tags ?? [],
        status: row.status,
        studyStatus: row.study.status,
        slug: row.study.slug,
        code: row.study.joinCode,
        summary:
          summaryTextFromField(row.study.summaryGroq) ||
          (row.study.description || "").slice(0, 160)
      }));

    if (q) {
      const needle = q.toLowerCase();
      studies = studies.filter((study) => {
        if (study.title?.toLowerCase().includes(needle)) return true;
        return (study.tags || []).some((tag) => tag.toLowerCase().includes(needle));
      });
    }

    const seenSet = toSeenSet(req.session?.trendingSeen);
    const order = await ensureTrendingOrder(req, user.id, "PARTICIPANT", new Set(seenSet));
    const trending = order.slice(0, TRENDING_FIRST_PAGE);
    trending.forEach((item) => seenSet.add(item.id));
    updateSeenSession(req, seenSet);

    res.render("participant", {
      title: "Participant",
      user,
      pageKind: "dash-participant",
      bodyClass: "dash-shell",
      studies,
      trending,
      filters: { tab, q }
    });
  } catch (error) {
    next(error);
  }
});

dash.post("/participant/unenroll/:enrollmentId", requireAuth, async (req, res, next) => {
  try {
    const user = req.session.user;
    if (user.role !== Role.PARTICIPANT) return res.status(403).send("Forbidden");

    const { enrollmentId } = req.params;
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId }
    });

    if (!enrollment || enrollment.participantId !== user.id) {
      return res.status(403).send("Forbidden");
    }

    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status: EnrollmentStatus.WITHDRAWN,
        leftAt: new Date()
      }
    });

    res.redirect("/participant");
  } catch (error) {
    next(error);
  }
});

dash.get("/researcher", requireAuth, async (req, res, next) => {
  try {
    const user = req.session.user;
    const researcherProfile = await prisma.researcherProfile.findUnique({
      where: { userId: user.id },
      select: { userId: true }
    });

    if (!researcherProfile) {
      return res.redirect("/account/roles/researcher/setup");
    }

    if (user.role !== Role.RESEARCHER) {
      req.session.user.role = Role.RESEARCHER;
      user.role = Role.RESEARCHER;
    }

    const q = (req.query.q || "").trim();
    const tab = (req.query.tab || "all").toLowerCase();

    const where = { ownerId: user.id };
    const statusMap = {
      recruiting: StudyStatus.RECRUITING,
      ongoing: StudyStatus.ACTIVE,
      completed: StudyStatus.COMPLETED,
      archived: StudyStatus.ARCHIVED
    };

    if (tab !== "all" && statusMap[tab]) {
      where.status = statusMap[tab];
    }

    let studies = await prisma.study.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        status: true,
        tags: true,
        slug: true,
        joinCode: true,
        description: true,
        summaryGroq: true,
        enrollments: {
          select: { id: true },
          where: {
            status: {
              in: [
                EnrollmentStatus.ENROLLED,
                EnrollmentStatus.COMPLETED,
                EnrollmentStatus.INVITED
              ]
            }
          }
        }
      }
    });

    if (q) {
      const needle = q.toLowerCase();
      studies = studies.filter((study) => {
        if (study.title?.toLowerCase().includes(needle)) return true;
        return (study.tags || []).some((tag) => tag.toLowerCase().includes(needle));
      });
    }

    const seenSet = toSeenSet(req.session?.trendingSeen);
    const order = await ensureTrendingOrder(req, user.id, "RESEARCHER", new Set(seenSet));
    const trending = order.slice(0, TRENDING_FIRST_PAGE);
    trending.forEach((item) => seenSet.add(item.id));
    updateSeenSession(req, seenSet);

    res.render("researcher", {
      title: "Researcher",
      user,
      pageKind: "researcher-dash",
      bodyClass: "dash-shell",
      studies: studies.map((study) => ({
        id: study.id,
        title: study.title,
        status: study.status,
        tags: study.tags ?? [],
        participants: study.enrollments.length,
        slug: study.slug,
        code: study.joinCode,
        summary:
          summaryTextFromField(study.summaryGroq) ||
          (study.description || "").slice(0, 160)
      })),
      trending,
      filters: { tab, q },
      owner: {
        name: user.name,
        institution: user.affiliation || ""
      }
    });
  } catch (error) {
    next(error);
  }
});

dash.get("/dev/trending-check", requireAuth, async (req, res, next) => {
  try {
    const { id, role } = req.session.user;
    const items = await getTrendingForUser(id, role, 10, new Set());
    res.json(items);
  } catch (error) {
    next(error);
  }
});


export default dash;
