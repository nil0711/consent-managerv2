#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function makeRng(seed = 1) {
  let s = seed;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

const rand = makeRng(20251102);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, "..", "src", "demo");
const PARTICIPANT_COUNT = 5000;
const RESEARCHER_COUNT = 500;
const STUDY_COUNT = 10000;
const PERMISSION_COUNT = 200;

const firstNames = [
  "Aarav",
  "Vivaan",
  "Aditya",
  "Vihaan",
  "Arjun",
  "Reyansh",
  "Ishaan",
  "Shaurya",
  "Atharv",
  "Krishna",
  "Ananya",
  "Aadhya",
  "Diya",
  "Kiara",
  "Myra",
  "Sara",
  "Ira",
  "Aarohi",
  "Anika",
  "Navya"
];

const lastNames = [
  "Sharma",
  "Verma",
  "Gupta",
  "Iyer",
  "Mukherjee",
  "Nair",
  "Reddy",
  "Chowdhury",
  "Ghosh",
  "Patil",
  "Khan",
  "Singh",
  "Das",
  "Banerjee",
  "Pillai"
];

const affiliations = [
  "IIT Delhi",
  "IISc Bengaluru",
  "IIT Bombay",
  "IIIT Hyderabad",
  "IIT Madras",
  "ISI Kolkata",
  "TIFR",
  "IIT Kharagpur"
];

const studyAdjs = [
  "Consent-aware",
  "Micro-consent",
  "Longitudinal",
  "AI-assisted",
  "Campus",
  "Wearable data",
  "Support program",
  "Digital access",
  "Privacy-first"
];

const studyNouns = [
  "pilot",
  "study",
  "loop",
  "cohort",
  "registry",
  "tracker",
  "insights",
  "feedback",
  "panel"
];

const studyCategories = [
  "city labs",
  "health insights",
  "education",
  "financial inclusion",
  "campus life",
  "digital wellbeing",
  "mobility",
  "community programs",
  "rural outreach",
  "sustainability"
];

const studyDurations = [
  "8 min check-in",
  "10 min walkthrough",
  "12 min review",
  "15 min survey",
  "18 min workshop",
  "20 min interview",
  "25 min diary",
  "30 min reflection"
];

const studyFocuses = [
  "mobility patterns",
  "sleep habits",
  "campus access choices",
  "digital wellbeing",
  "nutrition diaries",
  "stress reflections",
  "transit wait-times",
  "education journeys",
  "financial planning",
  "community engagement"
];

const permissionConcepts = {
  activity: [
    "step summary",
    "session log",
    "commute trace",
    "mobility heatmap",
    "sleep cycle",
    "recovery score",
    "sedentary streak",
    "intensity zone",
    "active minutes",
    "standing time",
    "cycling cadence",
    "heart rate trend",
    "calorie burn",
    "lifting sets",
    "yoga flow",
    "indoor workout",
    "outdoor sprint",
    "evening walk",
    "weekend hike",
    "sports drill"
  ],
  health: [
    "blood pressure log",
    "mood check-in",
    "medication adherence",
    "biometric snapshot",
    "nutrition diary",
    "resting heart rate",
    "breathing pattern",
    "stress index",
    "glucose trend",
    "hydration log",
    "sleep quality",
    "symptom tracker",
    "mindfulness streak",
    "energy survey",
    "immunity check",
    "allergy report",
    "pain timeline",
    "therapy notes",
    "care feedback",
    "vital summary"
  ],
  survey: [
    "weekly questionnaire",
    "consent feedback",
    "satisfaction pulse",
    "wellbeing survey",
    "usability check-in",
    "lifestyle survey",
    "follow-up form",
    "post-study review",
    "screening responses",
    "open feedback",
    "journey mapping",
    "field diary",
    "quick poll",
    "pilot debrief",
    "topic deep-dive",
    "shift reflection",
    "peer comparison",
    "insight upload",
    "daily log",
    "wrap-up survey"
  ],
  contact: [
    "sms updates",
    "email reminders",
    "phone interviews",
    "push notifications",
    "researcher messages",
    "emergency contact",
    "calendar invites",
    "community events",
    "whatsapp updates",
    "schedule coordination",
    "office hours",
    "support hotline",
    "feedback call",
    "meetup invites",
    "check-in notes",
    "mentor pairing",
    "group session",
    "onboarding chat",
    "newsletter digest",
    "reminder digest"
  ],
  media: [
    "photo diary",
    "audio snippet",
    "video log",
    "screen recording",
    "transcript access",
    "screenshot archive",
    "voice memo",
    "photo consent",
    "livestream participation",
    "media tagging",
    "story capture",
    "clip annotation",
    "research reel",
    "camera roll",
    "focus session",
    "short reel",
    "event gallery",
    "prototype demo",
    "interface capture",
    "design critique"
  ],
  longitudinal: [
    "cohort survey",
    "retention check",
    "annual follow-up",
    "biometric trend",
    "outcome summary",
    "quarterly review",
    "timeline alignment",
    "trend comparison",
    "archive access",
    "participation audit",
    "progress pulse",
    "milestone recap",
    "extended feedback",
    "legacy consent",
    "five-year outlook",
    "long-term snapshot",
    "panel refresh",
    "journey review",
    "renewal notice",
    "insight bundle"
  ]
};

