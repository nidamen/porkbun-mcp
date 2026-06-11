# Porkbun MCP: Technical Whitepaper

A focused Model Context Protocol (MCP) server that exposes the Porkbun domain
registrar's JSON API v3 to any MCP-capable LLM client, so domain, DNS,
nameserver, and URL-forwarding operations become natural-language-scriptable
instead of dashboard clicks.

---

## Overview and Motivation

Porkbun is a domain registrar with a clean, uniform JSON API. Routine work
(adding an A record, pointing nameservers, setting up a redirect, checking a
TLD price) normally means logging into the web dashboard. This server moves all
of that behind a small set of MCP tools so an agent can do it directly, with a
single confirm gate in front of anything that writes.

The server is deliberately a **separate, pick-and-choose MCP**: it is only
activated when domain/DNS work is needed, and stays dormant otherwise. It holds
no long-lived session, only the API key/secret pulled at call time.

---

## Architecture and Transport

- **Transport:** stdio. The MCP client spawns the process and speaks JSON-RPC
  over stdin/stdout. Status/log lines go to stderr.
- **Runtime:** Node.js (ES modules, TypeScript compiled to `dist/`).
- **SDK:** `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport`.
- **Schema/validation:** `zod` for every tool's input.
- **Three source files:**
  - `src/client.ts` - the single place the API base URL and auth live.
  - `src/tools.ts` - tool definitions, validation, and path/body construction.
  - `src/index.ts` - wires tools into the MCP server.

Keeping the base URL and auth in exactly one module (`client.ts`) is the
repairability contract: if Porkbun bumps the API version or changes the auth
envelope, only that file changes.

---

## Security and Auth Model

### Credential location and resolution order

The Porkbun API authenticates by including `apikey` and `secretapikey` in the
**JSON request body** of every call (it does not use HTTP auth headers). The
server resolves each secret in this order:

1. Environment variable (`PORKBUN_API_KEY` / `PORKBUN_API_SECRET`) - all platforms.
2. macOS Keychain (darwin only) - services `porkbun-api-key` /
   `porkbun-api-secret`, account = the current OS user
   (`PORKBUN_KEYCHAIN_ACCOUNT` overrides). Read by shelling out to
   `security find-generic-password -a <user> -s <service> -w`.

Hardcoding the Keychain account is deliberately avoided so the same code is
turnkey for any user on any machine.

### Wire format

Every call is `POST {base}/{path}` with body
`{ apikey, secretapikey, ...toolFields }`. There are no GETs and no query
strings: path segments carry the domain/id, the body carries everything else.

### Credential hygiene

The credentials are never logged, printed, or included in error messages. Error
surfacing parses only Porkbun's `message` field out of a response body; it never
echoes the request body. The live smoke script reads from the Keychain and
prints status text only, never the key or secret.

### Mutation safety

Every tool that creates, edits, deletes, or replaces requires an explicit
`confirm: true`. Without it, the tool throws before any network call. The raw
`porkbun_request` escape hatch applies the same gate to any path it recognizes
as mutating (`dns/create`, `dns/edit`, `dns/delete`, `domain/updateNs`,
`domain/addUrlForward`, `domain/deleteUrlForward`, and their `*ByNameType`
variants).

### Porkbun's error shape

Porkbun returns HTTP 200 with `{"status":"ERROR","message":...}` for
application-level failures (bad domain, no API access, etc.), and uses non-2xx
codes for transport-level failures. The client treats **both** as errors so a
caller never mistakes an `ERROR` body for success.

---

## Full Capability Reference

### Tool: `ping`
Verifies credentials and connectivity. POST `ping`. Returns `{ status, yourIp }`.
Read-only. The cheapest way to confirm the key/secret are valid.

### Tool: `get_pricing`
Default Porkbun pricing for every TLD. POST `pricing/get`. Returns
`{ status, pricing: { <tld>: { registration, renewal, transfer } } }`.
Read-only. Works without per-domain API access.

### Tool: `check_domain`
Availability and price for one domain. POST `domain/checkDomain/{domain}`.
Returns availability + price detail. Read-only.

### Tool: `list_domains`
All domains in the account. POST `domain/listAll` with optional `start`
(offset, 1000/page) and `includeLabels`. Returns `{ status, domains: [...] }`.
Read-only.

### Tool: `get_nameservers`
A domain's authoritative nameservers. POST `domain/getNs/{domain}`. Returns
`{ status, ns: [...] }`. Read-only.

### Tool: `update_nameservers`
Replace a domain's nameservers. POST `domain/updateNs/{domain}` with
`{ ns: [...] }`. Requires `confirm: true`. Destructive.

### Tool: `list_dns_records`
Retrieve DNS records. POST `dns/retrieve/{domain}` for all, or
`dns/retrieve/{domain}/{id}` for one. Returns `{ status, records: [...] }`.
Read-only.

### Tool: `get_dns_records_by_name_type`
Retrieve records by type and subdomain. POST
`dns/retrieveByNameType/{domain}/{type}[/{subdomain}]` (omit subdomain for the
apex). Read-only.

