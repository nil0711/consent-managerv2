import usersData from "./users.json" assert { type: "json" };
import researchersData from "./researchers.json" assert { type: "json" };
import studiesData from "./studies.json" assert { type: "json" };
import permissionsData from "./permissions-master.json" assert { type: "json" };

const users = [...usersData];
const researchers = [...researchersData];
const studies = [...studiesData];
const permissions = [...permissionsData];

const userMap = new Map(users.map((user) => [user.id, user]));
const researcherMap = new Map(researchers.map((researcher) => [researcher.id, researcher]));
const usersByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
const participantUsers = users.filter((user) => user.role === "participant");
const participantIds = participantUsers.map((user) => user.id);

function randomDateWithinPastMonths(months = 12) {
  const now = Date.now();
  const past = now - months * 30 * 24 * 60 * 60 * 1000;
  const timestamp = past + Math.random() * (now - past);
  return new Date(timestamp).toISOString();
}

const enrollmentMap = new Map();
const pastMap = new Map();
const interestMap = new Map();

for (const participantId of participantIds) {
  enrollmentMap.set(participantId, []);
  pastMap.set(participantId, []);
  interestMap.set(participantId, new Set());
}

for (const study of studies) {
  const tags = Array.isArray(study.tags) ? study.tags : [];
  for (const participantId of study.participantIds || []) {
    if (!enrollmentMap.has(participantId)) continue;
    const record = {
      studyId: study.id,
      status: "enrolled",
      consentVersion: 1,
      joinedAt: randomDateWithinPastMonths(9),
      lastUpdatedAt: randomDateWithinPastMonths(3)
    };
    enrollmentMap.get(participantId).push(record);
    const interests = interestMap.get(participantId);
    tags.forEach((tag) => interests.add(tag));
  }
}

const pastStatuses = ["researcher-closed", "expired", "withdrawn"];

for (const participantId of participantIds) {
  const enrolledRecords = enrollmentMap.get(participantId) || [];
  const interests = interestMap.get(participantId);
  const enrolledIds = new Set(enrolledRecords.map((record) => record.studyId));
  const pool = studies.filter((study) => !enrolledIds.has(study.id));
  const desiredPast = Math.max(1, Math.floor(Math.random() * 3));
  for (let i = 0; i < desiredPast && pool.length; i += 1) {
    const index = Math.floor(Math.random() * pool.length);
    const study = pool.splice(index, 1)[0];
    pastMap.get(participantId).push({
      studyId: study.id,
      status: pastStatuses[i % pastStatuses.length],
      leftAt: randomDateWithinPastMonths(18),
      lastConsentVersion: 1
    });
    (study.tags || []).forEach((tag) => interests.add(tag));
  }
}

function getUserByEmail(email) {
  if (!email) return null;
  return usersByEmail.get(email.toLowerCase()) || null;
}

function addUser({ name, email, role }) {
  const idPrefix = role === "researcher" ? "r-" : "u-part-";
  const width = role === "researcher" ? 4 : 4;
  let candidate = `${idPrefix}${String(users.length + 1).padStart(width, "0")}`;
  while (userMap.has(candidate)) {
    candidate = `${idPrefix}${String(Math.floor(Math.random() * 100000)).padStart(width, "0")}`;
  }
  const user = { id: candidate, name, email, role, password: "demo" };
  users.push(user);
  userMap.set(user.id, user);
  usersByEmail.set(email.toLowerCase(), user);
  if (role === "participant") {
    participantUsers.push(user);
    enrollmentMap.set(user.id, []);
    pastMap.set(user.id, []);
    interestMap.set(user.id, new Set());
  }
  return user;
}

function getParticipantById(id) {
  return userMap.get(id) || null;
}

function getParticipantEnrolled(id) {
  return enrollmentMap.get(id) || [];
}

function getParticipantPast(id) {
  return pastMap.get(id) || [];
}

function getParticipantInterests(id) {
  return Array.from(interestMap.get(id) || []);
}

function getStudyById(idOrSlug) {
  if (!idOrSlug) return null;
  const lower = idOrSlug.toLowerCase();
  return (
    studies.find((study) => study.id.toLowerCase() === lower || study.slug.toLowerCase() === lower) ||
    null
  );
}

function searchStudies(query, limit = 20) {
  if (!query) return [];
  const q = query.toLowerCase();
  const results = [];
  for (const study of studies) {
    if (
      study.title.toLowerCase().includes(q) ||
      study.slug.toLowerCase().includes(q) ||
      (study.tags || []).some((tag) => tag.toLowerCase().includes(q))
    ) {
      results.push(study);
      if (results.length >= limit) break;
    }
  }
  return results;
}

function getRecommendedStudiesForParticipant(id, limit = 10) {
  const interests = new Set(getParticipantInterests(id));
  const enrolledIds = new Set((enrollmentMap.get(id) || []).map((record) => record.studyId));
  const recommended = [];
  for (const study of studies) {
    if (enrolledIds.has(study.id)) continue;
    if (interests.size === 0 || (study.tags || []).some((tag) => interests.has(tag))) {
      recommended.push(study);
      if (recommended.length >= limit) break;
    }
  }
  return recommended;
}

function enrollParticipantInStudy(participantId, studyId) {
  const study = getStudyById(studyId);
  if (!study) return { ok: false, error: "Study not found." };
  if (!enrollmentMap.has(participantId)) return { ok: false, error: "Participant not found." };
  if (!study.participantIds.includes(participantId)) {
    study.participantIds.push(participantId);
  }
  const enrolled = enrollmentMap.get(participantId);
  const already = enrolled.find((record) => record.studyId === study.id);
  if (already) {
    return { ok: false, error: "Already enrolled." };
  }
  const record = {
    studyId: study.id,
    status: "enrolled",
    consentVersion: 1,
    joinedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString()
  };
  enrolled.push(record);
  const interests = interestMap.get(participantId);
  (study.tags || []).forEach((tag) => interests.add(tag));
  return { ok: true, study };
}

function unenrollParticipantFromStudy(participantId, studyId) {
  const study = getStudyById(studyId);
  if (!study) return { ok: false, error: "Study not found." };
  if (!enrollmentMap.has(participantId)) return { ok: false, error: "Participant not found." };
  study.participantIds = study.participantIds.filter((id) => id !== participantId);
  const enrolled = enrollmentMap.get(participantId);
  const index = enrolled.findIndex((record) => record.studyId === studyId);
  if (index === -1) {
    return { ok: false, error: "Not enrolled." };
  }
  const [record] = enrolled.splice(index, 1);
  const past = pastMap.get(participantId);
  past.push({
    studyId,
    status: "left",
    leftAt: new Date().toISOString(),
    lastConsentVersion: record.consentVersion
  });
  return { ok: true };
}

export {
  users,
  researchers,
  studies,
  permissions,
  participantUsers,
  getUserByEmail,
  addUser,
  getParticipantById,
  getParticipantEnrolled,
  getParticipantPast,
  getParticipantInterests,
  getStudyById,
  searchStudies,
  getRecommendedStudiesForParticipant,
  enrollParticipantInStudy,
  unenrollParticipantFromStudy
};
