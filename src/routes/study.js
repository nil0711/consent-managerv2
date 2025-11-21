import { Router } from "express";
import crypto from "node:crypto";
import {
  EnrollmentStatus,
  PiiLevel,
  Prisma,
  Role,
  StudyStatus
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { streamGroq } from "../services/groq-chat.js";
import {
  getStudySummary,
  getPermissionSummary,
  primePermissionSummaries
} from "../services/summary.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const studyRouter = Router();

const isMissingRelation = (error, modelName) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2021" &&
  (!modelName || (typeof error.meta?.cause === "string" && error.meta.cause.includes(modelName)));

function requireParticipant(req, res, next) {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).send("Unauthorized");
  }
  if (user.role !== Role.PARTICIPANT) {
    return res.status(403).send("Forbidden");
  }
  res.locals.user = user;
  next();
}

function firstSentence(text) {
  if (!text) return "";
  const str = String(text).trim();
  const match = str.match(/[^.!?]*[.!?]/);
  if (!match) {
    return str.slice(0, 220);
  }
  return match[0].trim();
}

function describeRetention(months) {
  if (!Number.isFinite(months) || months <= 0) return null;
  const rounded = Math.max(1, Math.round(months));
  const days = rounded * 30;
  return {
    months: rounded,
    days,
    label:
      rounded === 1
        ? "Data retained for 1 month (~30 days)"
        : `Data retained for ${rounded} months (~${days} days)`
  };
}

function describeEffort(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes <= 15) {
    return `About ${Math.max(5, Math.round(minutes / 5) * 5)} minutes to review`;
  }
  if (minutes <= 45) {
    return `About ${Math.round(minutes / 5) * 5} minutes per session`;
  }
  return `Set aside roughly ${Math.round(minutes / 15) * 15} minutes`;
}

function riskFromPermissions(permissions) {
  if (!Array.isArray(permissions) || !permissions.length) {
    return { level: "Low", severity: 1 };
  }
  let severity = 1;
  for (const perm of permissions) {
    if (perm.piiLevel === PiiLevel.IDENTIFIABLE) {
      severity = Math.max(severity, 3);
    } else if (perm.piiLevel === PiiLevel.PSEUDONYMOUS) {
      severity = Math.max(severity, 2);
    }
  }
  const level = severity === 3 ? "High" : severity === 2 ? "Medium" : "Low";
  return { level, severity };
}

function formatDate(date) {
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(date);
  } catch {
    return date.toISOString().split("T")[0];
  }
}

