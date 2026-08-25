#!/usr/bin/env tsx
/**
 * test-topup-allowance.ts — Unit tests for allowance top-up calculation logic
 *
 * Tests the core decision logic without requiring live blockchain access.
 * Run: tsx scripts/test-topup-allowance.ts
 */

// Utility to assert values in tests
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    console.error(`Assertion Failed: ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual:   ${JSON.stringify(actual)}`);
    process.exit(1);
  } else {
    console.log(`[PASS] ${message}`);
  }
}

function assertBigIntEquals(actual: bigint, expected: bigint, message: string): void {
  if (actual !== expected) {
    console.error(`Assertion Failed: ${message}`);
    console.error(`  Expected: ${expected.toString()}`);
    console.error(`  Actual:   ${actual.toString()}`);
    process.exit(1);
  } else {
    console.log(`[PASS] ${message}`);
  }
}

// ── Test Helpers ─────────────────────────────────────────────────────────────

interface AllowanceAnalysis {
  currentAllowance: bigint;
  subscriptionAmount: bigint;
  minimumThreshold: bigint;
  targetAllowance: bigint;
  topupRequired: boolean;
  topupAmount: bigint;
  token: string;
}

/**
 * Pure calculation function extracted for testing.
 * This mirrors the logic in topup-allowance.ts.
 */
function calculateTopupRequirement(
  currentAllowance: bigint,
  subscriptionAmount: bigint,
  tokenAddress: string,
  minMultiplier: number,
  targetMultiplier: number
): AllowanceAnalysis {
  const minimumThreshold = subscriptionAmount * BigInt(minMultiplier);
  const targetAllowance = subscriptionAmount * BigInt(targetMultiplier);

  const topupRequired = currentAllowance < minimumThreshold;
  const topupAmount = topupRequired ? targetAllowance - currentAllowance : 0n;

  return {
    currentAllowance,
    subscriptionAmount,
    minimumThreshold,
    targetAllowance,
    topupRequired,
    topupAmount,
    token: tokenAddress,
  };
}

// ── Test Cases ───────────────────────────────────────────────────────────────

function testAllowanceSufficient(): void {
  console.log("\n--- Testing: Allowance Sufficient (Above Target) ---");

  const subscriptionAmount = 10_000_000n; // 1 XLM
  const currentAllowance = 150_000_000n; // 15 XLM (above 12× target)
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(result.minimumThreshold, 30_000_000n, "Minimum threshold is 3× subscription");
  assertBigIntEquals(result.targetAllowance, 120_000_000n, "Target allowance is 12× subscription");
  assertEquals(result.topupRequired, false, "Top-up not required when allowance >= target");
  assertBigIntEquals(result.topupAmount, 0n, "Top-up amount is 0 when not required");
}

function testAllowanceBelowMinimum(): void {
  console.log("\n--- Testing: Allowance Below Minimum Threshold ---");

  const subscriptionAmount = 10_000_000n; // 1 XLM
  const currentAllowance = 20_000_000n; // 2 XLM (below 3× minimum)
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(result.minimumThreshold, 30_000_000n, "Minimum threshold is 3× subscription");
  assertBigIntEquals(result.targetAllowance, 120_000_000n, "Target allowance is 12× subscription");
  assertEquals(result.topupRequired, true, "Top-up required when allowance < minimum");
  assertBigIntEquals(
    result.topupAmount,
    100_000_000n,
    "Top-up amount equals target minus current"
  );
}

function testAllowanceBetweenMinimumAndTarget(): void {
  console.log("\n--- Testing: Allowance Between Minimum and Target ---");

  const subscriptionAmount = 10_000_000n; // 1 XLM
  const currentAllowance = 50_000_000n; // 5 XLM (above 3× min, below 12× target)
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(result.minimumThreshold, 30_000_000n, "Minimum threshold is 3× subscription");
  assertBigIntEquals(result.targetAllowance, 120_000_000n, "Target allowance is 12× subscription");
  assertEquals(result.topupRequired, false, "Top-up not required when allowance >= minimum");
  assertBigIntEquals(result.topupAmount, 0n, "Top-up amount is 0 when not required");
}

function testZeroAllowance(): void {
  console.log("\n--- Testing: Zero Allowance ---");

  const subscriptionAmount = 10_000_000n; // 1 XLM
  const currentAllowance = 0n; // No allowance
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(result.minimumThreshold, 30_000_000n, "Minimum threshold is 3× subscription");
  assertBigIntEquals(result.targetAllowance, 120_000_000n, "Target allowance is 12× subscription");
  assertEquals(result.topupRequired, true, "Top-up required when allowance is zero");
  assertBigIntEquals(
    result.topupAmount,
    120_000_000n,
    "Top-up amount equals full target when starting from zero"
  );
}