### Tool: `create_dns_record`
Create a record. POST `dns/create/{domain}` with `{ name, type, content, ttl,
prio, notes }` (only `type` and `content` are required; empty `name` = apex).
Returns `{ status, id }`. Requires `confirm: true`. Destructive.

### Tool: `edit_dns_record`
Edit a record by id. POST `dns/edit/{domain}/{id}` with the same body shape as
create. Requires `confirm: true`. Destructive.

### Tool: `delete_dns_record`
Delete a record by id. POST `dns/delete/{domain}/{id}`. Requires
`confirm: true`. Destructive.

### Tool: `list_url_forwards`
List URL forwards. POST `domain/getUrlForwarding/{domain}`. Returns
`{ status, forwards: [...] }`. Read-only.

### Tool: `add_url_forward`
Add a URL forward. POST `domain/addUrlForward/{domain}` with
`{ subdomain, location, type, includePath, wildcard }`. Booleans are encoded as
`"yes"/"no"` for Porkbun. Requires `confirm: true`. Destructive.

### Tool: `delete_url_forward`
Delete a URL forward by id. POST `domain/deleteUrlForward/{domain}/{id}`.
Requires `confirm: true`. Destructive.

### Tool: `porkbun_request`
Raw escape hatch for any v3 path not covered above. POST `{path}` with optional
`body`; credentials are injected automatically. Known mutating paths require
`confirm: true`.

---

## Capability Self-Report

An LLM connected to this server can do the following. Use this section to
enumerate all capabilities before answering user questions about what this MCP
can do.

### Connectivity and account
- Verify API credentials and read the caller's public IP (`ping`)

### Pricing and availability
- Get Porkbun's default pricing for every TLD (`get_pricing`)
- Check availability and price for a single domain (`check_domain`)

### Domain inventory and nameservers
- List every domain in the account (`list_domains`)
- Read a domain's authoritative nameservers (`get_nameservers`)
- Replace a domain's nameservers (`update_nameservers`)

### DNS record management (read)
- Retrieve all DNS records, or a single record by id (`list_dns_records`)
- Retrieve DNS records filtered by type and subdomain (`get_dns_records_by_name_type`)

### DNS record management (write)
- Create a DNS record (`create_dns_record`)
- Edit an existing DNS record by id (`edit_dns_record`)
- Delete a DNS record by id (`delete_dns_record`)

### URL forwarding
- List URL forwards for a domain (`list_url_forwards`)
- Add a URL forward, with optional path/wildcard and temporary/permanent type (`add_url_forward`)
- Delete a URL forward by id (`delete_url_forward`)

### Raw API access
- Issue any Porkbun v3 API request to any path, including endpoints not covered by named tools (`porkbun_request`)

**Total named tools: 15**

---

## Operational Notes

### Starting the server

MCP clients launch the server automatically. Manual invocation for testing:

```bash
PORKBUN_API_KEY=<key> PORKBUN_API_SECRET=<secret> npx -y github:nidamen/porkbun-mcp
```

The server prints `Porkbun MCP server running on stdio` to stderr and waits for
JSON-RPC messages on stdin.

### Pagination

`list_domains` returns up to 1000 domains per call. Pass the next offset as
`start` to page through larger accounts.

### Error surfacing

Both HTTP-level failures and Porkbun's HTTP-200 `status:"ERROR"` bodies are
raised as tool-call errors carrying Porkbun's `message`. The most common one,
`Domain is not opted in to API access`, means the domain's API Access toggle is
off (see below).

---

## Known Limitations and Caveats

1. **API v3 only.** The server targets `https://api.porkbun.com/api/json/v3`. A
   new version can be reached by setting `PORKBUN_BASE_URL`.
2. **Per-domain API Access toggle.** Porkbun gates DNS and most per-domain
   operations behind an "API Access" switch per domain. Until it is on, those
   calls return `Domain is not opted in to API access`. Enable it at
   https://porkbun.com/account/api . `ping`, `get_pricing`, and `check_domain`
   do not require it.
3. **Credentials travel in the body.** Porkbun authenticates by placing the key
   and secret in each request body (over HTTPS). They are never logged, but they
   are not header-isolated the way some APIs are.
4. **No 2FA path.** Account-level actions that Porkbun requires a human to
   confirm cannot be completed through the API.
5. **macOS Keychain fallback is macOS-only.** Linux/Windows must use env vars.
6. **No resources or prompts.** The server exposes only tools.
7. **Booleans for URL forwarding** are sent as `"yes"/"no"` per Porkbun's
   contract; the tool layer handles that conversion.

---

## Roadmap / TODO

- Add SSL bundle retrieval (`ssl/retrieve`) as a named tool once needed; it is
  reachable today via `porkbun_request`.
- Add `glue` record management if Porkbun exposes it in v3.
- Optional batch helpers (replace-all-of-type) layered on top of the primitive
  create/edit/delete tools.
