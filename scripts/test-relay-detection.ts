/**
 * test-relay-detection.ts — self-check for Apple private-relay detection.
 *
 * Run:  npx tsx scripts/test-relay-detection.ts
 * Exits non-zero on the first failing case.
 */
import { isAppleRelayEmail } from "../server/auth-identities";

const cases: Array<[string, boolean]> = [
  // Legacy Apple relay domain
  ["abc123@privaterelay.appleid.com", true],
  // New (2026) shared relay domain
  ["xyz789@private.icloud.com", true],
  ["xyz789@sub.private.icloud.com", true],
  // Real iCloud mailbox — must NOT be treated as relay
  ["someone@icloud.com", false],
  // Ordinary providers
  ["user@gmail.com", false],
  ["user@kindcipe.com", false],
  // Boundary safety — attacker-controlled lookalikes
  ["a@notprivate.icloud.com", false],
  ["a@private.icloud.com.attacker.example", false],
  ["a@privaterelay.appleid.com.attacker.example", false],
  // Empty / malformed
  ["", false],
  ["noatsign", false],
];

let failed = 0;
for (const [input, expected] of cases) {
  const actual = isAppleRelayEmail(input);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} isAppleRelayEmail(${JSON.stringify(input)}) = ${actual} (expected ${expected})`);
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log(`\n✅ all ${cases.length} cases passed`);
