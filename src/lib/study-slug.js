import { prisma } from "./prisma.js";
import { slugify } from "./strings.js";

const baseSlug = (title) => slugify(title || "study").slice(0, 48) || "study";

export async function generateUniqueSlug(title, { client = prisma } = {}) {
  if (!client?.study) {
    throw new Error("Prisma client required to allocate slug");
  }
  const root = baseSlug(title);
  let candidate = root;
  let attempt = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await client.study.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    attempt += 1;
    candidate = `${root}-${attempt}`.slice(0, 60);
  }
}
