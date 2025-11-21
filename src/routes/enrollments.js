import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ensureAuth } from "../middleware/auth.js";

const enrollments = Router();

enrollments.post("/enrollments/:id/hide", ensureAuth, async (req, res) => {
  const { id } = req.params;
  const enrollment = await prisma.enrollment.findUnique({
    where: { id },
    select: { participantId: true }
  });

  if (!enrollment || enrollment.participantId !== req.session.user.id) {
    return res.status(403).send("Forbidden");
  }

  await prisma.enrollment.update({
    where: { id },
    data: { hiddenAt: new Date() }
  });

  if ((req.headers.accept || "").includes("application/json")) {
    return res.json({ success: true });
  }

  const referer = req.get("referer");
  return res.redirect(referer || "/participant");
});

export default enrollments;
