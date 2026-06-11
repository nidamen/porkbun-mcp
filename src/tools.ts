import { z } from "zod";
import type { PorkbunClient } from "./client.js";

export interface ToolClient {
  request<T = unknown>(path: string, options?: { body?: Record<string, unknown> }): Promise<T>;
}

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9_.-]+\.[A-Za-z0-9.-]+$/, "must be a valid domain like example.com");

// Record types Porkbun supports for DNS create/edit.
const recordTypeSchema = z.enum(["A", "AAAA", "MX", "CNAME", "ALIAS", "TXT", "NS", "SRV", "TLSA", "CAA", "HTTPS", "SVCB"]);

// Subdomain/host fragment used in retrieveByNameType. Empty string == apex.
const hostSchema = z.string().trim();

const tools = {
  ping: {
    description: "Verify Porkbun API credentials and connectivity. Returns your public IP.",
    inputSchema: z.object({}),
    readOnlyHint: true,
  },
  list_domains: {
    description: "List all domains in the Porkbun account (domain/listAll), 1000 per page.",
    inputSchema: z.object({
      start: z.number().int().min(0).optional(),
      includeLabels: z.boolean().optional(),
    }),
    readOnlyHint: true,
  },
  get_nameservers: {
    description: "Get the authoritative nameservers for a domain (domain/getNs).",
    inputSchema: z.object({
      domain: domainSchema,
    }),
    readOnlyHint: true,
  },
  update_nameservers: {
    description: "Replace a domain's nameservers (domain/updateNs). Requires confirm: true.",
    inputSchema: z.object({
      domain: domainSchema,
      ns: z.array(z.string().trim().min(1)).min(1),
      confirm: z.boolean().default(false),
    }),
    destructiveHint: true,
  },
  list_dns_records: {
    description: "Retrieve DNS records for a domain (dns/retrieve), or a single record when id is given.",
    inputSchema: z.object({
      domain: domainSchema,
      id: z.union([z.string(), z.number()]).optional(),
    }),
    readOnlyHint: true,
  },
  get_dns_records_by_name_type: {
    description: "Retrieve DNS records filtered by type and subdomain (dns/retrieveByNameType). Empty subdomain = apex.",
    inputSchema: z.object({
      domain: domainSchema,
      type: recordTypeSchema,
      subdomain: hostSchema.optional(),
    }),
    readOnlyHint: true,
  },
  create_dns_record: {
    description: "Create a DNS record (dns/create). Requires confirm: true.",
    inputSchema: z.object({
      domain: domainSchema,
      type: recordTypeSchema,
      content: z.string().min(1),
      name: hostSchema.optional(),
      ttl: z.number().int().min(60).optional(),
      prio: z.number().int().min(0).optional(),
      notes: z.string().optional(),
      confirm: z.boolean().default(false),
    }),
    destructiveHint: true,
  },
  edit_dns_record: {
    description: "Edit an existing DNS record by id (dns/edit). Requires confirm: true.",
    inputSchema: z.object({
      domain: domainSchema,
      id: z.union([z.string(), z.number()]),
      type: recordTypeSchema,
      content: z.string().min(1),
      name: hostSchema.optional(),
      ttl: z.number().int().min(60).optional(),
      prio: z.number().int().min(0).optional(),
      notes: z.string().optional(),
      confirm: z.boolean().default(false),
    }),
    destructiveHint: true,
  },
  delete_dns_record: {
    description: "Delete a DNS record by id (dns/delete). Requires confirm: true.",
    inputSchema: z.object({
      domain: domainSchema,
      id: z.union([z.string(), z.number()]),
      confirm: z.boolean().default(false),
    }),
    destructiveHint: true,
  },
  list_url_forwards: {
    description: "List URL forwarding records for a domain (domain/getUrlForwarding).",
    inputSchema: z.object({
      domain: domainSchema,
    }),
    readOnlyHint: true,
  },
  add_url_forward: {
    description: "Add a URL forward for a domain or subdomain (domain/addUrlForward). Requires confirm: true.",
    inputSchema: z.object({
      domain: domainSchema,
      location: z.string().url(),
      type: z.enum(["temporary", "permanent"]).default("temporary"),
      subdomain: hostSchema.optional(),
      includePath: z.boolean().default(false),
      wildcard: z.boolean().default(false),
      confirm: z.boolean().default(false),
    }),
    destructiveHint: true,
  },
  delete_url_forward: {
    description: "Delete a URL forward by id (domain/deleteUrlForward). Requires confirm: true.",
    inputSchema: z.object({
      domain: domainSchema,
      id: z.union([z.string(), z.number()]),
      confirm: z.boolean().default(false),
    }),
    destructiveHint: true,
  },
  check_domain: {
    description: "Check availability and price for a single domain (domain/checkDomain).",
    inputSchema: z.object({
      domain: domainSchema,
    }),
    readOnlyHint: true,
  },
  get_pricing: {
    description: "Get Porkbun's default registration/renewal/transfer pricing for all TLDs (pricing/get).",
    inputSchema: z.object({}),
    readOnlyHint: true,
  },
  porkbun_request: {
    description:
      "Call any Porkbun v3 API path directly for endpoints not covered by named tools. Credentials are injected automatically. Mutating paths require confirm: true.",
    inputSchema: z.object({
      path: z.string().min(1),
      body: z.record(z.string(), z.unknown()).optional(),
      confirm: z.boolean().default(false),
    }),
  },
} as const;

