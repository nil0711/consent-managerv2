import express from "express";
import bcrypt from "bcrypt";
import { prisma } from "../db/prisma.js";

const router = express.Router();

router.get("/login", (_req, res) => {
  res.render("login", {
    title: "Log in",
    bodyClass: "auth-shell",
    pageId: "login",
    error: null,
    notice: null,
    email: ""
  });
});

router.post("/login", async (req, res) => {
  const rawEmail = req.body?.email;
  const email = rawEmail ? rawEmail.trim() : "";
  const password = req.body?.password;

  if (!email || !password) {
    return res.status(400).render("login", {
      title: "Log in",
      error: "Enter email and password.",
      email,
      bodyClass: "auth-shell",
      pageId: "login"
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    let passwordMatches = false;
    if (user?.password) {
      if (user.password.startsWith("$2")) {
        try {
          passwordMatches = await bcrypt.compare(password, user.password);
        } catch (err) {
          console.error("bcrypt compare failed", err);
          passwordMatches = false;
        }
      } else {
        passwordMatches = user.password === password;
      }
    }

    if (!user || !passwordMatches) {
      return res.status(401).render("login", {
        title: "Log in",
        error: "Invalid credentials",
        email,
        bodyClass: "auth-shell",
        pageId: "login"
      });
    }

    const [participantProfile, researcherProfile] = await Promise.all([
      prisma.participantProfile.findUnique({
        where: { userId: user.id },
        select: { userId: true }
      }),
      prisma.researcherProfile.findUnique({
        where: { userId: user.id },
        select: { userId: true }
      })
    ]);

    req.session.userProfiles = {
      participant: Boolean(participantProfile),
      researcher: Boolean(researcherProfile)
    };

    req.session.user = {
      id: user.id,
      role: user.role,
      roles: Array.isArray(user.roles) ? user.roles : [],
      name: user.name,
      email: user.email
    };

    if (user.role === "RESEARCHER") {
      return res.redirect("/researcher");
    }
    return res.redirect("/participant");
  } catch (error) {
    console.error(error);
    return res.status(500).render("login", {
      title: "Log in",
      error: "Server error",
      email,
      bodyClass: "auth-shell",
      pageId: "login"
    });
  }
});

router.get("/signup", (req, res) => {
  const q = String(req.query.role || "").toUpperCase();
  const role = q === "RESEARCHER" ? "RESEARCHER" : "PARTICIPANT";
  res.render("signup", {
    title: "Create account",
    bodyClass: "auth-shell",
    pageId: "signup",
    error: null,
    notice: null,
    role
  });
});

router.post("/signup", async (req, res) => {
  const email = req.body?.email?.trim();
  const password = req.body?.password;
  const role = req.body?.role;
  const name = req.body?.name;

  if (!email || !password || !role) {
    return res.status(400).render("signup", {
      title: "Create account",
      bodyClass: "auth-shell",
      pageId: "signup",
      error: "Email, password, and role are required.",
      notice: null,
      role: (role || "PARTICIPANT").toUpperCase()
    });
  }

  const normalizedRole = role.toUpperCase() === "RESEARCHER" ? "RESEARCHER" : "PARTICIPANT";

  try {
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password,
        role: normalizedRole,
        roles: [normalizedRole],
        name: name && name.trim() ? name.trim() : email.split("@")[0]
      }
    });

    if (normalizedRole === "PARTICIPANT") {
      await prisma.participantProfile.create({
        data: { userId: user.id }
      });
    }

    req.session.userProfiles = {
      participant: normalizedRole === "PARTICIPANT",
      researcher: false
    };

    req.session.user = {
      id: user.id,
      role: user.role,
      roles: Array.isArray(user.roles) ? user.roles : [user.role],
      name: user.name,
      email: user.email
    };

    return res.redirect(user.role === "RESEARCHER" ? "/researcher" : "/participant");
  } catch (error) {
    const message = error?.code === "P2002"
      ? "That email is already registered."
      : "Could not create your account.";
    console.error(error);
    return res.status(400).render("signup", {
      title: "Create account",
      bodyClass: "auth-shell",
      pageId: "signup",
      error: message,
      notice: null,
      role: (role || "PARTICIPANT").toUpperCase()
    });
  }
});

const destroySession = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("cm.sid");
    res.redirect("/login");
  });
};

router.post("/logout", destroySession);
router.get("/logout", destroySession);

export default router;
