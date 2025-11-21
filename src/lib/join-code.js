import crypto from "node:crypto";
import { prisma } from "./prisma.js";

const SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const randomChar = () => {
  const index = crypto.randomInt(0, SAFE_ALPHABET.length);
  return SAFE_ALPHABET[index];
};

const randomCode = (length) => {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += randomChar();
  }
  return code;
};

export async function generateJoinCode({ len = 6, client = prisma } = {}) {
  if (!client?.study) {
    throw new Error("Prisma client required to generate join codes");
  }
  const length = Math.max(4, Math.min(12, Number(len) || 6));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const joinCode = randomCode(length);
    const existing = await client.study.findUnique({ where: { joinCode } });
    if (!existing) return joinCode;
  }
  throw new Error("Unable to allocate join code");
}
