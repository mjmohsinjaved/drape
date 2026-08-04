import { argon2id, hash } from 'argon2';

import { Locale, Role, UserStatus } from '@library/common';

import { validateSeedEnv } from '@api/config/env.validation';
import { User } from '@api/modules/users/entities/user.entity';

import {
  readSeedInteger,
  requireSeedEnv,
  type SeedContext,
  type SeedOutcome,
  type Seeder,
} from './seeder.contract';

/**
 * PRD E-4 — "a seed script creates the first Admin".
 *
 * There is exactly one way an ADMIN account comes into existence for a fresh
 * installation: this seeder, reading `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` /
 * `SEED_ADMIN_NAME` from the environment. Every later admin arrives by invitation from
 * an existing one (S-5), and `/signup` has no code path that can produce
 * `role = ADMIN` (S-4).
 *
 * **There is no default account, and there never will be.** If the variables are unset
 * this seeder throws and the whole run aborts. A well-known seeded admin with a
 * guessable password is the single most common way a project of this shape gets
 * compromised, and PRD E-2 forbids it outright.
 */

/** Minimum length for the seeded admin password. Deliberately above the signup floor. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Values that are obviously a placeholder rather than a chosen password. Rejecting them
 * is not security theatre — it is the difference between "the operator filled the
 * template in" and "the operator ran the template".
 */
const REJECTED_PASSWORDS: readonly string[] = [
  'password',
  'password123',
  'changeme',
  'change_me',
  'admin',
  'admin123',
  'drape',
  'drape123',
  'letmein',
  'secret',
  '<<<required>>>',
];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const adminSeeder: Seeder = {
  name: 'admin',

  async run(context: SeedContext): Promise<SeedOutcome> {
    // Reports all three missing variables at once rather than one per run (§7 `✔ (seed)`).
    // `requireSeedEnv` below is the second line of defence, and the one that names the file
    // to fix; both refuse to invent a value.
    validateSeedEnv(context.env);

    const email = normaliseEmail(requireSeedEnv(context.env, 'SEED_ADMIN_EMAIL'));
    const password = requireSeedEnv(context.env, 'SEED_ADMIN_PASSWORD');
    const name = requireSeedEnv(context.env, 'SEED_ADMIN_NAME');

    assertEmailShape(email);
    assertPasswordAcceptable(password);

    const repository = context.manager.getRepository(User);

    // `UQ_users_email` is UNIQUE (lower("email")) WHERE "deletedAt" IS NULL (§4.3), so the
    // idempotency probe matches it exactly: same predicate, same case folding.
    const existing = await repository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = :email', { email })
      .getOne();

    if (existing !== null) {
      if (existing.role !== Role.ADMIN) {
        throw new Error(
          `SEED_ADMIN_EMAIL (${email}) already belongs to a ${existing.role} account. ` +
            `The seeder will not change an existing account's role — that is an audited admin ` +
            `action (A-2, A-3), not a seed. Use a different address or resolve the conflict by hand.`,
        );
      }

      // The password is deliberately NOT reset. Re-running the seed after the operator has
      // rotated their password (which .env.example tells them to do) must not undo it.
      return {
        created: 0,
        skipped: 1,
        notes: [`Admin ${email} already exists — left untouched, including their password.`],
      };
    }

    const admin = repository.create({
      role: Role.ADMIN,
      email,
      // Pre-verified: there is no inbox to click a link in on a fresh installation, and the
      // first admin must be able to reach the dashboard immediately (E-4).
      emailVerifiedAt: context.now,
      passwordHash: await hashPassword(password, context.env),
      name,
      phone: null,
      phoneVerifiedAt: null,
      status: UserStatus.ACTIVE,
      invitedBy: null,
      failedLoginCount: 0,
      locale: Locale.EN,
    });

    await repository.save(admin);

    return {
      created: 1,
      skipped: 0,
      notes: [
        `Created the first Admin: ${email}.`,
        'Sign in, change this password, then clear SEED_ADMIN_PASSWORD from backend/.env.',
      ],
    };
  },
};

/** §4.3: `email` is stored lower-cased and trimmed. */
function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function assertEmailShape(email: string): void {
  if (!EMAIL_SHAPE.test(email)) {
    throw new Error(`SEED_ADMIN_EMAIL is not a valid email address: "${email}".`);
  }
}

function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. ` +
        'The first admin account holds every permission in the system.',
    );
  }
  if (REJECTED_PASSWORDS.includes(password.trim().toLowerCase())) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is a well-known placeholder value. Choose a real password — ' +
        'this account can read every enquiry and change every setting.',
    );
  }
}

/**
 * Argon2id with the S-6 cost parameters from §7. These are tuning values, not credentials,
 * so they carry documented defaults matching the OWASP baseline.
 */
async function hashPassword(password: string, env: NodeJS.ProcessEnv): Promise<string> {
  return hash(password, {
    type: argon2id,
    memoryCost: readSeedInteger(env, 'ARGON2_MEMORY_KIB', 19_456),
    timeCost: readSeedInteger(env, 'ARGON2_TIME_COST', 2),
    parallelism: readSeedInteger(env, 'ARGON2_PARALLELISM', 1),
  });
}
