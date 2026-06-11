import { describe, expect, test, vi } from "vitest";
import { callTool, toolDefinitions } from "../src/tools.js";

function makeClient() {
  return {
    request: vi.fn(async (_path: string, _options?: unknown) => ({ status: "SUCCESS" })),
  };
}

describe("Porkbun MCP tool definitions", () => {
  test("exposes the expected named tools", () => {
    const names = toolDefinitions().map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_url_forward",
        "check_domain",
        "create_dns_record",
        "delete_dns_record",
        "delete_url_forward",
        "edit_dns_record",
        "get_dns_records_by_name_type",
        "get_nameservers",
        "get_pricing",
        "list_dns_records",
        "list_domains",
        "list_url_forwards",
        "ping",
        "porkbun_request",
        "update_nameservers",
      ].sort(),
    );
  });

  test("marks read tools read-only and write tools destructive", () => {
    const defs = Object.fromEntries(toolDefinitions().map((t) => [t.name, t.annotations]));
    expect(defs.ping.readOnlyHint).toBe(true);
    expect(defs.list_dns_records.readOnlyHint).toBe(true);
    expect(defs.create_dns_record.destructiveHint).toBe(true);
    expect(defs.update_nameservers.destructiveHint).toBe(true);
    expect(defs.delete_url_forward.destructiveHint).toBe(true);
  });
});

describe("Porkbun MCP tools (read)", () => {
  test("ping hits the ping path with no body", async () => {
    const client = makeClient();
    await callTool(client, "ping", {});
    expect(client.request).toHaveBeenCalledWith("ping");
  });

  test("list_dns_records retrieves all records for a domain", async () => {
    const client = makeClient();
    await callTool(client, "list_dns_records", { domain: "example.com" });
    expect(client.request).toHaveBeenCalledWith("dns/retrieve/example.com");
  });

  test("list_dns_records appends the id when given", async () => {
    const client = makeClient();
    await callTool(client, "list_dns_records", { domain: "example.com", id: 12345 });
    expect(client.request).toHaveBeenCalledWith("dns/retrieve/example.com/12345");
  });

  test("get_dns_records_by_name_type builds the type+subdomain path", async () => {
    const client = makeClient();
    await callTool(client, "get_dns_records_by_name_type", { domain: "example.com", type: "A", subdomain: "www" });
    expect(client.request).toHaveBeenCalledWith("dns/retrieveByNameType/example.com/A/www");
  });

  test("get_dns_records_by_name_type omits the subdomain for apex", async () => {
    const client = makeClient();
    await callTool(client, "get_dns_records_by_name_type", { domain: "example.com", type: "TXT" });
    expect(client.request).toHaveBeenCalledWith("dns/retrieveByNameType/example.com/TXT");
  });

  test("get_nameservers hits domain/getNs", async () => {
    const client = makeClient();
    await callTool(client, "get_nameservers", { domain: "example.com" });
    expect(client.request).toHaveBeenCalledWith("domain/getNs/example.com");
  });

  test("list_domains posts to domain/listAll", async () => {
    const client = makeClient();
    await callTool(client, "list_domains", { start: 0, includeLabels: true });
    expect(client.request).toHaveBeenCalledWith("domain/listAll", { body: { start: "0", includeLabels: "yes" } });
  });

  test("check_domain hits domain/checkDomain", async () => {
    const client = makeClient();
    await callTool(client, "check_domain", { domain: "example.com" });
    expect(client.request).toHaveBeenCalledWith("domain/checkDomain/example.com");
  });

  test("get_pricing hits pricing/get", async () => {
    const client = makeClient();
    await callTool(client, "get_pricing", {});
    expect(client.request).toHaveBeenCalledWith("pricing/get");
  });

  test("list_url_forwards hits domain/getUrlForwarding", async () => {
    const client = makeClient();
    await callTool(client, "list_url_forwards", { domain: "example.com" });
    expect(client.request).toHaveBeenCalledWith("domain/getUrlForwarding/example.com");
  });
});

