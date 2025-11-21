#!/usr/bin/env node

import { faker } from "@faker-js/faker";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOTAL_PARTICIPANTS = 5000;
const TOTAL_RESEARCHERS = 500;
const TOTAL_STUDIES = 10000;
const TOTAL_PERMISSIONS = 200;

const INTEREST_TAGS = [
  "health",
  "wearables",
  "urban-mobility",
  "education",
  "fintech",
  "mental-health",
  "sleep",
  "nutrition",
  "transport",
  "social-media"
];

const STUDY_STATUSES = ["active", "paused", "completed", "archived"];
const STUDY_CATEGORIES = [
  "health",
  "activity",
  "urban-mobility",
  "education",
  "financial",
  "mental-health",
  "nutrition",
  "transport",
  "communication",
  "social-media"
];

const INSTITUTIONS = [
  "IIT Delhi",
  "IIT Bombay",
  "IISc Bengaluru",
  "IIIT Hyderabad",
  "IIT Madras",
  "IIT Kanpur",
  "IIT Kharagpur",
  "Ashoka University",
  "TIFR Mumbai",
  "University of Delhi"
];

const DEPARTMENTS = [
  "Computer Science",
  "Human-Computer Interaction",
  "Behavioral Economics",
  "Public Health",
  "Data Science",
  "Design Research",
  "Urban Planning",
  "Sociology",
  "Psychology",
  "Biomedical Engineering"
];

const DOMAINS = [
  "iitd.ac.in",
  "research.iitb.ac.in",
  "iiscr.ac.in",
  "iiith.ac.in",
  "tifr.res.in",
  "ashoka.edu.in",
  "uni-delhi.ac.in"
];

const FIRST_NAMES = [
  "Aarav",
  "Vihaan",
  "Aditya",
  "Vivaan",
  "Arjun",
  "Sai",
  "Reyansh",
  "Krishna",
  "Ishaan",
  "Shaurya",
  "Pranav",
  "Ananya",
  "Diya",
  "Ira",
  "Aadhya",
  "Pari",
  "Navya",
  "Myra",
  "Aanya",
  "Anaya",
  "Aarohi",
  "Riya",
  "Saanvi",
  "Khushi",
  "Ishita",
  "Kavya",
  "Anika",
  "Prisha",
  "Aashi",
  "Nandini",
  "Mira",
  "Aditi",
  "Apoorva",
  "Rohit",
  "Kabir",
  "Farhan",
  "Devika",
  "Neha",
  "Sanya",
  "Harsh",
  "Irfan",
  "Meera",
  "Pratik",
  "Prerna",
  "Tanvi",
  "Harini",
  "Gaurav",
  "Nikesh",
  "Ishaanvi"
];

const LAST_NAMES = [
  "Sharma",
  "Verma",
  "Patel",
  "Reddy",
  "Menon",
  "Nair",
  "Khan",
  "Gupta",
  "Jain",
  "Kapoor",
  "Mehta",
  "Iyer",
  "Chopra",
  "Bose",
  "Mukherjee",
  "Das",
  "Ghosh",
  "Bhat",
  "Mahajan",
  "Kulkarni",
  "Singh",
  "Yadav",
  "Tripathi",
  "Pandey",
  "Sekhar",
  "Chhabra",
  "Pillai",
  "Dutta",
  "Chawla",
  "Agarwal",
  "Shetty",
  "Bhatt",
  "Gill",
  "Joshi",
  "Mishra",
  "Bansal",
  "Khanna",
  "Basu",
  "Sandhu",
  "Rawat"
];

const PERMISSION_CATEGORIES = [
  "activity",
  "health",
  "location",
  "survey",
  "device",
  "communication",
  "financial",
  "education",
  "demographic",
  "experimental"
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, "../data/demo");

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sample(array) {
  if (!array.length) return null;
  return array[randomInt(0, array.length - 1)];
}