function formatDateTime(date) {
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function humanizeStudyStatus(status) {
  switch (status) {
    case StudyStatus.RECRUITING:
      return "Recruiting";
    case StudyStatus.ACTIVE:
      return "Active";
    case StudyStatus.COMPLETED:
      return "Completed";
    case StudyStatus.ARCHIVED:
      return "Archived";
    default:
      return "Study";
  }
}

function humanizeEnrollment(status) {
  switch (status) {
    case EnrollmentStatus.ENROLLED:
      return "Enrolled";
    case EnrollmentStatus.INVITED:
      return "Invited";
    case EnrollmentStatus.WITHDRAWN:
      return "Withdrawn";
    case EnrollmentStatus.COMPLETED:
      return "Completed";
    default:
      return "Not enrolled";
  }
}

export async function loadStudyContext(studyId, userId) {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      researcher: {
        select: { name: true, affiliation: true, email: true }
      },
      permissions: {
        orderBy: [{ displayOrder: "asc" }],
        include: {
          permission: {
            select: {
              id: true,
              slug: true,
              title: true,
              description: true,
              defaultRequired: true,
              defaultAllow: true,
              piiLevel: true
            }
          }
        }
      },
      versions: {
        orderBy: [{ version: "desc" }],
        take: 1,
        select: { version: true, createdAt: true }
      }
    }
  });

  if (!study) {
    return null;
  }

  const enrollmentRow = await prisma.enrollment.findUnique({
    where: {
      studyId_participantId: {
        studyId,
        participantId: userId
      }
    },
    select: {
      id: true,
      status: true,
      joinedAt: true,
      leftAt: true
    }
  });

  const enrollment = enrollmentRow
    ? {
        id: enrollmentRow.id,
        status: enrollmentRow.status,
        joinedAt: enrollmentRow.joinedAt,
        leftAt: enrollmentRow.leftAt,
        lastChangedAt: enrollmentRow.leftAt ?? enrollmentRow.joinedAt ?? null
      }
    : {
        id: null,
        status: "AVAILABLE",
        joinedAt: null,
        leftAt: null,
        lastChangedAt: null
      };

  let grants = [];
  try {
    grants = await prisma.permissionGrant.findMany({
      where: {
        studyId,
        userId
      },
      select: { permKey: true, granted: true, updatedAt: true }
    });
  } catch (error) {
    if (!isMissingRelation(error, "PermissionGrant")) throw error;
    grants = [];
  }
  const grantsMap = new Map(grants.map((entry) => [entry.permKey, entry.granted]));

  await primePermissionSummaries(study.id, study.permissions || []);

  const permissions = await Promise.all(
    (study.permissions || []).map(async (perm) => {
      const permissionId = perm.permission?.id || perm.permissionId || perm.id;
      const studyPermissionId = perm.id;
      const key = perm.permission?.slug || "";
      const label = perm.permission?.title || key || "Permission";
      const description = perm.permission?.description || "";
      const required = Boolean(
        perm.required ?? perm.permission?.defaultRequired ?? false
      );
      const defaultAllow =
        perm.defaultAllow ?? perm.permission?.defaultAllow ?? false;
      const granted = required
        ? true
        : grantsMap.has(key)
        ? Boolean(grantsMap.get(key))
        : Boolean(defaultAllow);

      const blurb = await getPermissionSummary({
        studyId,
        perm: {
          id: perm.id || key,
          key,
          name: label,
          description
        }
      });

      const templateSensitive =
        perm.permission?.piiLevel === PiiLevel.IDENTIFIABLE ||
        perm.permission?.piiLevel === PiiLevel.PSEUDONYMOUS;
      const sensitive =
        typeof perm.sensitive === "boolean" ? perm.sensitive : templateSensitive;

      return {
        id: permissionId || studyPermissionId || key,
        permissionId,
        studyPermissionId,
        linkId: studyPermissionId,
        permissionSlug: key,
        key,
        name: label,
        label,
        description,
        required,
        granted,
        sensitive,
        piiLevel: perm.permission?.piiLevel || PiiLevel.NONE,
        blurb
      };
    })
  );

  const summaryDoc = await getStudySummary(study);

  const summary =
    summaryDoc?.summary ||
    firstSentence(study.description) ||
    "No summary provided yet.";

  const chatFallbackRaw = summaryDoc
    ? [
        summaryDoc.summary,
        summaryDoc.why,
        summaryDoc.time_effort,
        summaryDoc.retention_phrase,
        summaryDoc.risks_short
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const chatFallback =
    chatFallbackRaw.length > 600
      ? `${chatFallbackRaw.slice(0, 597)}…`
      : chatFallbackRaw;

  const retention = describeRetention(study.retentionMonths);
  const effort = describeEffort(study.reviewTimeMin);
  const risk = riskFromPermissions(permissions);

  const latestVersion = study.versions?.[0] || null;
  const consentVersion = latestVersion
    ? {
        version: latestVersion.version,
        updatedLabel: formatDate(latestVersion.createdAt)
      }
    : null;

  const collected = Array.from(
    new Set(permissions.map((perm) => perm.name).filter(Boolean))
  ).slice(0, 8);

  const statusChips = [];
  statusChips.push(humanizeStudyStatus(study.status));
  if (enrollment?.status) {
    statusChips.push(humanizeEnrollment(enrollment.status));
  }
  if (consentVersion?.version) {
    statusChips.push(`Consent v${consentVersion.version}`);
  }

  const contextVersionSeed = [
    study.updatedAt?.getTime() ?? 0,
    enrollment?.lastChangedAt?.getTime() ?? 0,
    ...grants.map((row) => row.updatedAt?.getTime() ?? 0)
  ];
  const contextVersion =
    contextVersionSeed.reduce((acc, value) => acc ^ Number(value || 0), 0) ||
    Date.now();

  return {
    study: {
      id: study.id,
      title: study.title,
      status: study.status,
      tags: study.tags || [],
      purpose: firstSentence(study.description),
      summary,
      retentionMonths: study.retentionMonths,
      reviewTimeMin: study.reviewTimeMin
    },
    owner: {
      name: study.researcher?.name || "Research team",
      institution: study.researcher?.affiliation || "Independent researcher",
      email: study.researcher?.email || ""
    },
    consentVersion,
    permissions,
    userEnrollment: enrollment,
    collected,
    retention,
    effort,
    risk,
    statusChips,
    contextVersion,
    summaryDetails: summaryDoc,
    chatFallback,
    pdfLinks: {
      snapshot: `/participant/studies/${study.id}/pdf/snapshot`,
      history: `/participant/studies/${study.id}/pdf/history`,
      diff: `/participant/studies/${study.id}/pdf/diff`,
      receipt: `/participant/studies/${study.id}/pdf/receipt`
    }
  };
}

