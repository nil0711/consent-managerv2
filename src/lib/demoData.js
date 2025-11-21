import {
  participants,
  researchers,
  studies,
  permissions,
  enrollments,
  pastEnrollments,
  byEmail,
  participantsById,
  researchersById,
  studiesById,
  studiesBySlug,
  studiesByJoinCode,
  enrollmentsByParticipant,
  enrollmentsByStudy,
  pastByParticipant
} from "../demo/dataStore.js";

function getUserByEmail(email) {
  if (!email) return null;
  return byEmail.get(email.trim().toLowerCase()) || null;
}

function getParticipantById(id) {
  if (!id) return null;
  return participantsById.get(id) || null;
}

function getStudyById(identifier) {
  if (!identifier) return null;
  const key = identifier.toString().trim().toLowerCase();
  return (
    studiesById.get(key) ||
    studiesBySlug.get(key) ||
    studiesByJoinCode.get(key) ||
    null
  );
}

function buildStudySummary(study) {
  if (!study) return null;
  const ownerId = study.ownerId || study.researcherId;
  const researcher = ownerId ? researchersById.get(ownerId) : null;
  const enrolledCount = (enrollmentsByStudy.get(study.id) || []).length;
  return {
    id: study.id,
    slug: study.slug,
    title: study.title,
    summary: study.shortDescription || study.longDescription || "",
    duration: study.duration,
    tags: study.category ? [study.category] : [],
    participants: enrolledCount,
    researcher: researcher
      ? {
          id: researcher.id,
          name: researcher.name,
          affiliation: researcher.affiliation,
          studyIds: studies
            .filter((item) => (item.ownerId || item.researcherId) === researcher.id)
            .map((item) => item.id)
        }
      : null
  };
}

function listParticipantEnrolled(participantId) {
  const records = enrollmentsByParticipant.get(participantId) || [];
  return records.map((record) => {
    const study = getStudyById(record.studyId);
    return {
      studyId: record.studyId,
      status: record.status || "active",
      consentVersion: record.currentConsentVersion ?? record.consentVersion ?? 1,
      joinedAt: record.enrolledAt,
      lastUpdatedAt: record.updatedAt || record.enrolledAt,
      choices: record.choices || [],
      study: buildStudySummary(study)
    };
  });
}

function listParticipantPast(participantId) {
  const records = pastByParticipant.get(participantId) || [];
  return records.map((record) => {
    const study = getStudyById(record.studyId);
    return {
      studyId: record.studyId,
      status: record.status || "past",
      leftAt: record.revokedAt,
      lastConsentVersion: record.finalConsentVersion ?? record.lastConsentVersion ?? 1,
      study: buildStudySummary(study)
    };
  });
}

function getParticipantInterests(participantId) {
  const interests = new Set();
  const collect = (studyId) => {
    const study = getStudyById(studyId);
    if (study?.category) interests.add(study.category);
  };
  (enrollmentsByParticipant.get(participantId) || []).forEach((entry) => collect(entry.studyId));
  (pastByParticipant.get(participantId) || []).forEach((entry) => collect(entry.studyId));
  return Array.from(interests);
}