function sampleSize(array, size) {
  if (size >= array.length) {
    return [...array];
  }
  const copy = [...array];
  const result = [];
  while (result.length < size && copy.length) {
    const index = randomInt(0, copy.length - 1);
    result.push(copy.splice(index, 1)[0]);
  }
  return result;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function pad(number, length) {
  return String(number).padStart(length, "0");
}

function chance(probability) {
  return Math.random() < probability;
}

function pickDistinct(values, count) {
  const pool = new Set();
  while (pool.size < count && pool.size < values.length) {
    pool.add(sample(values));
  }
  return Array.from(pool);
}

function randomDateBetween(start, end) {
  const startTime = start.getTime();
  const endTime = end.getTime();
  const value = randomInt(startTime, endTime);
  return new Date(value);
}

function generatePermissionLabel(category, index) {
  const base = {
    activity: "Activity signal",
    health: "Health insight",
    location: "Location viewport",
    survey: "Survey response bundle",
    device: "Device telemetry packet",
    communication: "Communication summary",
    financial: "Financial snapshot",
    education: "Learning progress metric",
    demographic: "Profile detail",
    experimental: "Experimental toggle"
  };
  return `${base[category]} #${index}`;
}

function buildPermissionCatalog() {
  const featured = [
    {
      slug: "share-weekly-activity",
      label: "Share weekly activity summary",
      description: "Allows the study to view normalized weekly step/fitness data.",
      category: "activity",
      defaultLevel: "optional"
    },
    {
      slug: "share-sleep-insights",
      label: "Share sleep stage insights",
      description: "Provides nightly sleep stage aggregates from wearables.",
      category: "health",
      defaultLevel: "optional"
    },
    {
      slug: "allow-heart-rate-stream",
      label: "Allow live heart rate stream",
      description: "Streams minute-level heart rate during study periods.",
      category: "health",
      defaultLevel: "required"
    },
    {
      slug: "share-monthly-diary",
      label: "Share monthly sentiment diary",
      description: "Collects a short monthly reflection about study experience.",
      category: "survey",
      defaultLevel: "optional"
    },
    {
      slug: "share-location-blurred",
      label: "Share blurred location trail",
      description: "Shares city-level location traces with 3km fuzzing.",
      category: "location",
      defaultLevel: "optional"
    },
    {
      slug: "allow-email-followup",
      label: "Allow email follow-up",
      description: "Permits researchers to email you for clarifications.",
      category: "communication",
      defaultLevel: "required"
    },
    {
      slug: "share-transaction-roundups",
      label: "Share transaction round-ups",
      description: "Provides anonymized rounding of wallet transactions.",
      category: "financial",
      defaultLevel: "optional"
    },
    {
      slug: "share-learning-summaries",
      label: "Share learning platform summaries",
      description: "Imports weekly learning progress from connected accounts.",
      category: "education",
      defaultLevel: "optional"
    },
    {
      slug: "share-demographic-profile",
      label: "Share extended demographic profile",
      description: "Includes age range, occupation, and household information.",
      category: "demographic",
      defaultLevel: "required"
    },
    {
      slug: "enable-experimental-reminders",
      label: "Enable experimental reminders",
      description: "Sends nudges designed to test different reminder styles.",
      category: "experimental",
      defaultLevel: "optional"
    },
    {
      slug: "share-health-diagnostics",
      label: "Share health diagnostics bundle",
      description: "Includes blood pressure, glucose, and other readings.",
      category: "health",
      defaultLevel: "optional"
    },
    {
      slug: "share-raw-step-data",
      label: "Share raw step data",
      description: "Provides minute-level step counts for precise analysis.",
      category: "activity",
      defaultLevel: "required"
    },
    {
      slug: "share-commute-patterns",
      label: "Share commute patterns",
      description: "Tracks daily commute start/end without exact addresses.",
      category: "transport",
      defaultLevel: "optional"
    },
    {
      slug: "enable-voice-snippets",
      label: "Enable 30-second voice snippets",
      description: "Collects short audio notes about your daily experience.",
      category: "communication",
      defaultLevel: "optional"
    },
    {
      slug: "share-wellbeing-checkins",
      label: "Share weekly wellbeing check-ins",
      description: "Asks for a short 3-question wellbeing check-in each week.",
      category: "mental-health",
      defaultLevel: "optional"
    },
    {
      slug: "share-nutrition-journal",
      label: "Share nutrition journal photos",
      description: "Uploads meal photos for dietary pattern reviews.",
      category: "nutrition",
      defaultLevel: "optional"
    },
    {
      slug: "allow-phone-interviews",
      label: "Allow scheduled phone interviews",
      description: "Lets the researcher schedule brief follow-up calls.",
      category: "communication",
      defaultLevel: "required"
    },
    {
      slug: "share-education-feedback",
      label: "Share course feedback snippets",
      description: "Collects short feedback about learning experiences.",
      category: "education",
      defaultLevel: "optional"
    },
    {
      slug: "share-urban-sensors",
      label: "Share air quality sensor readings",
      description: "Uploads particulate matter and humidity readings.",
      category: "experimental",
      defaultLevel: "optional"
    },
    {
      slug: "share-ride-history",
      label: "Share ride booking history",
      description: "Aggregates number and duration of weekly ride bookings.",
      category: "transport",
      defaultLevel: "optional"
    },
    {
      slug: "share-social-usage",
      label: "Share social app usage summary",
      description: "Captures total time spent on selected social apps.",
      category: "social-media",
      defaultLevel: "optional"
    },
    {
      slug: "share-mental-health-journal",
      label: "Share mental health journal entries",
      description: "Provides anonymized text snippets from daily journals.",
      category: "mental-health",
      defaultLevel: "required"
    },
    {
      slug: "share-spending-alerts",
      label: "Share spending pattern alerts",
      description: "Gives weekly summaries of spending category shifts.",
      category: "financial",
      defaultLevel: "optional"
    },
    {
      slug: "share-device-sensor-fusion",
      label: "Share device sensor fusion data",
      description: "Combines accelerometer and gyroscope data for posture.",
      category: "device",
      defaultLevel: "optional"
    },
    {
      slug: "share-live-location",
      label: "Share precise live location",
      description: "Streams real-time location within 100 meters accuracy.",
      category: "location",
      defaultLevel: "required"
    }
  ];

  const permissions = [];
  let permIndex = 1;

  featured.forEach((perm) => {
    permissions.push({
      id: `perm_${pad(permIndex, 4)}`,
      slug: perm.slug,
      label: perm.label,
      description: perm.description,
      category: perm.category,
      defaultLevel: perm.defaultLevel
    });
    permIndex += 1;
  });

  const remaining = TOTAL_PERMISSIONS - permissions.length;
  const requiredTarget = Math.floor(TOTAL_PERMISSIONS * 0.2);
  let requiredCount = permissions.filter((p) => p.defaultLevel === "required").length;

  for (let i = 0; i < remaining; i += 1) {
    const category = PERMISSION_CATEGORIES[i % PERMISSION_CATEGORIES.length];
    const label = generatePermissionLabel(category, i + 1);
    const defaultLevel =
      requiredCount < requiredTarget && chance(0.25) ? "required" : "optional";
    if (defaultLevel === "required") {
      requiredCount += 1;
    }
    permissions.push({
      id: `perm_${pad(permIndex, 4)}`,
      slug: slugify(label),
      label,
      description: faker.lorem.sentence(),
      category,
      defaultLevel
    });
    permIndex += 1;
  }

  return permissions;
}

function createPerson(seed = null) {
  if (seed) {
    faker.seed(seed);
  }
  const first = sample(FIRST_NAMES);
  const last = sample(LAST_NAMES);
  const name = `${first} ${last}`;
  const handle = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
  const suffix = randomInt(1, 99);
  const email = `${handle}${suffix.toString().padStart(2, "0")}@${sample(DOMAINS)}`;
  return { name, email, first, last };
}

function buildResearchers(totalStudiesTarget) {
  const researchers = [];
  const studyCounts = new Array(TOTAL_RESEARCHERS).fill(1);
  let remaining = totalStudiesTarget - TOTAL_RESEARCHERS;

  while (remaining > 0) {
    for (let i = 0; i < studyCounts.length && remaining > 0; i += 1) {
      const current = studyCounts[i];
      if (current >= 200) continue;
      const allotment = Math.min(remaining, randomInt(0, Math.min(12, 200 - current)));
      studyCounts[i] += allotment;
      remaining -= allotment;
    }
  }

  for (let i = 0; i < TOTAL_RESEARCHERS; i += 1) {
    const { name, email } = createPerson();
    researchers.push({
      id: `r_${pad(i + 1, 4)}`,
      name: `Dr. ${name}`,
      email,
      institution: sample(INSTITUTIONS),
      department: sample(DEPARTMENTS),
      city: faker.location.city(),
      country: "India",
      studyIds: []
    });
  }

  return { researchers, studyCounts };
}

function generateStudyCode() {
  const parts = [
    faker.word.sample({ length: { min: 3, max: 6 } }).toUpperCase(),
    faker.string.alphanumeric({ length: 4, casing: "upper" })
  ];
  if (chance(0.25)) {
    parts.splice(1, 0, faker.word.sample({ length: { min: 3, max: 8 } }).toUpperCase());
  }
  return parts.join("-");
}

function buildStudies(researchers, studyCounts, permissions) {
  const permissionIds = permissions.map((p) => p.id);
  const studies = [];
  const researcherQueues = researchers.map((_, idx) => studyCounts[idx]);
  let studyIndex = 1;

  const aiPool = [
    "Most participants allowed wearable sharing but skipped exact location.",
    "Participants usually consent to monthly diary if the study is under three months.",
    "Roughly 65% of participants opt-in to heart rate streams during weekdays.",
    "Many participants enable reminders after seeing the default summary.",
    "Participants often deny precise location yet allow blurred commute data.",
    "Most participants review versions again when a required permission changes.",
    "A short preview of the consent helps participants feel more confident."
  ];

  for (let rIdx = 0; rIdx < researchers.length; rIdx += 1) {
    const researcher = researchers[rIdx];
    const quota = researcherQueues[rIdx];
    for (let c = 0; c < quota; c += 1) {
      if (studyIndex > TOTAL_STUDIES) break;
      const id = `s_${pad(studyIndex, 5)}`;
      const category = sample(STUDY_CATEGORIES);
      const baseTags = sampleSize(INTEREST_TAGS, randomInt(2, 4));
      const finalPermissionCount = randomInt(3, 120);
      const selectedPermissions = sampleSize(permissionIds, finalPermissionCount);

      const permissionsExpanded = selectedPermissions.map((permId) => {
        const perm = permissions.find((p) => p.id === permId);
        const level =
          perm.defaultLevel === "required"
            ? "required"
            : chance(0.2)
            ? "required"
            : "optional";
        return { permId, level };
      });

      const numVersions = randomInt(1, 6);
      const versions = [];

      let currentSet = new Set(sampleSize(selectedPermissions, Math.max(3, Math.floor(finalPermissionCount * 0.6))));
      const baseDate = faker.date.recent({ days: 700 });
      for (let v = 0; v < numVersions; v += 1) {
        const versionNumber = v + 1;
        if (v === numVersions - 1) {
          currentSet = new Set(selectedPermissions);
        } else {
          const availableToAdd = selectedPermissions.filter((id) => !currentSet.has(id));
          if (availableToAdd.length && chance(0.6)) {
            const additions = sampleSize(
              availableToAdd,
              randomInt(1, Math.min(3, availableToAdd.length))
            );
            additions.forEach((permId) => currentSet.add(permId));
          }
          if (currentSet.size > 3 && chance(0.35)) {
            const removable = Array.from(currentSet);
            const removals = sampleSize(
              removable,
              randomInt(1, Math.min(2, removable.length - 1))
            );
            removals.forEach((permId) => currentSet.delete(permId));
          }
        }

        versions.push({
          version: versionNumber,
          label:
            versionNumber === 1
              ? "Initial consent"
              : faker.helpers.arrayElement([
                  "Policy update",
                  "Added diary entry",
                  "Clarified retention",
                  "Adjusted reminders",
                  "Refined data scope"
                ]),
          createdAt: new Date(
            baseDate.getTime() + v * 1000 * 60 * 60 * 24 * randomInt(12, 45)
          ).toISOString(),
          permissionIds: Array.from(currentSet)
        });
      }

      const status =
        versions.length > 1 && chance(0.1)
          ? "paused"
          : chance(0.15)
          ? "completed"
          : "active";

      const descriptionParagraphs = Array.from(
        { length: randomInt(2, 3) },
        () => faker.lorem.paragraph()
      ).join("\n\n");

      const study = {
        id,
        code: generateStudyCode(),
        title: faker.company.catchPhrase(),
        summary: `${faker.commerce.productAdjective()} • ${faker.number.int({ min: 5, max: 20 })} min review`,
        description: descriptionParagraphs,
        ownerId: researcher.id,
        category,
        tags: baseTags,
        status,
        permissions: permissionsExpanded,
        participants: [],
        versions,
        aiResponses: sampleSize(aiPool, randomInt(2, 3))
      };

      studies.push(study);
      researcher.studyIds.push(id);
      studyIndex += 1;
    }
  }

  return studies.slice(0, TOTAL_STUDIES);
}

function distributeParticipants(studies) {
  return studies.map(() => randomInt(1, 100));
}

function buildParticipants(studies, permissions) {
  const participants = [];
  const studyMap = new Map(studies.map((study) => [study.id, study]));
  const activeStudies = studies.filter((study) => study.status === "active");
  const activeIds = activeStudies.map((study) => study.id);
  const capacity = distributeParticipants(studies);
  const studyParticipantCounts = new Array(studies.length).fill(0);
  const studyIdxMap = new Map(studies.map((study, idx) => [study.id, idx]));

  const startDate = new Date("2023-07-01T00:00:00.000Z");
  const endDate = new Date();

  function attachParticipantToStudy(studyId, participantEntry) {
    const study = studyMap.get(studyId);
    if (!study) return false;
    const idx = studyIdxMap.get(studyId);
    if (studyParticipantCounts[idx] >= capacity[idx]) return false;
    study.participants.push({
      participantId: participantEntry.participantId,
      status: participantEntry.status,
      consentVersion: participantEntry.consentVersion,
      joinedAt: participantEntry.joinedAt,
      leftAt: participantEntry.leftAt || null
    });
    studyParticipantCounts[idx] += 1;
    return true;
  }

  for (let i = 0; i < TOTAL_PARTICIPANTS; i += 1) {
    const id = `p_${pad(i + 1, 7)}`;
    const { name, email } = createPerson();
    const interests = sampleSize(INTEREST_TAGS, randomInt(1, 3));
    const enrolledEntries = [];
    const pastEntries = [];

    const desiredEnrolled = faker.helpers.weightedArrayElement([
      { weight: 2, value: 0 },
      { weight: 6, value: 1 },
      { weight: 5, value: 2 },
      { weight: 4, value: 3 },
      { weight: 3, value: 4 },
      { weight: 1, value: 5 },
      { weight: 1, value: 6 },
      { weight: 1, value: 7 }
    ]);

    const desiredPast =
      faker.helpers.weightedArrayElement([
        { weight: 1, value: 0 },
        { weight: 5, value: 1 },
        { weight: 4, value: 2 },
        { weight: 3, value: 3 },
        { weight: 2, value: 4 },
        { weight: 1, value: 5 }
      ]) || 1;

    const shuffledActive = faker.helpers.shuffle(activeIds);
    for (let e = 0; e < desiredEnrolled; e += 1) {
      const studyId = shuffledActive[e];
      if (!studyId) break;
      const study = studyMap.get(studyId);
      const version = sample(study.versions) || study.versions[0];
      const joinedAt = randomDateBetween(startDate, endDate);
      const participantEntry = {
        participantId: id,
        status: "enrolled",
        consentVersion: version.version,
        joinedAt: joinedAt.toISOString(),
        leftAt: null
      };
      if (attachParticipantToStudy(studyId, participantEntry)) {
        enrolledEntries.push({
          studyId,
          status: "enrolled",
          consentVersion: version.version,
          joinedAt: participantEntry.joinedAt,
          lastUpdatedAt: randomDateBetween(joinedAt, endDate).toISOString()
        });
      }
    }

    const shuffledAll = faker.helpers.shuffle(studies.map((s) => s.id));
    let ensuredPast = false;
    for (let p = 0; p < desiredPast || !ensuredPast; p += 1) {
      const studyId = shuffledAll[p];
      if (!studyId) break;
      if (enrolledEntries.some((entry) => entry.studyId === studyId)) {
        continue;
      }
      const study = studyMap.get(studyId);
      if (!study) continue;
      const version = sample(study.versions) || study.versions[0];
      const joinedAt = randomDateBetween(startDate, endDate);
      const leftAt = randomDateBetween(joinedAt, endDate);
      const status = chance(0.4)
        ? "researcher-closed"
        : chance(0.3)
        ? "left"
        : chance(0.2)
        ? "expired"
        : "withdrawn";
      const participantEntry = {
        participantId: id,
        status: status === "left" ? "left" : "past",
        consentVersion: version.version,
        joinedAt: joinedAt.toISOString(),
        leftAt: leftAt.toISOString()
      };
      if (attachParticipantToStudy(studyId, participantEntry)) {
        pastEntries.push({
          studyId,
          status,
          leftAt: leftAt.toISOString(),
          lastConsentVersion: version.version
        });
        ensuredPast = true;
      }
    }

    const participant = {
      id,
      name,
      email,
      role: "participant",
      enrolled: enrolledEntries,
      past: pastEntries,
      interests
    };
    participants.push(participant);
  }

  // Ensure every study has at least one participant.
  studies.forEach((study) => {
    if (study.participants.length === 0) {
      const participant = sample(participants);
      const version = sample(study.versions) || study.versions[0];
      const joinedAt = faker.date.between({
        from: new Date("2023-07-01T00:00:00.000Z"),
        to: new Date()
      });
      study.participants.push({
        participantId: participant.id,
        status: "enrolled",
        consentVersion: version.version,
        joinedAt: joinedAt.toISOString(),
        leftAt: null
      });
      participant.enrolled.push({
        studyId: study.id,
        status: "enrolled",
        consentVersion: version.version,
        joinedAt: joinedAt.toISOString(),
        lastUpdatedAt: new Date(
          joinedAt.getTime() + randomInt(2, 60) * 86400000
        ).toISOString()
      });
    }
  });

  return participants;
}

function writeJson(filename, data) {
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
  console.log(`✔ wrote ${filename}`);
}

function main() {
  console.log("Generating demo data...");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const permissions = buildPermissionCatalog();
  const { researchers, studyCounts } = buildResearchers(TOTAL_STUDIES);
  const studies = buildStudies(researchers, studyCounts, permissions);
  const participants = buildParticipants(studies, permissions);

  writeJson("permissions.json", permissions);
  writeJson("researchers.json", researchers);
  writeJson("studies.json", studies);
  writeJson("participants.json", participants);

  console.log("Demo data generation complete.");
}

main();