studyRouter.use(requireParticipant);

studyRouter.get("/:id/chat", async (req, res) => {
  const user = res.locals.user;
  const { id } = req.params;
  const question = String(req.query.q || "").trim();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let finished = false;
  let controller = null;
  let upstreamTimeout = null;
  const heartbeat = setInterval(() => {
    if (!finished && !res.writableEnded) {
      res.write(":hb\n\n");
    }
  }, 10000);

  const endStream = (sendDone = true) => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    if (upstreamTimeout) {
      clearTimeout(upstreamTimeout);
      upstreamTimeout = null;
    }
    controller?.abort();
    if (sendDone && !res.writableEnded) {
      res.write("event:done\ndata: {}\n\n");
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  req.on("close", () => {
    endStream(false);
  });

  if (!question) {
    res.write(
      `event:alert\ndata:${JSON.stringify("Ask a question to start the chat.")}\n\n`
    );
    return endStream();
  }

  const payload = await loadStudyContext(id, user.id);
  if (!payload) {
    res.write(
      `event:alert\ndata:${JSON.stringify("Study not found.")}\n\n`
    );
    return endStream();
  }

  const context = {
    title: payload.study.title,
    summary: payload.study.summary,
    tags: payload.study.tags,
    retention: payload.retention?.label || "",
    owner: payload.owner
  };

  const fallbackMessage = payload.chatFallback
    ? `Model not available—here’s what we know:\n${payload.chatFallback}`
    : "Model not available—please review the study summary above.";

  controller = new AbortController();
  upstreamTimeout = setTimeout(() => controller.abort(), 5000);

  try {
    await streamGroq(
      { prompt: question, context },
      (chunk) => {
        if (upstreamTimeout) {
          clearTimeout(upstreamTimeout);
          upstreamTimeout = null;
        }
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      },
      { signal: controller.signal }
    );
  } catch (error) {
    console.error("[study-chat] stream failed:", error);
    res.write(`event:alert\ndata:${JSON.stringify(fallbackMessage)}\n\n`);
  }
  endStream();
});

studyRouter.get("/:id/modal", async (req, res) => {
  const startedAt = Date.now();
  const { id } = req.params;
  const user = res.locals.user;

  if (!user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  console.log("[study-modal] hit", { studyId: id, userId: user.id });

  try {
    const payload = await loadStudyContext(id, user.id);
    if (!payload) {
      console.warn("[study-modal] context-null", { studyId: id });
      return res.status(404).json({ error: "NOT_FOUND" });
    }

    res.set("Cache-Control", "no-store");
    return res.render("partials/study-modal", {
      ...payload,
      layout: false
    });
  } catch (error) {
    console.error("[study-modal] error", {
      studyId: id,
      message: error?.message,
      stack: typeof error?.stack === "string" ? error.stack.slice(0, 1000) : null
    });
    if (!res.headersSent) {
      return res.status(500).json({
        error: "SERVER_ERROR",
        message: error?.message ?? "unknown"
      });
    }
  } finally {
    console.log("[study-modal] done", { ms: Date.now() - startedAt });
  }
});

studyRouter.get("/:id/versions.json", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    const payload = await loadStudyContext(id, user.id);
    if (!payload) {
      return res.status(404).json({ error: "not_found" });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studyId_participantId: {
          studyId: id,
          participantId: user.id
        }
      },
      select: {
        consentVersions: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            version: true,
            createdAt: true,
            decisionsJson: true
          }
        }
      }
    });

    const labels = Object.fromEntries(
      (payload.permissions || []).map((perm) => [perm.key, perm.label])
    );

    const versions = (enrollment?.consentVersions || []).map((entry) => {
      const keys = Array.isArray(entry.decisionsJson?.permissions)
        ? entry.decisionsJson.permissions.map(String)
        : [];
      const label = entry.version
        ? `Version ${entry.version}`
        : `Saved ${formatDateTime(entry.createdAt)}`;
      return {
        id: entry.id,
        label,
        savedAtText: formatDateTime(entry.createdAt),
        chips: keys.map((key) => labels[key] || key),
        ids: keys
      };
    });

    res.json({
      studyId: id,
      versions,
      labels
    });
  } catch (error) {
    next(error);
  }
});