function searchStudies(query, limit = 20) {
  if (!query) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = [];
  for (const study of studies) {
    if (
      study.title.toLowerCase().includes(q) ||
      (study.slug && study.slug.toLowerCase().includes(q)) ||
      (study.category && study.category.toLowerCase().includes(q)) ||
      (study.shortDescription && study.shortDescription.toLowerCase().includes(q)) ||
      (study.joinCode && study.joinCode.toLowerCase().includes(q))
    ) {
      matches.push(study);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

function getRecommendedStudiesForParticipant(participantId, limit = 10) {
  const interests = new Set(getParticipantInterests(participantId));
  const enrolledIds = new Set((enrollmentsByParticipant.get(participantId) || []).map((entry) => entry.studyId));
  const recommendations = [];
  for (const study of studies) {
    if (enrolledIds.has(study.id)) continue;
    if (interests.size === 0 || interests.has(study.category)) {
      recommendations.push(study);
    }
    if (recommendations.length >= limit) break;
  }
  return recommendations;
}

function getRecommended(participantId, limit = 10) {
  return getRecommendedStudiesForParticipant(participantId, limit).map((study) => buildStudySummary(study));
}

function getTrendingSummaries(limit = 6) {
  const scored = studies.map((study) => ({
    study,
    score: (enrollmentsByStudy.get(study.id) || []).length,
    updatedAt: study.updatedAt || study.createdAt || ""
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
  return scored.slice(0, limit).map(({ study, score }) => ({
    slug: study.slug,
    title: study.title,
    summary: study.shortDescription || study.longDescription || "",
    status: "public",
    score
  }));
}

function createChoicesForStudy(study) {
  return (study.permissions || []).slice(0, 4).map((permission) => ({
    permissionId: permission.permissionId,
    granted: permission.required ? true : Math.random() > 0.25
  }));
}

function enrollParticipantInStudy(participantId, identifier) {
  const participant = getParticipantById(participantId);
  if (!participant) return { ok: false, error: "Participant not found." };
  const study = getStudyById(identifier);
  if (!study) return { ok: false, error: "Study not found." };
  const existing = enrollmentsByParticipant.get(participantId) || [];
  if (existing.some((entry) => entry.studyId === study.id)) {
    return { ok: false, error: "Already enrolled." };
  }
  const enrolledAt = new Date().toISOString();
  const record = {
    participantId,
    studyId: study.id,
    enrolledAt,
    status: "active",
    choices: createChoicesForStudy(study),
    currentConsentVersion: 1,
    updatedAt: enrolledAt
  };
  enrollments.push(record);
  existing.push(record);
  enrollmentsByParticipant.set(participantId, existing);
  let studyEntries = enrollmentsByStudy.get(study.id);
  if (!studyEntries) {
    studyEntries = [];
    enrollmentsByStudy.set(study.id, studyEntries);
  }
  studyEntries.push(record);
  return { ok: true, study };
}

function unenrollParticipantFromStudy(participantId, identifier) {
  const study = getStudyById(identifier);
  if (!study) return { ok: false, error: "Study not found." };
  const records = enrollmentsByParticipant.get(participantId);
  if (!records || !records.length) return { ok: false, error: "Not enrolled." };
  const index = records.findIndex((entry) => entry.studyId === study.id);
  if (index === -1) return { ok: false, error: "Not enrolled." };
  const [record] = records.splice(index, 1);
  const globalIndex = enrollments.findIndex(
    (entry) => entry.participantId === participantId && entry.studyId === study.id
  );
  if (globalIndex !== -1) {
    enrollments.splice(globalIndex, 1);
  }
  const studyEntries = enrollmentsByStudy.get(study.id);
  if (studyEntries) {
    const studyIdx = studyEntries.findIndex((entry) => entry.participantId === participantId);
    if (studyIdx !== -1) {
      studyEntries.splice(studyIdx, 1);
    }
  }
  const pastRecord = {
    participantId,
    studyId: study.id,
    enrolledAt: record.enrolledAt,
    revokedAt: new Date().toISOString(),
    status: "past",
    finalConsentVersion: record.currentConsentVersion ?? 1
  };
  pastEnrollments.push(pastRecord);
  const pastList = pastByParticipant.get(participantId) || [];
  pastList.push(pastRecord);
  pastByParticipant.set(participantId, pastList);
  return { ok: true };
}

const participantUsers = participants;

export {
  participants,
  researchers,
  studies,
  permissions,
  participantUsers,
  getUserByEmail,
  getParticipantById,
  getParticipantInterests,
  buildStudySummary,
  listParticipantEnrolled,
  listParticipantPast,
  getStudyById,
  searchStudies,
  getRecommended,
  getRecommendedStudiesForParticipant,
  getTrendingSummaries,
  enrollParticipantInStudy,
  unenrollParticipantFromStudy
};
