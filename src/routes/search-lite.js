import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

const MAX_CANDIDATES = 200;
const TOKEN_SPLIT_REGEX = /[\s\-_.:/]+/g;

const normalizeText = (value = "") =>
  value
    .toString()
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) => {
  const tokens = value
    .toLowerCase()
    .split(TOKEN_SPLIT_REGEX)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return Array.from(new Set(tokens));
};

const parseStatuses = (raw) =>
  raw
    .toString()
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

const parseSummary = (raw) => {
  if (!raw) return {};
  try {
    const parsed =
      typeof raw === "string" && raw.trim().startsWith("{")
        ? JSON.parse(raw)
        : raw;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    /* ignore parse errors */
  }
  return {};
};

const buildSnippet = (needles, ...sources) => {
  const searchNeedles = needles.filter(Boolean);
  if (!searchNeedles.length) return "";
  for (const text of sources) {
    if (!text || typeof text !== "string") continue;
    const normalized = normalizeText(text);
    const index = searchNeedles
      .map((needle) => normalized.indexOf(needle))
      .filter((idx) => idx >= 0)
      .sort((a, b) => a - b)[0];
    if (typeof index === "number") {
      const start = Math.max(0, index - 60);
      const end = Math.min(text.length, index + 200);
      return text.slice(start, end).trim();
    }
  }
  return "";
};

const buildWhere = (query, terms, statuses) => {
  const orClauses = [];
  const pushField = (field, term) =>
    orClauses.push({ [field]: { contains: term, mode: "insensitive" } });

  const pushResearcherField = (field, term) =>
    orClauses.push({
      researcher: { [field]: { contains: term, mode: "insensitive" } }
    });

  const pushPermissionField = (field, term) =>
    orClauses.push({
      permissions: {
        some: {
          permission: {
            [field]: { contains: term, mode: "insensitive" }
          }
        }
      }
    });

  const needles = new Set([query, ...terms]);
  needles.forEach((needle) => {
    if (!needle) return;
    pushField("title", needle);
    pushField("description", needle);
    pushField("slug", needle);
    pushField("joinCode", needle);
    pushField("summaryGroq", needle);
    pushResearcherField("name", needle);
    pushResearcherField("email", needle);
    pushResearcherField("affiliation", needle);
    pushPermissionField("title", needle);
    pushPermissionField("description", needle);
    pushPermissionField("slug", needle);
  });

  const clauses = [];
  if (orClauses.length) {
    clauses.push({ OR: orClauses });
  }
  if (statuses.length) {
    clauses.push({ status: { in: statuses } });
  }
  if (!clauses.length) {
    return undefined;
  }
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
};

const attachPermissions = (study) =>
  (study.permissions || [])
    .map((perm) => {
      const descriptor = perm.permission || {};
      return [descriptor.title, descriptor.description, descriptor.slug]
        .filter(Boolean)
        .join(" ")
        .trim();
    })
    .filter(Boolean);

