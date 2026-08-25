#!/usr/bin/env tsx
/**
 * topup-allowance.ts — Check and report on token allowance top-up requirements
 *
 * Queries a user's current token allowance for the FlowPay contract and determines
 * whether it needs to be topped up based on their active subscription amount.
 *
 * This script provides READ-ONLY foundation for allowance management:
 * - Queries current allowance from token contract
 * - Queries subscription amount from FlowPay contract
 * - Calculates minimum and target allowance thresholds
 * - Reports whether a top-up would be required
 *
 * DOES NOT submit transactions or modify blockchain state in this version.
 *
 * Usage:
 *   CONTRACT_ID=C... USER_ADDRESS=G... tsx topup-allowance.ts
 *   CONTRACT_ID=C... USER_ADDRESS=G... tsx topup-allowance.ts --dry-run
 *
 * Environment Variables:
 *   CONTRACT_ID              Required. Deployed FlowPay contract ID.
 *   USER_ADDRESS             Required. Subscriber's Stellar address (G...).
 *   RPC_URL                  Optional. Soroban RPC endpoint (default: testnet).
 *   NETWORK_PASSPHRASE       Optional. Network passphrase (default: testnet).
 *   MIN_ALLOWANCE_MULTIPLIER Optional. Minimum threshold multiplier (default: 3).
 *   TARGET_ALLOWANCE_MULTIPLIER Optional. Target top-up multiplier (default: 12).
 *   LOG_LEVEL                Optional. Log verbosity (debug|info|warn|error, default: info).
 *
 * Flags:
 *   --dry-run    Explicitly mark this as a dry-run (informational, no tx submission).
 *   --help, -h   Show this help message.
 *
 * Exit Codes:
 *   0 - Success (allowance sufficient or dry-run complete)
 *   1 - Configuration error or RPC failure
 *   2 - No active subscription (not an error, just nothing to do)
 */

import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { MultiEndpointServer } from "./rpc-client.js";
import { logger } from "./logger.js";

// ── Configuration ────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID || "";
const USER_ADDRESS = process.env.USER_ADDRESS || "";
const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET) as string;

// Configurable multipliers
const MIN_ALLOWANCE_MULTIPLIER = Number(process.env.MIN_ALLOWANCE_MULTIPLIER) || 3;
const TARGET_ALLOWANCE_MULTIPLIER = Number(process.env.TARGET_ALLOWANCE_MULTIPLIER) || 12;

// ── Validation ───────────────────────────────────────────────────────────────