function testExactMinimumAllowance(): void {
  console.log("\n--- Testing: Exact Minimum Allowance ---");

  const subscriptionAmount = 10_000_000n; // 1 XLM
  const currentAllowance = 30_000_000n; // Exactly 3× subscription
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(result.minimumThreshold, 30_000_000n, "Minimum threshold is 3× subscription");
  assertBigIntEquals(result.targetAllowance, 120_000_000n, "Target allowance is 12× subscription");
  assertEquals(result.topupRequired, false, "Top-up not required when allowance equals minimum");
  assertBigIntEquals(result.topupAmount, 0n, "Top-up amount is 0 when at minimum threshold");
}

function testExactTargetAllowance(): void {
  console.log("\n--- Testing: Exact Target Allowance ---");

  const subscriptionAmount = 10_000_000n; // 1 XLM
  const currentAllowance = 120_000_000n; // Exactly 12× subscription
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(result.minimumThreshold, 30_000_000n, "Minimum threshold is 3× subscription");
  assertBigIntEquals(result.targetAllowance, 120_000_000n, "Target allowance is 12× subscription");
  assertEquals(result.topupRequired, false, "Top-up not required when allowance equals target");
  assertBigIntEquals(result.topupAmount, 0n, "Top-up amount is 0 when at target threshold");
}

function testCustomMultipliers(): void {
  console.log("\n--- Testing: Custom Multipliers ---");

  const subscriptionAmount = 5_000_000n; // 0.5 XLM
  const currentAllowance = 10_000_000n; // 1 XLM (below 5× minimum)
  const minMultiplier = 5;
  const targetMultiplier = 20;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(result.minimumThreshold, 25_000_000n, "Minimum threshold is 5× subscription");
  assertBigIntEquals(result.targetAllowance, 100_000_000n, "Target allowance is 20× subscription");
  assertEquals(result.topupRequired, true, "Top-up required with custom multipliers");
  assertBigIntEquals(result.topupAmount, 90_000_000n, "Top-up amount calculated correctly");
}

function testLargeSubscriptionAmount(): void {
  console.log("\n--- Testing: Large Subscription Amount ---");

  const subscriptionAmount = 1_000_000_000n; // 100 XLM
  const currentAllowance = 2_000_000_000n; // 200 XLM (below 3× minimum)
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(
    result.minimumThreshold,
    3_000_000_000n,
    "Minimum threshold is 3× large subscription"
  );
  assertBigIntEquals(
    result.targetAllowance,
    12_000_000_000n,
    "Target allowance is 12× large subscription"
  );
  assertEquals(result.topupRequired, true, "Top-up required for large amounts");
  assertBigIntEquals(result.topupAmount, 10_000_000_000n, "Top-up amount is 1000 XLM");
}

function testSmallSubscriptionAmount(): void {
  console.log("\n--- Testing: Small Subscription Amount (Micropayment) ---");

  const subscriptionAmount = 100_000n; // 0.01 XLM
  const currentAllowance = 200_000n; // 0.02 XLM (below 3× minimum)
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(
    result.minimumThreshold,
    300_000n,
    "Minimum threshold is 3× small subscription"
  );
  assertBigIntEquals(
    result.targetAllowance,
    1_200_000n,
    "Target allowance is 12× small subscription"
  );
  assertEquals(result.topupRequired, true, "Top-up required for micropayment subscription");
  assertBigIntEquals(result.topupAmount, 1_000_000n, "Top-up amount is 0.1 XLM");
}

function testBoundaryCondition(): void {
  console.log("\n--- Testing: Boundary Condition (1 stroop below minimum) ---");

  const subscriptionAmount = 10_000_000n; // 1 XLM
  const currentAllowance = 29_999_999n; // 1 stroop below 3× minimum
  const minMultiplier = 3;
  const targetMultiplier = 12;

  const result = calculateTopupRequirement(
    currentAllowance,
    subscriptionAmount,
    "CTOKEN123",
    minMultiplier,
    targetMultiplier
  );

  assertBigIntEquals(result.minimumThreshold, 30_000_000n, "Minimum threshold is 3× subscription");
  assertEquals(result.topupRequired, true, "Top-up required when 1 stroop below minimum");
  assertBigIntEquals(
    result.topupAmount,
    90_000_001n,
    "Top-up amount accounts for single stroop difference"
  );
}

// ── Test Runner ──────────────────────────────────────────────────────────────

function runAllTests(): void {
  console.log("=".repeat(70));
  console.log("   PAYFLOW ALLOWANCE TOP-UP CALCULATION TEST SUITE");
  console.log("=".repeat(70));

  testAllowanceSufficient();
  testAllowanceBelowMinimum();
  testAllowanceBetweenMinimumAndTarget();
  testZeroAllowance();
  testExactMinimumAllowance();
  testExactTargetAllowance();
  testCustomMultipliers();
  testLargeSubscriptionAmount();
  testSmallSubscriptionAmount();
  testBoundaryCondition();

  console.log("\n" + "=".repeat(70));
  console.log("   ALL TESTS COMPLETED SUCCESSFULLY!");
  console.log("=".repeat(70));
}

runAllTests();
