import { Router } from "express";
import { EnrollmentStatus, Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ensureAuth } from "../middleware/auth.js";

const participant = Router();

participant.use(ensureAuth);

participant.post("/studies/:id/remove", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || user.role !== Role.PARTICIPANT) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const studyId = req.params.id;
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studyId_participantId: {
          studyId,
          participantId: user.id
        }
      },
      select: { id: true, status: true }
    });

    if (!enrollment) {
      return res.status(404).json({ ok: false, error: "Not found." });
    }

    if (
      ![
        EnrollmentStatus.COMPLETED,
        EnrollmentStatus.WITHDRAWN
      ].includes(enrollment.status)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Only completed or withdrawn studies can be removed."
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.consentVersion.deleteMany({
        where: { enrollmentId: enrollment.id }
      });
      await tx.enrollment.delete({
        where: { id: enrollment.id }
      });
    });

    const wantsJson =
      (req.headers.accept || "").includes("application/json") ||
      (req.headers["x-requested-with"] || "").toLowerCase() === "fetch";

    if (wantsJson) {
      return res.json({ ok: true });
    }

    return res.redirect("/participant");
  } catch (error) {
    console.error("[participant/remove]", error);
    return res.status(500).json({ ok: false, error: "Server error." });
  }
});

export default participant;