function validateConfig(): void {
  const errors: string[] = [];

  if (!CONTRACT_ID) {
    errors.push("CONTRACT_ID is required");
  } else if (!CONTRACT_ID.startsWith("C") || CONTRACT_ID.length !== 56) {
    errors.push("CONTRACT_ID must be a valid Stellar contract ID (starts with 'C', 56 characters)");
  }

  if (!USER_ADDRESS) {
    errors.push("USER_ADDRESS is required");
  } else {
    try {
      Address.fromString(USER_ADDRESS);
    } catch {
      errors.push("USER_ADDRESS must be a valid Stellar address");
    }
  }

  if (!RPC_URL) {
    errors.push("RPC_URL is required");
  }

  if (MIN_ALLOWANCE_MULTIPLIER <= 0 || !Number.isFinite(MIN_ALLOWANCE_MULTIPLIER)) {
    errors.push("MIN_ALLOWANCE_MULTIPLIER must be a positive number");
  }

  if (TARGET_ALLOWANCE_MULTIPLIER <= 0 || !Number.isFinite(TARGET_ALLOWANCE_MULTIPLIER)) {
    errors.push("TARGET_ALLOWANCE_MULTIPLIER must be a positive number");
  }

  if (MIN_ALLOWANCE_MULTIPLIER > TARGET_ALLOWANCE_MULTIPLIER) {
    errors.push("MIN_ALLOWANCE_MULTIPLIER cannot exceed TARGET_ALLOWANCE_MULTIPLIER");
  }

  if (errors.length > 0) {
    logger.error("Configuration validation failed:");
    for (const err of errors) {
      logger.error(`  - ${err}`);
    }
    logger.error("");
    logger.error("Usage: CONTRACT_ID=C... USER_ADDRESS=G... tsx topup-allowance.ts [--dry-run]");
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
PayFlow Allowance Top-up Check (Read-Only Foundation)

Usage:
  CONTRACT_ID=C... USER_ADDRESS=G... tsx topup-allowance.ts [options]

Options:
  --dry-run   Explicitly mark as dry-run (informational only, no transactions).
  --help, -h  Show this help message.

Environment Variables:
  CONTRACT_ID                 Required. Deployed FlowPay contract ID.
  USER_ADDRESS                Required. Subscriber's Stellar address.
  RPC_URL                     Optional. Soroban RPC endpoint (default: testnet).
  NETWORK_PASSPHRASE          Optional. Network passphrase (default: Testnet).
  MIN_ALLOWANCE_MULTIPLIER    Optional. Minimum threshold (default: 3).
  TARGET_ALLOWANCE_MULTIPLIER Optional. Target top-up (default: 12).
  LOG_LEVEL                   Optional. Log level (debug|info|warn|error, default: info).

Output:
  Reports current allowance, subscription amount, calculated thresholds,
  and whether a top-up would be required (if this script supported it).

Note:
  This version is READ-ONLY. Transaction submission is not implemented.
  `);
  process.exit(0);
}

// ── SDK Helpers ──────────────────────────────────────────────────────────────

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

function stroopsToXlm(stroops: bigint | string): string {
  const value = typeof stroops === "bigint" ? Number(stroops) : Number(stroops);
  return (value / 10_000_000).toFixed(7);
}

// ── Contract Reads ───────────────────────────────────────────────────────────

interface SubscriptionInfo {
  amount: bigint;
  token: string;
  active: boolean;
  paused: boolean;
}

/**
 * Query the user's subscription details from the FlowPay contract.
 * Returns null if no subscription exists.
 */
async function getSubscription(
  server: MultiEndpointServer,
  userAddress: string
): Promise<SubscriptionInfo | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(userAddress);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_subscription", addressVal(userAddress)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) {
      logger.debug("Simulation returned error", { error: result.error });
      return null;
    }

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") {
      return null;
    }

    // Parse subscription fields from the returned map
    const fields: Record<string, unknown> = {};
    for (const entry of retval.map() ?? []) {
      const key = entry.key().sym().toString();
      const val = entry.val();
      switch (key) {
        case "amount":
          fields[key] = BigInt(val.i128().toString());
          break;
        case "token":
          fields[key] = Address.fromScVal(val).toString();
          break;
        case "active":
          fields[key] = val.b();
          break;
        case "paused":
          fields[key] = val.b();
          break;
      }
    }

    return {
      amount: fields.amount as bigint,
      token: fields.token as string,
      active: fields.active as boolean,
      paused: fields.paused as boolean,
    };
  } catch (err) {
    logger.error("Failed to query subscription", { error: String(err) });
    return null;
  }
}

/**
 * Query the user's current token allowance for the FlowPay contract.
 * Returns 0n if the query fails or the account doesn't exist.
 */
async function getAllowance(
  server: MultiEndpointServer,
  ownerAddress: string,
  tokenAddress: string
): Promise<bigint> {
  try {
    const tokenContract = new Contract(tokenAddress);
    const flowPayAddress = Address.fromString(CONTRACT_ID);

    const account = await server.getAccount(ownerAddress).catch(() => null);
    if (!account) {
      logger.debug("Account not found on ledger", { owner: ownerAddress });
      return 0n;
    }

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        tokenContract.call(
          "allowance",
          addressVal(ownerAddress),
          nativeToScVal(flowPayAddress, { type: "address" })
        )
      )
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) {
      logger.debug("Allowance query simulation failed", { error: result.error });
      return 0n;
    }

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") {
      return 0n;
    }

    return BigInt(retval.i128().toString());
  } catch (err) {
    logger.error("Failed to query allowance", { error: String(err) });
    return 0n;
  }
}

// ── Calculation Logic ────────────────────────────────────────────────────────

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
 * Calculate allowance thresholds and determine if top-up is needed.
 */
function calculateTopupRequirement(
  currentAllowance: bigint,
  subscriptionAmount: bigint,
  tokenAddress: string
): AllowanceAnalysis {
  const minimumThreshold = subscriptionAmount * BigInt(MIN_ALLOWANCE_MULTIPLIER);
  const targetAllowance = subscriptionAmount * BigInt(TARGET_ALLOWANCE_MULTIPLIER);

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

// ── Output Formatting ────────────────────────────────────────────────────────

function formatAnalysis(analysis: AllowanceAnalysis, isDryRun: boolean): void {
  const prefix = isDryRun ? "[DRY-RUN]" : "[ANALYSIS]";

  logger.info("");
  logger.info(`${prefix} Allowance Analysis`);
  logger.info("─".repeat(70));
  logger.info(`User:                  ${USER_ADDRESS}`);
  logger.info(`Token:                 ${analysis.token}`);
  logger.info(`Contract:              ${CONTRACT_ID}`);
  logger.info("");
  logger.info(`Current Allowance:     ${stroopsToXlm(analysis.currentAllowance)} XLM (${analysis.currentAllowance} stroops)`);
  logger.info(`Subscription Amount:   ${stroopsToXlm(analysis.subscriptionAmount)} XLM (${analysis.subscriptionAmount} stroops)`);
  logger.info("");
  logger.info(`Minimum Threshold:     ${stroopsToXlm(analysis.minimumThreshold)} XLM (${MIN_ALLOWANCE_MULTIPLIER}× subscription)`);
  logger.info(`Target Allowance:      ${stroopsToXlm(analysis.targetAllowance)} XLM (${TARGET_ALLOWANCE_MULTIPLIER}× subscription)`);
  logger.info("");

  if (analysis.topupRequired) {
    logger.info(`Status:                ⚠️  TOP-UP REQUIRED`);
    logger.info(`Top-up Amount:         ${stroopsToXlm(analysis.topupAmount)} XLM (${analysis.topupAmount} stroops)`);
    logger.info("");
    logger.info(`Action:                Allowance is below minimum threshold.`);
    logger.info(`                       Would increase allowance by ${stroopsToXlm(analysis.topupAmount)} XLM to reach target.`);
  } else if (analysis.currentAllowance >= analysis.targetAllowance) {
    logger.info(`Status:                ✅ ALLOWANCE SUFFICIENT (at or above target)`);
    logger.info("");
    logger.info(`Action:                No top-up needed.`);
  } else {
    logger.info(`Status:                ✅ ALLOWANCE SUFFICIENT (above minimum, below target)`);
    logger.info("");
    logger.info(`Action:                No top-up needed.`);
    logger.info(`                       Current allowance is adequate but below target threshold.`);
  }

  logger.info("");
  logger.info(`${prefix} Note: No transaction will be submitted. This is analysis only.`);
  logger.info("─".repeat(70));
  logger.info("");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Parse command-line arguments
  const argv = process.argv.slice(2);
  let isDryRun = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      showHelp();
    } else if (arg === "--dry-run") {
      isDryRun = true;
    } else {
      logger.error(`Unknown option: ${arg}`);
      showHelp();
    }
  }

  // Validate configuration
  validateConfig();

  logger.info("Starting allowance top-up analysis...");
  logger.debug("Configuration", {
    contract: CONTRACT_ID,
    user: USER_ADDRESS,
    rpc: RPC_URL,
    minMultiplier: MIN_ALLOWANCE_MULTIPLIER,
    targetMultiplier: TARGET_ALLOWANCE_MULTIPLIER,
    isDryRun,
  });

  // Initialize RPC client
  const server = new MultiEndpointServer(RPC_URL);

  try {
    // Query subscription
    logger.info("Querying subscription details...");
    const subscription = await getSubscription(server, USER_ADDRESS);

    if (!subscription) {
      logger.warn("No subscription found for user", { user: USER_ADDRESS });
      logger.info("");
      logger.info("Status: No active subscription");
      logger.info("Action: Cannot determine allowance requirements without a subscription.");
      logger.info("");
      process.exit(2);
    }

    if (!subscription.active) {
      logger.warn("Subscription exists but is not active", {
        user: USER_ADDRESS,
        active: subscription.active,
        paused: subscription.paused,
      });
      logger.info("");
      logger.info("Status: Subscription inactive");
      logger.info("Action: No allowance top-up needed for inactive subscription.");
      logger.info("");
      process.exit(2);
    }

    logger.debug("Subscription found", {
      amount: subscription.amount.toString(),
      token: subscription.token,
      active: subscription.active,
      paused: subscription.paused,
    });

    // Query current allowance
    logger.info("Querying current allowance...");
    const currentAllowance = await getAllowance(server, USER_ADDRESS, subscription.token);

    logger.debug("Allowance queried", {
      allowance: currentAllowance.toString(),
      token: subscription.token,
    });

    // Calculate requirements
    logger.info("Calculating top-up requirements...");
    const analysis = calculateTopupRequirement(
      currentAllowance,
      subscription.amount,
      subscription.token
    );

    // Display results
    formatAnalysis(analysis, isDryRun);

    // Exit with appropriate code
    if (analysis.topupRequired) {
      logger.info("Exit: Top-up would be required (not implemented in this version)");
      process.exit(0);
    } else {
      logger.info("Exit: Allowance is sufficient");
      process.exit(0);
    }
  } catch (err) {
    logger.error("Fatal error during analysis", { error: String(err) });
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error("Unhandled error in main", { error: String(err) });
  process.exit(1);
});