const permissionFrequencies = [
  { code: "DAILY", label: "daily" },
  { code: "WEEKLY", label: "weekly" },
  { code: "MONTHLY", label: "monthly" },
  { code: "QUARTERLY", label: "quarterly" },
  { code: "ANNUAL", label: "annual" },
  { code: "ADHOC", label: "on-demand" }
];

function randomInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function choice(array) {
  return array[randomInt(0, array.length - 1)];
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugifyEmailName(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
}

function randomDateBetween(startMs, endMs) {
  if (endMs <= startMs) {
    return new Date(startMs).toISOString();
  }
  const value = startMs + rand() * (endMs - startMs);
  return new Date(Math.floor(value)).toISOString();
}

function removeFromArray(arr, index) {
  const lastIndex = arr.length - 1;
  [arr[index], arr[lastIndex]] = [arr[lastIndex], arr[index]];
  arr.pop();
}

function writeJson(fileName, data) {
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), JSON.stringify(data, null, 2));
}

function sampleUnique(array, count) {
  const result = [];
  const used = new Set();
  while (result.length < count) {
    const idx = randomInt(0, array.length - 1);
    const value = array[idx];
    if (used.has(value)) continue;
    used.add(value);
    result.push(value);
  }
  return result;
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Participants
const participantCreatedBase = Date.parse("2025-10-29T09:15:00.000Z");
const participantCreatedStep = 45 * 1000;
const participants = [];
const participantTargets = [];
let totalParticipantSlots = 0;

for (let i = 0; i < PARTICIPANT_COUNT; i += 1) {
  const first = choice(firstNames);
  const last = choice(lastNames);
  const name = `${first} ${last}`;
  const emailSlug = slugifyEmailName(`${first}.${last}`);
  const email = `${emailSlug}+${i + 1}@example.in`;
  const createdAt = new Date(participantCreatedBase + i * participantCreatedStep).toISOString();
  participants.push({
    id: `part_${String(i + 1).padStart(5, "0")}`,
    name,
    email,
    role: "participant",
    password: "demo",
    createdAt
  });
  const target = randomInt(1, 30);
  participantTargets.push(target);
  totalParticipantSlots += target;
}

const minimumSlots = STUDY_COUNT;
if (totalParticipantSlots < minimumSlots) {
  for (let i = 0; i < participantTargets.length && totalParticipantSlots < minimumSlots; i += 1) {
    if (participantTargets[i] < 30) {
      participantTargets[i] += 1;
      totalParticipantSlots += 1;
    }
  }
}

// Researchers
const researcherCreatedBase = Date.parse("2025-10-29T09:30:00.000Z");
const researcherCreatedStep = 2 * 60 * 1000;
const researchers = [];

for (let i = 0; i < RESEARCHER_COUNT; i += 1) {
  const first = choice(firstNames);
  const last = choice(lastNames);
  const prefix = rand() < 0.75 ? "Dr." : "Prof.";
  const name = `${prefix} ${first} ${last}`;
  const emailSlug = slugifyEmailName(`${first}.${last}`);
  const email = `${emailSlug}@example.in`;
  researchers.push({
    id: `res_${String(i + 1).padStart(5, "0")}`,
    name,
    email,
    role: "researcher",
    password: "demo",
    affiliation: choice(affiliations),
    createdAt: new Date(researcherCreatedBase + i * researcherCreatedStep).toISOString()
  });
}

// Permissions
const permissions = [];
let permissionIndex = 1;
for (const [category, concepts] of Object.entries(permissionConcepts)) {
  for (const concept of concepts) {
    for (const { code: freqCode, label: freqLabel } of permissionFrequencies) {
      if (permissions.length >= PERMISSION_COUNT) break;
      const sanitized = concept.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/_+/g, "_");
      const code = `${category.toUpperCase()}_${freqCode}_${sanitized}`;
      const label = `Share ${freqLabel} ${concept}`;
      const description = `Allows the team to review ${concept} on a ${freqLabel} cadence.`;
      const defaultImportance = rand() < 0.23 ? "required" : "optional";
      permissions.push({
        id: `perm_${String(permissionIndex).padStart(4, "0")}`,
        code,
        label: label.replace(/\s+/g, " ").trim(),
        category,
        defaultImportance,
        description
      });
      permissionIndex += 1;
    }
    if (permissions.length >= PERMISSION_COUNT) break;
  }
  if (permissions.length >= PERMISSION_COUNT) break;
}

