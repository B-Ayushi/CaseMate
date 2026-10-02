import bcrypt from 'bcrypt';

export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

// A real hash of a throwaway value, compared against when the email is unknown, so a
// login for a missing account takes as long as one with a wrong password.
let timingHash: Promise<string> | undefined;

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (hash === null) {
    timingHash ??= bcrypt.hash('casemate-timing-equaliser', BCRYPT_COST);
    await bcrypt.compare(password, await timingHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
