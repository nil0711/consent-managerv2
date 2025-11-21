import { getTrendingOrder } from "../services/trending.js";

export const TRENDING_FIRST_PAGE = 10;
const TRENDING_MAX_SEEN = 100;

const getCacheContainer = (req) => {
  if (!req.session.trendingCache) req.session.trendingCache = {};
  return req.session.trendingCache;
};

const getCacheKey = (role, userId) => `${role}:${userId}`;

export const toSeenSet = (value) =>
  value instanceof Set ? value : new Set(Array.isArray(value) ? value : []);

export const updateSeenSession = (req, seenSet) => {
  req.session.trendingSeen = [...seenSet].slice(-TRENDING_MAX_SEEN);
};

export async function ensureTrendingOrder(
  req,
  userId,
  role,
  seenSet,
  options = {}
) {
  const cache = getCacheContainer(req);
  const key = getCacheKey(role, userId);
  let entry = cache[key];
  if (options.force || !entry || !Array.isArray(entry.items)) {
    const ranked = await getTrendingOrder(userId, role, new Set(seenSet));
    entry = { items: ranked };
    cache[key] = entry;
  }
  req.session.trendingCache = cache;
  return entry.items;
}