describe("Porkbun MCP tools (write require confirm)", () => {
  test("create_dns_record refuses without confirm", async () => {
    const client = makeClient();
    await expect(
      callTool(client, "create_dns_record", { domain: "example.com", type: "A", content: "1.2.3.4", name: "www" }),
    ).rejects.toThrow("confirm");
    expect(client.request).not.toHaveBeenCalled();
  });

  test("create_dns_record posts a compact body when confirmed", async () => {
    const client = makeClient();
    await callTool(client, "create_dns_record", {
      domain: "example.com",
      type: "A",
      content: "1.2.3.4",
      name: "www",
      ttl: 600,
      confirm: true,
    });
    expect(client.request).toHaveBeenCalledWith("dns/create/example.com", {
      body: { name: "www", type: "A", content: "1.2.3.4", ttl: "600" },
    });
  });

  test("edit_dns_record targets the record id when confirmed", async () => {
    const client = makeClient();
    await callTool(client, "edit_dns_record", {
      domain: "example.com",
      id: "98765",
      type: "CNAME",
      content: "target.example.com",
      name: "alias",
      confirm: true,
    });
    expect(client.request).toHaveBeenCalledWith("dns/edit/example.com/98765", {
      body: { name: "alias", type: "CNAME", content: "target.example.com" },
    });
  });

  test("delete_dns_record refuses without confirm", async () => {
    const client = makeClient();
    await expect(callTool(client, "delete_dns_record", { domain: "example.com", id: 1 })).rejects.toThrow("confirm");
    expect(client.request).not.toHaveBeenCalled();
  });

  test("delete_dns_record hits dns/delete with id when confirmed", async () => {
    const client = makeClient();
    await callTool(client, "delete_dns_record", { domain: "example.com", id: 1, confirm: true });
    expect(client.request).toHaveBeenCalledWith("dns/delete/example.com/1");
  });

  test("update_nameservers sends the ns array only when confirmed", async () => {
    const client = makeClient();
    await callTool(client, "update_nameservers", {
      domain: "example.com",
      ns: ["curitiba.ns.porkbun.com", "fortaleza.ns.porkbun.com"],
      confirm: true,
    });
    expect(client.request).toHaveBeenCalledWith("domain/updateNs/example.com", {
      body: { ns: ["curitiba.ns.porkbun.com", "fortaleza.ns.porkbun.com"] },
    });
  });

  test("add_url_forward encodes booleans as yes/no and defaults subdomain to apex", async () => {
    const client = makeClient();
    await callTool(client, "add_url_forward", {
      domain: "example.com",
      location: "https://example.com/",
      type: "permanent",
      includePath: true,
      confirm: true,
    });
    expect(client.request).toHaveBeenCalledWith("domain/addUrlForward/example.com", {
      body: { subdomain: "", location: "https://example.com/", type: "permanent", includePath: "yes", wildcard: "no" },
    });
  });

  test("delete_url_forward refuses without confirm", async () => {
    const client = makeClient();
    await expect(callTool(client, "delete_url_forward", { domain: "example.com", id: 5 })).rejects.toThrow("confirm");
    expect(client.request).not.toHaveBeenCalled();
  });
});

describe("porkbun_request escape hatch", () => {
  test("passes a read path straight through", async () => {
    const client = makeClient();
    await callTool(client, "porkbun_request", { path: "ssl/retrieve/example.com" });
    expect(client.request).toHaveBeenCalledWith("ssl/retrieve/example.com", { body: undefined });
  });

  test("requires confirm for a mutating path", async () => {
    const client = makeClient();
    await expect(callTool(client, "porkbun_request", { path: "dns/delete/example.com/1" })).rejects.toThrow("confirm");
    expect(client.request).not.toHaveBeenCalled();
  });

  test("allows a mutating path when confirmed", async () => {
    const client = makeClient();
    await callTool(client, "porkbun_request", { path: "dns/delete/example.com/1", confirm: true });
    expect(client.request).toHaveBeenCalledWith("dns/delete/example.com/1", { body: undefined });
  });
});

describe("input validation", () => {
  test("rejects an invalid domain", async () => {
    const client = makeClient();
    await expect(callTool(client, "get_nameservers", { domain: "not a domain" })).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  test("rejects an unknown tool", async () => {
    const client = makeClient();
    await expect(callTool(client, "nonexistent_tool", {})).rejects.toThrow("Unknown tool");
  });
});