studyRouter.post("/:id/permissions", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    const grantedKeys = new Set();
    const declinedKeys = new Set();

    if (Array.isArray(req.body?.patch)) {
      for (const entry of req.body.patch) {
        const key = String(entry?.id ?? entry?.key ?? entry?.permKey ?? "").trim();
        if (!key) continue;
        if (entry?.granted === true) {
          grantedKeys.add(key);
          declinedKeys.delete(key);
        } else if (entry?.granted === false) {
          declinedKeys.add(key);
          grantedKeys.delete(key);
        }
      }
    } else {
      const legacyGranted = Array.isArray(req.body?.granted)
        ? req.body.granted.map(String)
        : [];
      const legacyDeclined = Array.isArray(req.body?.declined)
        ? req.body.declined.map(String)
        : [];
      for (const key of legacyGranted) {
        grantedKeys.add(String(key));
      }
      for (const key of legacyDeclined) {
        declinedKeys.add(String(key));
      }
    }

    const changedKeys = new Set([...grantedKeys, ...declinedKeys]);

    const study = await prisma.study.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!study) {
      return res.status(404).json({ error: "not_found" });
    }

    if (!changedKeys.size) {
      const payload = await loadStudyContext(id, user.id);
      return res.json({
        ok: true,
        permissions: payload?.permissions ?? [],
        enrollmentStatus: payload?.userEnrollment?.status ?? null
      });
    }

    const perms = await prisma.studyPermission.findMany({
      where: {
        studyId: id,
        permission: {
          slug: { in: Array.from(changedKeys) }
        }
      },
      include: {
        permission: {
          select: {
            slug: true,
            defaultRequired: true
          }
        }
      }
    });

    for (const perm of perms) {
      const key = perm.permission?.slug;
      if (!key) continue;
      const required = Boolean(
        perm.required ?? perm.permission?.defaultRequired ?? false
      );
      if (required) continue;
      const nextGranted = grantedKeys.has(key)
        ? true
        : declinedKeys.has(key)
        ? false
        : null;
      if (nextGranted === null) continue;
      await prisma.permissionGrant.upsert({
        where: {
          studyId_userId_permKey: {
            studyId: id,
            userId: user.id,
            permKey: key
          }
        },
        create: {
          studyId: id,
          userId: user.id,
          permKey: key,
          granted: nextGranted
        },
        update: {
          granted: nextGranted
        }
      });
    }

    const payload = await loadStudyContext(id, user.id);
    res.json({
      ok: true,
      permissions: payload?.permissions ?? [],
      enrollmentStatus: payload?.userEnrollment?.status ?? null
    });
  } catch (error) {
    next(error);
  }
});

