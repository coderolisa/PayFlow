# Allowance Top-up Script (Read-Only Foundation)

## Overview

`scripts/topup-allowance.ts` provides a **read-only foundation** for managing token allowances in the PayFlow subscription system. This script analyzes a user's current allowance and determines whether it needs to be topped up based on their active subscription amount.

**This is Phase 1 (approximately 10% of the full feature):**
- ✅ Queries current allowance
- ✅ Queries subscription amount  
- ✅ Calculates thresholds
- ✅ Determines if top-up is needed
- ✅ Dry-run mode (safe, read-only)
- ❌ Does NOT submit transactions (future phase)
- ❌ Does NOT handle SECRET_KEY signing (future phase)

## Background

Users authorize the PayFlow contract to transfer tokens on their behalf via the SAC (Stellar Asset Contract) `allowance` mechanism. Over time, as subscriptions are charged, this allowance depletes. When the allowance drops below a safe threshold, users need to increase it via the `increase_allowance` transaction.

This script automates the detection of low-allowance situations and provides the analysis needed for a future automated top-up system.

## Architecture

The script reuses existing repository patterns and utilities:

### Dependencies
- **`MultiEndpointServer`** (`rpc-client.ts`): RPC client with automatic failover
- **`logger`** (`logger.ts`): Structured logging with configurable levels
- **`@stellar/stellar-sdk`**: Soroban contract interaction

### Contract Queries
1. **Subscription Query** (`get_subscription`): Fetches user's subscription details including:
   - `amount`: Subscription charge amount (stroops)
   - `token`: Token contract address
   - `active`: Whether subscription is active
   - `paused`: Whether subscription is paused

2. **Allowance Query** (`allowance`): Queries the token contract for:
   - Current allowance the user has granted to FlowPay contract
   - Returns allowance in stroops (1 XLM = 10,000,000 stroops)

### Calculation Logic

```
minimumThreshold = subscription_amount × MIN_ALLOWANCE_MULTIPLIER (default: 3)
targetAllowance = subscription_amount × TARGET_ALLOWANCE_MULTIPLIER (default: 12)

if currentAllowance < minimumThreshold:
    topupRequired = true
    topupAmount = targetAllowance - currentAllowance
else:
    topupRequired = false
```

**Example:**
- Subscription amount: 1 XLM (10,000,000 stroops)
- Minimum threshold: 3 XLM (30,000,000 stroops)
- Target allowance: 12 XLM (120,000,000 stroops)
- Current allowance: 2 XLM (20,000,000 stroops)
- **Result**: Top-up required. Would increase by 10 XLM to reach 12 XLM target.

## Usage

### Basic Usage

```bash
# Check allowance for a specific user
CONTRACT_ID=CDLZFC... USER_ADDRESS=GABC123... tsx topup-allowance.ts
```

### Dry-run Mode (Explicit)

```bash
# Explicitly mark as dry-run
CONTRACT_ID=CDLZFC... USER_ADDRESS=GABC123... tsx topup-allowance.ts --dry-run
```

### With Custom Multipliers

```bash
# Use 5× minimum and 20× target
MIN_ALLOWANCE_MULTIPLIER=5 \
TARGET_ALLOWANCE_MULTIPLIER=20 \
CONTRACT_ID=CDLZFC... \
USER_ADDRESS=GABC123... \
tsx topup-allowance.ts
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTRACT_ID` | ✅ Yes | - | PayFlow contract ID (starts with 'C', 56 chars) |
| `USER_ADDRESS` | ✅ Yes | - | Subscriber's Stellar address (starts with 'G') |
| `RPC_URL` | No | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` | No | `Test SDF Network ; September 2015` | Network passphrase |
| `MIN_ALLOWANCE_MULTIPLIER` | No | `3` | Minimum threshold multiplier |
| `TARGET_ALLOWANCE_MULTIPLIER` | No | `12` | Target allowance multiplier |
| `LOG_LEVEL` | No | `info` | Log verbosity (debug/info/warn/error) |

### Help

```bash
tsx topup-allowance.ts --help
```

## Example Output

### When Top-up Required

```
[ANALYSIS] Allowance Analysis
──────────────────────────────────────────────────────────────────────
User:                  GABC123...
Token:                 CTOKEN456...
Contract:              CDLZFC789...

Current Allowance:     2.0000000 XLM (20000000 stroops)
Subscription Amount:   1.0000000 XLM (10000000 stroops)

Minimum Threshold:     3.0000000 XLM (3× subscription)
Target Allowance:      12.0000000 XLM (12× subscription)

Status:                ⚠️  TOP-UP REQUIRED
Top-up Amount:         10.0000000 XLM (100000000 stroops)

Action:                Allowance is below minimum threshold.
                       Would increase allowance by 10.0000000 XLM to reach target.

[ANALYSIS] Note: No transaction will be submitted. This is analysis only.
──────────────────────────────────────────────────────────────────────
```

### When Allowance Sufficient

```
[ANALYSIS] Allowance Analysis
──────────────────────────────────────────────────────────────────────
User:                  GABC123...
Token:                 CTOKEN456...
Contract:              CDLZFC789...