// Studies
const joinCodes = new Set();
function createJoinCode() {
  while (true) {
    const letters =
      String.fromCharCode(65 + Math.floor(rand() * 26)) +
      String.fromCharCode(65 + Math.floor(rand() * 26)) +
      String.fromCharCode(65 + Math.floor(rand() * 26));
    const digits = String(randomInt(0, 99999)).padStart(5, "0");
    const code = `${letters}-${digits}`;
    if (!joinCodes.has(code)) {
      joinCodes.add(code);
      return code;
    }
  }
}

const studyStart = Date.parse("2025-01-01T00:00:00.000Z");
const studyMid = Date.parse("2025-07-01T00:00:00.000Z");
const studyEnd = Date.parse("2025-10-29T10:10:00.000Z");

const studies = [];
const studyPermissionCountRange = [3, 12];
const permissionIds = permissions.map((perm) => perm.id);

for (let i = 0; i < STUDY_COUNT; i += 1) {
  const adj = choice(studyAdjs);
  const noun = choice(studyNouns);
  const focus = choice(studyFocuses);
  const title = `${adj} ${noun}`;
  const slug = slugify(`${title} ${i + 1}`);
  const researcher = choice(researchers);
  const createdAt = randomDateBetween(studyStart, studyMid);
  const updatedAt = randomDateBetween(Date.parse(createdAt), studyEnd);
  const duration = choice(studyDurations);
  const category = choice(studyCategories);
  const permissionCount = randomInt(studyPermissionCountRange[0], studyPermissionCountRange[1]);
  const selectedPermissionIds = sampleUnique(permissionIds, permissionCount);
  const requiredCount = Math.min(randomInt(1, 3), permissionCount);
  const requiredIndices = new Set();
  while (requiredIndices.size < requiredCount) {
    requiredIndices.add(randomInt(0, selectedPermissionIds.length - 1));
  }
  const permissionsForStudy = selectedPermissionIds.map((permissionId, idx) => ({
    permissionId,
    required: requiredIndices.has(idx)
  }));
  studies.push({
    id: `study_${String(i + 1).padStart(7, "0")}`,
    title,
    slug,
    researcherId: researcher.id,
    joinCode: createJoinCode(),
    category,
    duration,
    shortDescription: `Micro-consent to collect ${focus} insights in a ${duration}.`,
    longDescription:
      `This study explores ${focus} to help teams prototype trustworthy consent experiences and iterate on research loops. ` +
      `Participants contribute targeted signals that power rapid discovery sprints and help researchers close feedback loops responsibly.`,
    permissions: permissionsForStudy,
    createdAt,
    updatedAt
  });
}

// Enrollment assignments
const studyStates = studies.map((study) => ({
  id: study.id,
  participants: new Set()
}));

const participantStates = participants.map((participant, index) => ({
  id: participant.id,
  target: participantTargets[index],
  remaining: participantTargets[index],
  studyIds: new Set()
}));

const participantIndicesWithSlots = participantStates.map((_, index) => index);
for (let studyIndex = 0; studyIndex < studyStates.length; studyIndex += 1) {
  if (!participantIndicesWithSlots.length) {
    throw new Error("Not enough participant slots to cover all studies");
  }
  let assigned = false;
  for (let attempt = 0; attempt < 1000 && !assigned; attempt += 1) {
    const randomIndex = randomInt(0, participantIndicesWithSlots.length - 1);
    const participantIndex = participantIndicesWithSlots[randomIndex];
    const participant = participantStates[participantIndex];
    if (participant.remaining <= 0) {
      removeFromArray(participantIndicesWithSlots, randomIndex);
      continue;
    }
    participant.remaining -= 1;
    participant.studyIds.add(studyStates[studyIndex].id);
    studyStates[studyIndex].participants.add(participant.id);
    if (participant.remaining === 0) {
      removeFromArray(participantIndicesWithSlots, randomIndex);
    }
    assigned = true;
  }
  if (!assigned) {
    throw new Error("Unable to assign baseline participant to study");
  }
}

