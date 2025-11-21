const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function minmaxNormalize(map) {
  const values = [...map.values()];
  if (values.length === 0) return map;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max <= min) {
    return new Map([...map].map(([key]) => [key, 0]));
  }
  return new Map(
    [...map].map(([key, value]) => [key, (value - min) / (max - min)])
  );
}

export async function rankWithGroq(profile, candidates) {
  if (!API_KEY) return new Map();
  if (!Array.isArray(candidates) || candidates.length === 0) return new Map();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  const input = {
    role: profile?.role,
    profile: {
      topTags: profile?.topTags ?? [],
      topTerms: profile?.topTerms ?? []
    },
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      tags: candidate.tags,
      status: candidate.status,
      shortDesc: (candidate.description || "").slice(0, 240)
    }))
  };

  const systemPrompt = [
    "You rank research studies for a user.",
    "Output PURE JSON, like:",
    `[{"id":"<study_id>","score":0-100,"reason":"<=120 chars"}]`,
    "No extra text."
  ].join(" ");

  const body = {
    model: MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(input) }
    ],
    max_tokens: 600
  };

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      return new Map();
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() ?? "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Map();
    }
    if (!Array.isArray(parsed)) return new Map();

    const scores = new Map();
    for (const row of parsed) {
      if (!row || typeof row.id !== "string") continue;
      const score = Number(row.score);
      if (Number.isNaN(score)) continue;
      scores.set(row.id, score);
    }

    return minmaxNormalize(scores);
  } catch {
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}

export async function summarizeStudy(details) {
  if (!API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  const body = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 140,
    messages: [
      {
        role: "system",
        content: [
          "You write concise, factual blurbs for research study dashboards.",
          "One sentence, max 160 characters.",
          "Highlight participant benefit, study focus, or data collected.",
          "No marketing hype, no emojis."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          title: details?.title,
          status: details?.status,
          description: (details?.description || "").slice(0, 400),
          tags: (details?.tags || []).slice(0, 6),
          reviewTimeMin: details?.reviewTimeMin,
          retentionMonths: details?.retentionMonths
        })
      }
    ]
  };

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    return text.replace(/\s+/g, " ").trim().slice(0, 160);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export { minmaxNormalize };