const scoreStudy = (
  study,
  queryTerms,
  normalizedQuery,
  normalizedQueryNoSpace,
  permissionStrings
) => {
  const researcherName = study.researcher?.name || "Research team";
  const researcherEmail = study.researcher?.email || "";
  const institution = study.researcher?.affiliation || "";
  const summaryData = parseSummary(study.summaryGroq);
  const summaryChunks = [
    summaryData.summary,
    summaryData.overview,
    summaryData.why,
    summaryData.what
  ].filter((chunk) => typeof chunk === "string" && chunk.trim().length);

  const codes = [study.joinCode, study.slug, study.id].filter(Boolean);
  const normalizedCodes = codes.map((code) => normalizeText(code));
  const exactCodeMatch = normalizedCodes.some(
    (code) => code.replace(/\s+/g, "") === normalizedQueryNoSpace
  );
  const partialCodeMatch =
    !exactCodeMatch &&
    normalizedCodes.some((code) => code.includes(normalizedQueryNoSpace));

  const haystack = normalizeText(
    [
      study.title,
      study.description,
      codes.join(" "),
      (study.tags || []).join(" "),
      researcherName,
      researcherEmail,
      institution,
      summaryChunks.join(" "),
      permissionStrings.join(" ")
    ].join(" ")
  );

  const matchedTerms = queryTerms.filter((term) => haystack.includes(term))
    .length;
  const minShouldMatch = Math.max(1, Math.ceil(queryTerms.length * 0.6));
  if (
    queryTerms.length &&
    !exactCodeMatch &&
    matchedTerms < minShouldMatch
  ) {
    return null;
  }

  let score = matchedTerms;
  if (exactCodeMatch) score += 8;
  else if (partialCodeMatch) score += 4;

  const titleNormalized = normalizeText(study.title);
  if (titleNormalized.includes(normalizedQuery)) score += 3;

  const ownerNormalized = normalizeText(
    `${researcherName} ${researcherEmail} ${institution}`
  );
  if (ownerNormalized.includes(normalizedQuery)) score += 2;

  const permissionNormalized = normalizeText(permissionStrings.join(" "));
  if (permissionNormalized.includes(normalizedQuery)) score += 2;

  const tagMatches = (study.tags || []).filter((tag) =>
    normalizeText(tag).includes(normalizedQuery)
  ).length;
  if (tagMatches) score += tagMatches * 1.5;

  const ageDays =
    (Date.now() - new Date(study.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const freshnessBoost = Math.max(0, 1 - ageDays / 365);
  score += freshnessBoost;

  score += (study.trendingScore || 0) * 0.5;

  const snippet = buildSnippet(
    [normalizedQuery, ...queryTerms],
    summaryChunks.join(" "),
    study.description,
    permissionStrings.join(" ")
  );

  return {
    study,
    score,
    matchedTerms,
    snippet,
    codes,
    researcherName,
    institution,
    permissions: permissionStrings.slice(0, 3),
    createdAt: new Date(study.createdAt),
    trending: study.trendingScore || 0
  };
};

const sortResults = (entries, sort) => {
  if (sort === "newest") {
    return [...entries].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }
  if (sort === "popular") {
    return [...entries].sort((a, b) => {
      if (b.trending !== a.trending) return b.trending - a.trending;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.trending !== a.trending) return b.trending - a.trending;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
};

router.get("/api/search-lite", async (req, res) => {
  try {
    const user = req.session?.user || null;
    const qRaw = (req.query.q || "").toString().trim();
    if (!qRaw) {
      return res.json({ total: 0, items: [] });
    }

    const limit = Math.min(parseInt(req.query.limit || "12", 10), 25);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
    const sort = (req.query.sort || "relevance").toString();
    const statuses = parseStatuses(req.query.status || "");
    const normalizedQuery = normalizeText(qRaw);
    const normalizedQueryNoSpace = normalizedQuery.replace(/\s+/g, "");

    let terms = tokenize(qRaw);
    if (!terms.length && normalizedQuery) {
      terms = [normalizedQuery];
    }

    const where = buildWhere(normalizedQuery, terms, statuses);
    const scope = String(req.query.scope || "").toLowerCase();
    const restrictToMine = scope === "mine" && user?.role === "RESEARCHER";
    const include = {
      researcher: { select: { name: true, email: true, affiliation: true } },
      permissions: {
        include: {
          permission: {
            select: { title: true, description: true, slug: true }
          }
        }
      }
    };

    const candidateTake = Math.min(
      MAX_CANDIDATES,
      Math.max(limit + offset, 50)
    );

    const baseQuery = {
      include,
      orderBy: { updatedAt: "desc" },
      take: candidateTake,
      where: restrictToMine ? { ownerId: user.id } : undefined
    };
    if (where) {
      baseQuery.where = baseQuery.where
        ? { AND: [baseQuery.where, where] }
        : where;
    }

    let studies = await prisma.study.findMany(baseQuery);

    if (!studies.length) {
      const fallbackWhere = {
        ...(statuses.length ? { status: { in: statuses } } : {}),
        ...(restrictToMine ? { ownerId: user.id } : {})
      };
      studies = await prisma.study.findMany({
        where: fallbackWhere,
        include,
        orderBy: { updatedAt: "desc" },
        take: candidateTake
      });
    }

    const scored = [];
    for (const study of studies) {
      const permissionStrings = attachPermissions(study);
      const scoredEntry = scoreStudy(
        study,
        terms,
        normalizedQuery,
        normalizedQueryNoSpace,
        permissionStrings
      );
      if (!scoredEntry) continue;
      scored.push(scoredEntry);
    }

    if (!scored.length) {
      return res.json({ total: 0, items: [] });
    }

    const sorted = sortResults(scored, sort);
    const total = sorted.length;
    const window = sorted.slice(offset, offset + limit);

    const items = window.map((entry) => {
      const primaryCode = entry.codes.find(Boolean) || "";
      return {
        id: entry.study.id,
        title: entry.study.title,
        status: entry.study.status,
        tags: entry.study.tags || [],
        researcherName: entry.researcherName,
        institution: entry.institution,
        code: primaryCode,
        createdAt: entry.createdAt.toISOString(),
        score: Number(entry.score.toFixed(4)),
        snippet: entry.snippet || "",
        permissions: entry.permissions
      };
    });

    res.json({ total, items });
  } catch (error) {
    console.error("[search-lite] error", error);
    res.status(500).json({ total: 0, items: [] });
  }
});

export default router;