const studiesWithRoom = [];
for (let i = 0; i < studyStates.length; i += 1) {
  if (studyStates[i].participants.size < 100) {
    studiesWithRoom.push(i);
  }
}

function assignParticipantToStudy(participant) {
  if (participant.remaining <= 0 || !studiesWithRoom.length) {
    return false;
  }
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const idx = randomInt(0, studiesWithRoom.length - 1);
    const studyIndex = studiesWithRoom[idx];
    const studyState = studyStates[studyIndex];
    if (studyState.participants.has(participant.id)) {
      continue;
    }
    studyState.participants.add(participant.id);
    participant.studyIds.add(studyState.id);
    participant.remaining -= 1;
    if (studyState.participants.size >= 100) {
      removeFromArray(studiesWithRoom, idx);
    }
    return true;
  }
  return false;
}

for (const participant of participantStates) {
  while (participant.remaining > 0) {
    const assigned = assignParticipantToStudy(participant);
    if (!assigned) break;
  }
}

const enrollments = [];
const enrollmentStart = Date.parse("2025-05-01T00:00:00.000Z");
const enrollmentEnd = Date.parse("2025-10-28T12:00:00.000Z");
const studyMap = new Map(studies.map((study) => [study.id, study]));

function samplePermissionsForChoices(study) {
  if (!study.permissions.length) return [];
  const maxChoices = Math.min(4, study.permissions.length);
  const choiceCount = randomInt(1, maxChoices);
  const selected = sampleUnique(study.permissions, choiceCount);
  return selected.map((entry) => ({
    permissionId: entry.permissionId,
    granted: entry.required ? true : rand() > 0.2
  }));
}

for (const participant of participantStates) {
  const studyList = Array.from(participant.studyIds);
  studyList.sort();
  for (const studyId of studyList) {
    const study = studyMap.get(studyId);
    const enrolledAt = randomDateBetween(enrollmentStart, enrollmentEnd);
    enrollments.push({
      participantId: participant.id,
      studyId,
      enrolledAt,
      status: "active",
      choices: samplePermissionsForChoices(study),
      currentConsentVersion: randomInt(1, 5)
    });
  }
}

const pastEnrollments = [];
const pastEnrollStart = Date.parse("2024-01-01T00:00:00.000Z");
const pastEnrollMid = Date.parse("2025-03-01T00:00:00.000Z");
const pastEnrollEnd = Date.parse("2025-08-31T23:59:59.000Z");
const allStudyIds = studies.map((study) => study.id);

for (const participant of participantStates) {
  const currentSet = participant.studyIds;
  const pastCount = randomInt(2, 5);
  const pastPicked = new Set();
  for (let i = 0; i < pastCount; i += 1) {
    let chosenStudyId = null;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const candidate = choice(allStudyIds);
      if (currentSet.has(candidate) || pastPicked.has(candidate)) continue;
      chosenStudyId = candidate;
      break;
    }
    if (!chosenStudyId) {
      chosenStudyId = choice(allStudyIds);
    }
    pastPicked.add(chosenStudyId);
    const enrolledAt = randomDateBetween(pastEnrollStart, pastEnrollMid);
    const minRevokedAt = Math.max(Date.parse(enrolledAt) + 7 * 24 * 60 * 60 * 1000, pastEnrollStart);
    const revokedAt = randomDateBetween(minRevokedAt, pastEnrollEnd);
    pastEnrollments.push({
      participantId: participant.id,
      studyId: chosenStudyId,
      enrolledAt,
      revokedAt,
      status: "past",
      finalConsentVersion: randomInt(1, 5)
    });
  }
}

writeJson("participants.json", participants);
writeJson("researchers.json", researchers);
writeJson("permissions.json", permissions);
writeJson("studies.json", studies);
writeJson("enrollments.json", enrollments);
writeJson("past_enrollments.json", pastEnrollments);

const generatorDoc = `# Demo data generator

- participants: ${participants.length}
- researchers: ${researchers.length}
- studies: ${studies.length}
- permissions: ${permissions.length}
- enrollments: ${enrollments.length}
- past enrollments: ${pastEnrollments.length}

Data is generated deterministically with seed 20251102 using scripts/generate-demo-data.js.
`;

fs.writeFileSync(path.join(OUTPUT_DIR, "generator.md"), generatorDoc.trim() + "\n");

console.log("Demo data generated in src/demo");