studyRouter.get("/:id/versions", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;

    const versions = await prisma.consentVersion.findMany({
      where: {
        enrollment: {
          studyId: id,
          participantId: user.id
        }
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        version: true,
        createdAt: true,
        decisionsJson: true
      }
    });

    const response = versions.map((entry) => ({
      id: entry.id,
      version: entry.version,
      createdAt: entry.createdAt,
      permissions: Array.isArray(entry.decisionsJson?.permissions)
        ? entry.decisionsJson.permissions
        : []
    }));

    res.json(response);
  } catch (error) {
    next(error);
  }
});

studyRouter.post("/:id/versions", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    const selected = Array.isArray(req.body?.selectedPermissionIds)
      ? req.body.selectedPermissionIds.map(String)
      : [];

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studyId_participantId: {
          studyId: id,
          participantId: user.id
        }
      },
      select: { id: true }
    });

    if (!enrollment) {
      return res.status(400).json({ error: "not_enrolled" });
    }

    const existingCount = await prisma.consentVersion.count({
      where: { enrollmentId: enrollment.id }
    });

    const snapshot = { permissions: selected };
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex");

    const created = await prisma.consentVersion.create({
      data: {
        enrollmentId: enrollment.id,
        version: existingCount + 1,
        decisionsJson: snapshot,
        receiptHash: hash
      },
      select: { id: true, version: true, createdAt: true, decisionsJson: true }
    });

    res.json({
      id: created.id,
      version: created.version,
      createdAt: created.createdAt,
      permissions: Array.isArray(created.decisionsJson?.permissions)
        ? created.decisionsJson.permissions
        : []
    });
  } catch (error) {
    next(error);
  }
});

studyRouter.post("/:id/chat", async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = res.locals.user;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    if (!messages.length) {
      return res.status(400).json({ error: "missing_messages" });
    }

    const payload = await loadStudyContext(id, user.id);
    if (!payload) {
      return res.status(404).json({ error: "not_found" });
    }

    const systemContext = [
      `You are a grounded assistant embedded in a consent manager.`,
      `Keep answers factual, concise, and reference study details when relevant.`,
      `If you don't know, say so clearly.`
    ].join(" ");

    const contextSnippet = [
      `Study: ${payload.study.title} (${humanizeStudyStatus(payload.study.status)})`,
      `Summary: ${payload.study.summary}`,
      `Purpose: ${payload.study.purpose}`,
      payload.owner?.institution
        ? `Institution: ${payload.owner.institution}`
        : null,
      payload.retention?.label
        ? `Data retention: ${payload.retention.label}`
        : null,
      payload.effort ? `Participant effort: ${payload.effort}` : null,
      `Risk level: ${payload.risk.level}`,
      `Participant enrollment: ${payload.userEnrollment?.status || "UNENROLLED"}`,
      `Permissions: ${payload.permissions
        .map(
          (perm) =>
            `${perm.label}: ${perm.granted ? "ON" : perm.required ? "Required" : "OFF"}`
        )
        .join("; ")}`
    ]
      .filter(Boolean)
      .join("\n");

    if (!GROQ_API_KEY) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ delta: "Chatbot is offline in demo mode." })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        stream: true,
        temperature: 0.2,
        max_tokens: 512,
        messages: [
          { role: "system", content: systemContext },
          { role: "system", content: contextSnippet },
          ...messages
        ]
      })
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      res.write(
        `data: ${JSON.stringify({
          delta: "Chat service failed to respond. Please try again later."
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ error: true, detail: errorText })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const reader = response.body.getReader();

    let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payloadStr = trimmed.slice(5).trim();
        if (payloadStr === "[DONE]") {
          finished = true;
          break;
        }
        try {
          const json = JSON.parse(payloadStr);
          const delta =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.message?.content ??
            "";
          if (delta) {
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch {
          // ignore malformed chunk
        }
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      const lines = buffer.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payloadStr = trimmed.slice(5).trim();
        if (!payloadStr || payloadStr === "[DONE]") continue;
        try {
          const json = JSON.parse(payloadStr);
          const delta =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.message?.content ??
            "";
          if (delta) {
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch {
          // ignore
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    next(error);
  }
});

export default studyRouter;