export type ToolName = keyof typeof tools;

export function toolDefinitions() {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: "readOnlyHint" in tool ? tool.readOnlyHint : false,
      destructiveHint: "destructiveHint" in tool ? tool.destructiveHint : false,
    },
  }));
}

function enc(value: string | number): string {
  return encodeURIComponent(String(value));
}

function requireConfirm(args: { confirm?: boolean }, action: string): void {
  if (!args.confirm) {
    throw new Error(`${action} requires confirm: true.`);
  }
}

/** Drop undefined fields so the JSON body stays clean. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Porkbun encodes booleans for URL forwarding as "yes"/"no".
function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

// A few paths are inherently mutating even via the raw escape hatch.
const MUTATING_RAW_PREFIXES = [
  "dns/create",
  "dns/edit",
  "dns/delete",
  "dns/editByNameType",
  "dns/deleteByNameType",
  "domain/updateNs",
  "domain/addUrlForward",
  "domain/deleteUrlForward",
];

function rawPathIsMutating(path: string): boolean {
  const normalized = path.replace(/^\//, "");
  return MUTATING_RAW_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export async function callTool(client: ToolClient | PorkbunClient, name: string, rawArgs: unknown): Promise<unknown> {
  if (!(name in tools)) throw new Error(`Unknown tool: ${name}`);
  const tool = tools[name as ToolName];
  const args = tool.inputSchema.parse(rawArgs ?? {}) as Record<string, any>;

  switch (name as ToolName) {
    case "ping":
      return client.request("ping");

    case "list_domains":
      return client.request("domain/listAll", {
        body: compact({
          start: args.start !== undefined ? String(args.start) : undefined,
          includeLabels: args.includeLabels ? "yes" : undefined,
        }),
      });

    case "get_nameservers":
      return client.request(`domain/getNs/${enc(args.domain)}`);

    case "update_nameservers":
      requireConfirm(args, "Updating nameservers");
      return client.request(`domain/updateNs/${enc(args.domain)}`, { body: { ns: args.ns } });

    case "list_dns_records": {
      const suffix = args.id !== undefined ? `/${enc(args.id)}` : "";
      return client.request(`dns/retrieve/${enc(args.domain)}${suffix}`);
    }

    case "get_dns_records_by_name_type": {
      const sub = args.subdomain ? `/${enc(args.subdomain)}` : "";
      return client.request(`dns/retrieveByNameType/${enc(args.domain)}/${enc(args.type)}${sub}`);
    }

    case "create_dns_record":
      requireConfirm(args, "Creating a DNS record");
      return client.request(`dns/create/${enc(args.domain)}`, {
        body: compact({
          name: args.name,
          type: args.type,
          content: args.content,
          ttl: args.ttl !== undefined ? String(args.ttl) : undefined,
          prio: args.prio !== undefined ? String(args.prio) : undefined,
          notes: args.notes,
        }),
      });

    case "edit_dns_record":
      requireConfirm(args, "Editing a DNS record");
      return client.request(`dns/edit/${enc(args.domain)}/${enc(args.id)}`, {
        body: compact({
          name: args.name,
          type: args.type,
          content: args.content,
          ttl: args.ttl !== undefined ? String(args.ttl) : undefined,
          prio: args.prio !== undefined ? String(args.prio) : undefined,
          notes: args.notes,
        }),
      });

    case "delete_dns_record":
      requireConfirm(args, "Deleting a DNS record");
      return client.request(`dns/delete/${enc(args.domain)}/${enc(args.id)}`);

    case "list_url_forwards":
      return client.request(`domain/getUrlForwarding/${enc(args.domain)}`);

    case "add_url_forward":
      requireConfirm(args, "Adding a URL forward");
      return client.request(`domain/addUrlForward/${enc(args.domain)}`, {
        body: compact({
          subdomain: args.subdomain ?? "",
          location: args.location,
          type: args.type,
          includePath: yesNo(args.includePath),
          wildcard: yesNo(args.wildcard),
        }),
      });

    case "delete_url_forward":
      requireConfirm(args, "Deleting a URL forward");
      return client.request(`domain/deleteUrlForward/${enc(args.domain)}/${enc(args.id)}`);

    case "check_domain":
      return client.request(`domain/checkDomain/${enc(args.domain)}`);

    case "get_pricing":
      return client.request("pricing/get");

    case "porkbun_request":
      if (rawPathIsMutating(args.path)) requireConfirm(args, `Calling mutating path ${args.path}`);
      return client.request(args.path, { body: args.body });
  }
}