Current Allowance:     15.0000000 XLM (150000000 stroops)
Subscription Amount:   1.0000000 XLM (10000000 stroops)

Minimum Threshold:     3.0000000 XLM (3× subscription)
Target Allowance:      12.0000000 XLM (12× subscription)

Status:                ✅ ALLOWANCE SUFFICIENT (at or above target)

Action:                No top-up needed.

[ANALYSIS] Note: No transaction will be submitted. This is analysis only.
──────────────────────────────────────────────────────────────────────
```

## Edge Cases Handled

### 1. No Subscription
```
Status: No active subscription
Action: Cannot determine allowance requirements without a subscription.
Exit code: 2
```

### 2. Inactive Subscription
```
Status: Subscription inactive
Action: No allowance top-up needed for inactive subscription.
Exit code: 2
```

### 3. Allowance Already Sufficient
```
Status: ✅ ALLOWANCE SUFFICIENT
Action: No top-up needed.
Exit code: 0
```

### 4. Allowance Between Minimum and Target
```
Status: ✅ ALLOWANCE SUFFICIENT (above minimum, below target)
Action: No top-up needed. Current allowance is adequate but below target threshold.
Exit code: 0
```

### 5. RPC/Query Failure
```
Error: Failed to query subscription/allowance
Exit code: 1
```

### 6. Invalid Configuration
```
Error: Configuration validation failed:
  - CONTRACT_ID is required
  - USER_ADDRESS must be a valid Stellar address
Exit code: 1
```

## Testing

### Run Unit Tests

```bash
cd scripts
npm test
```

### Test Coverage

The test suite (`test-topup-allowance.ts`) covers:

1. ✅ Allowance sufficient (above target)
2. ✅ Allowance below minimum threshold
3. ✅ Allowance between minimum and target
4. ✅ Zero allowance
5. ✅ Exact minimum allowance
6. ✅ Exact target allowance
7. ✅ Custom multipliers (5× and 20×)
8. ✅ Large subscription amounts (100 XLM)
9. ✅ Small subscription amounts (micropayments)
10. ✅ Boundary conditions (1 stroop below minimum)

**All tests pass:**
```
======================================================================
   PAYFLOW ALLOWANCE TOP-UP CALCULATION TEST SUITE
======================================================================
[PASS] × 43 assertions
======================================================================
   ALL TESTS COMPLETED SUCCESSFULLY!
======================================================================
```

## Security Considerations

### What This Script Does NOT Do
- ❌ Does NOT require SECRET_KEY
- ❌ Does NOT build transactions
- ❌ Does NOT submit transactions
- ❌ Does NOT modify blockchain state
- ❌ Does NOT log sensitive data

### Read-Only Operations
All operations use `simulateTransaction` for read-only queries:
- Query subscription via contract simulation
- Query allowance via token contract simulation
- No transaction signing
- No transaction submission
- No state changes

### Future Phases Will Add
- SECRET_KEY handling for transaction signing
- `increase_allowance` transaction construction
- Transaction submission with proper error handling
- Automated scheduling/monitoring

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (allowance analyzed, dry-run complete) |
| 1 | Configuration error or RPC failure |
| 2 | No active subscription (not an error, just nothing to do) |

## Integration with Existing Scripts

This script follows the same patterns as:
- **`check-allowances.ts`**: Allowance auditing for multiple users
- **`keeper.ts`**: Automated subscription charging
- **`subscriber-health-dashboard.ts`**: Health monitoring

It reuses:
- `MultiEndpointServer` for RPC resilience
- `logger` for structured logging
- Standard SDK patterns for contract queries

## Future Enhancements (Not in This PR)

The following features are intentionally NOT implemented in this read-only foundation:

### Phase 2 - Transaction Submission
- [ ] Build `increase_allowance` transaction
- [ ] Sign with SECRET_KEY
- [ ] Submit transaction to network
- [ ] Poll for confirmation
- [ ] Return transaction hash

### Phase 3 - Automation
- [ ] Batch processing (multiple users)
- [ ] Scheduled execution (cron/systemd)
- [ ] Retry logic for failed transactions
- [ ] Alerting for persistent failures

### Phase 4 - Monitoring
- [ ] Prometheus metrics export
- [ ] Grafana dashboard integration
- [ ] Alert on repeated top-up needs (possible issue)
- [ ] Cost tracking (transaction fees)

## Contributing

When implementing future phases:

1. **Preserve the read-only foundation**: Keep the calculation and query logic separate from transaction submission
2. **Follow existing patterns**: Use the same SDK patterns as `keeper.ts` for transaction handling
3. **Add tests**: Extend `test-topup-allowance.ts` with new test cases
4. **Handle errors gracefully**: Follow the error handling patterns in `check-allowances.ts`
5. **Document changes**: Update this README with new capabilities

## Related Documentation

- [API Documentation](../docs/API.md): Contract method signatures
- [Keeper Documentation](../docs/KEEPER.md): Automated charging patterns
- [Security Model](../docs/SECURITY.md): Allowance and authorization
- [Integration Guide](../docs/INTEGRATION-GUIDE.md): Using PayFlow programmatically

## License

Same as the PayFlow project (see root LICENSE file).
