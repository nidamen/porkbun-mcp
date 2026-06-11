/**
 * Live, READ-ONLY smoke test against the real Porkbun API.
 * Runs: ping  +  dns/retrieve for SMOKE_DOMAIN (example.com by default).
 *
 * Set SMOKE_DOMAIN to one of your own domains to exercise the DNS read path:
 *   SMOKE_DOMAIN=yourdomain.tld npm run smoke
 *
 * Reads credentials from the Keychain (services porkbun-api-key /
 * porkbun-api-secret, account = current user) via the same client the MCP uses.
 * NEVER prints the credentials. Run with: npm run smoke
 */
import { PorkbunClient } from "../src/client.js";
import { callTool } from "../src/tools.js";

// Generic default; override with SMOKE_DOMAIN=yourdomain.tld npm run smoke
const SMOKE_DOMAIN = process.env.SMOKE_DOMAIN || "example.com";

async function main() {
  const client = new PorkbunClient();

  console.log("== Porkbun live smoke test (read-only) ==\n");

  // 1) ping
  try {
    const ping = (await callTool(client, "ping", {})) as { status?: string; yourIp?: string };
    console.log(`ping: OK  status=${ping.status ?? "?"}  yourIp=${ping.yourIp ?? "?"}`);
  } catch (err) {
    console.log(`ping: FAILED  ${(err as Error).message}`);
    process.exitCode = 1;
    return; // if ping fails, creds/connectivity are broken; stop here
  }

  // 2) dns/retrieve for SMOKE_DOMAIN (gated by Porkbun's per-domain API Access toggle)
  try {
    const dns = (await callTool(client, "list_dns_records", { domain: SMOKE_DOMAIN })) as {
      status?: string;
      records?: unknown[];
    };
    const count = Array.isArray(dns.records) ? dns.records.length : 0;
    console.log(`dns/retrieve ${SMOKE_DOMAIN}: OK  ${count} record(s) returned  -> API Access is ENABLED for ${SMOKE_DOMAIN}`);
  } catch (err) {
    const msg = (err as Error).message;
    const accessGated = /not opted in|api access|edit the domain|not authorized|permission/i.test(msg);
    if (accessGated) {
      console.log(
        `dns/retrieve ${SMOKE_DOMAIN}: ACCESS GATED  -> flip "API Access" ON for ${SMOKE_DOMAIN} in the Porkbun UI.\n  detail: ${msg}`,
      );
    } else {
      console.log(`dns/retrieve ${SMOKE_DOMAIN}: FAILED  ${msg}`);
    }
  }
}

main().catch((err) => {
  console.error("smoke test crashed:", (err as Error).message);
  process.exit(1);
});
