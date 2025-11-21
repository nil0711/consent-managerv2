import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import { ensureAuth } from "../middleware/auth.js";

const account = Router();

const TARGET_ROLES = new Set(["PARTICIPANT", "RESEARCHER"]);

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const syncProfileState = async (userId, session) => {
  const [participantProfile, researcherProfile] = await Promise.all([
    prisma.participantProfile.findUnique({
      where: { userId },
      select: { userId: true }
    }),
    prisma.researcherProfile.findUnique({
      where: { userId },
      select: { userId: true }
    })
  ]);
  const state = {
    participant: Boolean(participantProfile),
    researcher: Boolean(researcherProfile)
  };
  session.userProfiles = state;
  return state;
};

const toProfileForm = (userRecord, participantProfile) => ({
  name: userRecord?.name || "",
  displayName: participantProfile?.displayName || "",
  institution: userRecord?.affiliation || ""
});

const renderAccountPage = async (req, res, options = {}) => {
  const userId = req.session.user.id;
  const [userRecord, participantProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, affiliation: true }
    }),
    prisma.participantProfile.findUnique({
      where: { userId },
      select: { displayName: true }
    })
  ]);

  await syncProfileState(userId, req.session);

  const defaults = toProfileForm(userRecord, participantProfile);
  const profileForm = {
    name: options.formValues?.name ?? defaults.name,
    displayName: options.formValues?.displayName ?? defaults.displayName,
    institution: options.formValues?.institution ?? defaults.institution
  };
  const savedFlag =
    typeof options.saved === "boolean"
      ? options.saved
      : options.skipQuerySaved
        ? false
        : req.query.saved === "1";

  return res.render("account/index", {
    title: "Account",
    pageKind: "account",
    user: profileForm,
    error: options.error || null,
    saved: savedFlag
  });
};

const renderResearcherSetup = async (req, res, options = {}) => {
  const userId = req.session.user.id;
  const profile = await prisma.researcherProfile.findUnique({
    where: { userId },
    select: {
      affiliation: true,
      contactEmail: true
    }
  });

  await syncProfileState(userId, req.session);

  const defaults = {
    displayName: req.session.user?.name || "",
    affiliation: profile?.affiliation || "",
    contactEmail: profile?.contactEmail || ""
  };
  const form = {
    displayName: options.formValues?.displayName ?? defaults.displayName,
    affiliation: options.formValues?.affiliation ?? defaults.affiliation,
    contactEmail: options.formValues?.contactEmail ?? defaults.contactEmail
  };

  return res.render("account/researcher-setup", {
    title: "Researcher setup",
    pageKind: "account",
    form,
    error: options.error || null
  });
};

const verifyPassword = async (plain, stored) => {
  if (!stored) return false;
  if (!plain) return false;
  if (stored.startsWith("$2")) {
    try {
      return await bcrypt.compare(plain, stored);
    } catch {
      return false;
    }
  }
  return stored === plain;
};

account.use(ensureAuth);

account.get("/account", async (req, res, next) => {
  try {
    await renderAccountPage(req, res);
  } catch (error) {
    next(error);
  }
});

account.post("/account/profile", async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const name = (req.body?.name || "").trim();
    const displayName = (req.body?.displayName || "").trim();
    const institution = (req.body?.institution || "").trim();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: name || req.session.user.name,
          affiliation: institution || null
        }
      });
      await tx.participantProfile.upsert({
        where: { userId },
        create: {
          userId,
          displayName: displayName || null
        },
        update: {
          displayName: displayName || null
        }
      });
    });
    req.session.user.name =
      name || req.session.user.name || req.session.user.email;
    await syncProfileState(userId, req.session);
    res.redirect("/account?saved=1");
  } catch (error) {
    next(error);
  }
});

account.get("/account/roles/:role/setup", async (req, res, next) => {
  try {
    const role = req.params.role.toLowerCase();
    if (role !== "researcher") return res.redirect("/account");
    await renderResearcherSetup(req, res);
  } catch (error) {
    next(error);
  }
});

account.post("/account/roles/researcher/setup", async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const displayName = (req.body?.displayName || "").trim();
    const affiliation = (req.body?.affiliation || "").trim();
    const contactEmail = (req.body?.contactEmail || "").trim();

    if (!displayName) {
      return renderResearcherSetup(req, res, {
        error: "Display name is required.",
        formValues: { displayName, affiliation, contactEmail }
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.researcherProfile.upsert({
        where: { userId },
        create: {
          userId,
          affiliation: affiliation || null,
          contactEmail: contactEmail || null,
          bio: null,
          prefsJson: undefined
        },
        update: {
          affiliation: affiliation || null,
          contactEmail: contactEmail || null
        }
      });
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { roles: true }
      });
      const roles = ensureArray(current?.roles);
      if (!roles.includes("RESEARCHER")) {
        roles.push("RESEARCHER");
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          role: "RESEARCHER",
          roles,
          name: displayName || req.session.user.name
        }
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "ROLE_GRANTED",
          metaJson: { role: "RESEARCHER" }
        }
      });
    });

    req.session.user.role = "RESEARCHER";
    req.session.user.roles = ensureArray(req.session.user.roles);
    if (!req.session.user.roles.includes("RESEARCHER")) {
      req.session.user.roles.push("RESEARCHER");
    }
    await syncProfileState(userId, req.session);
    req.session.user.name = displayName || req.session.user.name;
    res.redirect("/researcher");
  } catch (error) {
    next(error);
  }
});

