# Porkbun MCP

An MCP server that lets any MCP client manage Porkbun domains, DNS records, nameservers, and URL forwarding through natural language. Stop logging into the Porkbun dashboard for routine work: list domains, read and edit DNS, update nameservers, set up forwards, and check domain pricing without leaving your LLM client.

## Install

The server runs over **stdio** via npx. Nothing to install globally.

```bash
npx -y github:nidamen/porkbun-mcp
```

## MCP Client Config

Add this block to your MCP client's server list (Claude Desktop, Cursor, Cline, etc.):

```json
{
  "mcpServers": {
    "porkbun": {
      "command": "npx",
      "args": ["-y", "github:nidamen/porkbun-mcp"],
      "env": {
        "PORKBUN_API_KEY": "<your-api-key>",
        "PORKBUN_API_SECRET": "<your-secret-api-key>"
      }
    }
  }
}
```

Generate your API key and secret at https://porkbun.com/account/api . Each Porkbun API key is a `pk1_...` value and its matching secret is an `sk1_...` value.

## Credentials

The server resolves each secret in this order:

1. **Environment variables** (works on all platforms):
   - `PORKBUN_API_KEY`
   - `PORKBUN_API_SECRET`
2. **macOS Keychain** (fallback when the env vars are absent, darwin only):
   ```bash
   security add-generic-password -U -a "$USER" -s porkbun-api-key    -w '<api-key>'
   security add-generic-password -U -a "$USER" -s porkbun-api-secret -w '<secret-api-key>'
   ```

### Keychain convention (turnkey, nothing hardcoded)

The Keychain lookup is identical for everyone, with no per-user editing:

- **Service names** are fixed: `porkbun-api-key` and `porkbun-api-secret`.
- **Account** is your current OS username, read at runtime via `os.userInfo().username`
  (it is *never* hardcoded to any specific person). So the `security add-generic-password -a "$USER" ...`
  commands above just work.
- If your Keychain uses a different account name, set `PORKBUN_KEYCHAIN_ACCOUNT` to override it.

Credentials are POSTed in the JSON body of every request (that is how the Porkbun API authenticates). They are never logged, printed, or echoed in error messages.

## Enable Porkbun per-domain API Access (important)

Porkbun gates **DNS and most per-domain operations behind a per-domain "API Access" toggle**. `ping`, `get_pricing`, and `check_domain` work without it, but `list_dns_records`, `update_nameservers`, URL forwarding, etc. return `Domain is not opted in to API access` until you turn it on.

To enable it:

1. Sign in at https://porkbun.com/ and open your domains list.
2. Open the domain's **Details** panel.
3. Flip **API Access** to **ON** for that domain. (Manage your keys and overall access at https://porkbun.com/account/api .)
4. Repeat for each domain you want the server to manage.

The server surfaces Porkbun's exact `Domain is not opted in to API access` message so you know precisely which toggle to flip.

## Tool Reference

Every tool returns JSON. Mutating tools require `confirm: true` as an explicit safety gate.

### Connectivity and pricing (read-only)

| Tool | Purpose | Key params |
|------|---------|-----------|
| `ping` | Verify credentials and connectivity; returns your public IP | none |
| `get_pricing` | Porkbun default registration/renewal/transfer pricing for all TLDs | none |
| `check_domain` | Availability and price for one domain | `domain` (string, required) |

### Domain and nameservers

| Tool | Purpose | Key params |
|------|---------|-----------|
| `list_domains` | List all domains in the account (1000/page) | `start` (int offset, optional), `includeLabels` (bool, optional) |
| `get_nameservers` | Get a domain's authoritative nameservers | `domain` (string, required) |
| `update_nameservers` | Replace a domain's nameservers (mutating) | `domain` (string, required), `ns` (array of host strings, required), `confirm: true` |

### DNS records (read-only)

| Tool | Purpose | Key params |
|------|---------|-----------|
| `list_dns_records` | Retrieve all DNS records, or one by id | `domain` (string, required), `id` (string/number, optional) |
| `get_dns_records_by_name_type` | Retrieve records by type + subdomain | `domain` (string, required), `type` (record type, required), `subdomain` (string, optional; empty = apex) |

### DNS records (mutating, require `confirm: true`)

| Tool | Purpose | Key params |
|------|---------|-----------|
| `create_dns_record` | Create a DNS record | `domain`, `type`, `content` (required), `name` (subdomain, optional; empty = apex), `ttl`, `prio`, `notes` (optional), `confirm: true` |
| `edit_dns_record` | Edit a record by id | `domain`, `id`, `type`, `content` (required), `name`, `ttl`, `prio`, `notes` (optional), `confirm: true` |
| `delete_dns_record` | Delete a record by id | `domain`, `id` (required), `confirm: true` |

### URL forwarding

| Tool | Purpose | Key params |
|------|---------|-----------|
| `list_url_forwards` | List URL forwards for a domain | `domain` (string, required) |
| `add_url_forward` | Add a URL forward (mutating) | `domain`, `location` (URL, required), `type` (`temporary`/`permanent`, default `temporary`), `subdomain` (optional; empty = apex), `includePath` (bool), `wildcard` (bool), `confirm: true` |
| `delete_url_forward` | Delete a URL forward by id (mutating) | `domain`, `id` (required), `confirm: true` |

### Escape hatch

| Tool | Purpose | Key params |
|------|---------|-----------|
| `porkbun_request` | Call any Porkbun v3 API path directly | `path` (string, no leading host, e.g. `ssl/retrieve/example.com`), `body` (object, optional), `confirm: true` (required for known mutating paths) |

**Supported DNS record types:** `A`, `AAAA`, `MX`, `CNAME`, `ALIAS`, `TXT`, `NS`, `SRV`, `TLSA`, `CAA`, `HTTPS`, `SVCB`

## Quick Examples

**"List all my domains"**
```
list_domains {}
```

**"Show the DNS records for example.com"**
```
list_dns_records { domain: "example.com" }
```

**"Point www.example.com to 1.2.3.4 with a 10-minute TTL"**
```
create_dns_record {
  domain: "example.com",
  name: "www",
  type: "A",
  content: "1.2.3.4",
  ttl: 600,
  confirm: true
}
```

**"Forward example.com to my landing page, permanently"**
```
add_url_forward {
  domain: "example.com",
  location: "https://landing.example.net/",
  type: "permanent",
  confirm: true
}
```

**"Is my-new-idea.dev available and how much?"**
```
check_domain { domain: "my-new-idea.dev" }
```

## Local smoke test

`npm run smoke` runs a live, read-only check against the real API (`ping` + `dns/retrieve` for the domain set in `scripts/smoke.ts`, `example.com` by default; change it to one of your own domains), reading credentials from the Keychain. It never prints credentials and clearly reports if a domain's API Access toggle is still off.

## Limitations

- Targets the Porkbun JSON API **v3** (`https://api.porkbun.com/api/json/v3`). Override the base with `PORKBUN_BASE_URL` if Porkbun publishes a new version. Endpoints not covered by named tools are reachable via `porkbun_request`.
- **Per-domain API Access toggle.** Most operations fail with `Domain is not opted in to API access` until you enable API access for that domain at https://porkbun.com/account/api .
- The API authenticates by placing the key and secret in the request body, so the credentials travel in every POST (over HTTPS). They are never logged.
- macOS Keychain fallback is macOS-only. On Linux or Windows, set `PORKBUN_API_KEY` and `PORKBUN_API_SECRET` env vars.
- No resources or prompts are registered. All functionality is exposed as tools.