account.post("/account/roles/switch", async (req, res, next) => {
  try {
    const target = (req.body?.role || "").toString().trim().toUpperCase();
    if (!TARGET_ROLES.has(target)) {
      return res.status(400).json({ error: "bad role" });
    }
    const userId = req.session.user.id;
    let recordRoles = [];
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { roles: true }
    });
    recordRoles = ensureArray(userRecord?.roles);

    if (target === "RESEARCHER") {
      const researcherProfile = await prisma.researcherProfile.findUnique({
        where: { userId },
        select: { userId: true }
      });
      if (!researcherProfile) {
        return res.status(409).json({ needsSetup: true, target: "researcher" });
      }
    } else {
      const participantProfile = await prisma.participantProfile.findUnique({
        where: { userId },
        select: { userId: true }
      });
      if (!participantProfile) {
        await prisma.participantProfile.create({ data: { userId } });
      }
    }
    if (!recordRoles.includes(target)) {
      recordRoles.push(target);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { role: target, roles: recordRoles }
    });
    req.session.user.role = target;
    req.session.user.roles = recordRoles.slice();
    await syncProfileState(userId, req.session);
    res.json({
      ok: true,
      redirect: target === "RESEARCHER" ? "/researcher" : "/participant"
    });
  } catch (error) {
    next(error);
  }
});

account.post("/account/delete", async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const confirmText = (req.body?.confirm || "").trim().toUpperCase();
    const password = req.body?.password || "";

    if (confirmText !== "DELETE") {
      return renderAccountPage(req, res, {
        error: "Type DELETE to confirm.",
        skipQuerySaved: true
      });
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true }
    });

    if (!userRecord) {
      return renderAccountPage(req, res, {
        error: "Not authenticated.",
        skipQuerySaved: true
      });
    }

    if (!userRecord.password) {
      return renderAccountPage(req, res, {
        error: "Password required.",
        skipQuerySaved: true
      });
    }

    const validPassword = await verifyPassword(password, userRecord.password);
    if (!validPassword) {
      return renderAccountPage(req, res, {
        error: "Invalid password.",
        skipQuerySaved: true
      });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const activeOwned = await tx.study.count({
        where: {
          ownerId: userId,
          status: { not: "ARCHIVED" },
          enrollments: { some: {} }
        }
      });

      if (activeOwned > 0) {
        return { blocked: true };
      }

      const ownedStudies = await tx.study.findMany({
        where: { ownerId: userId },
        select: { id: true }
      });
      const ownedStudyIds = ownedStudies.map((row) => row.id);

      const ownedEnrollmentIds =
        ownedStudyIds.length > 0
          ? await tx.enrollment
              .findMany({
                where: { studyId: { in: ownedStudyIds } },
                select: { id: true }
              })
              .then((rows) => rows.map((row) => row.id))
          : [];

      const participantEnrollmentIds = await tx.enrollment
        .findMany({
          where: { participantId: userId },
          select: { id: true }
        })
        .then((rows) => rows.map((row) => row.id));

      const enrollmentIds = Array.from(
        new Set([...ownedEnrollmentIds, ...participantEnrollmentIds])
      );

      if (enrollmentIds.length) {
        await tx.consentVersion.deleteMany({
          where: { enrollmentId: { in: enrollmentIds } }
        });
        await tx.enrollment.deleteMany({
          where: { id: { in: enrollmentIds } }
        });
      }

      if (ownedStudyIds.length) {
        await tx.studyPermission.deleteMany({
          where: { studyId: { in: ownedStudyIds } }
        });
        await tx.permissionGrant.deleteMany({
          where: { studyId: { in: ownedStudyIds } }
        });
        await tx.studyVersion.deleteMany({
          where: { studyId: { in: ownedStudyIds } }
        });
        await tx.chatMessage.deleteMany({
          where: { studyId: { in: ownedStudyIds } }
        });
        await tx.study.deleteMany({ where: { id: { in: ownedStudyIds } } });
      }

      await tx.chatMessage.deleteMany({ where: { userId } });
      await tx.permissionGrant.deleteMany({ where: { userId } });
      await tx.auditLog.deleteMany({ where: { userId } });
      await tx.participantProfile.deleteMany({ where: { userId } });
      await tx.researcherProfile.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });

      return { blocked: false };
    });

    if (outcome?.blocked) {
      return renderAccountPage(req, res, {
        error:
          "You still own active studies with participants. Archive or transfer them before deleting your account.",
        skipQuerySaved: true
      });
    }

    return req.session.destroy(() => {
      res.clearCookie("cm.sid");
      res.redirect("/login");
    });
  } catch (error) {
    console.error("[account/delete]", error);
    next(error);
  }
});

export default account;
