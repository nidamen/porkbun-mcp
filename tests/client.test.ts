import { beforeEach, describe, expect, test, vi } from "vitest";
import { PorkbunClient } from "../src/client.js";

const secrets = {
  key: "api-key-123",
  secret: "api-secret-456",
};

function makeClient(fetchMock: typeof fetch) {
  return new PorkbunClient({
    baseUrl: "https://api.porkbun.com/api/json/v3",
    fetch: fetchMock,
    readSecret: async (name) => secrets[name],
  });
}

describe("PorkbunClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("POSTs to the v3 base with credentials injected into the JSON body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "SUCCESS", yourIp: "203.0.113.7" }), { status: 200 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    const result = await client.request("ping");

    expect(result).toEqual({ status: "SUCCESS", yourIp: "203.0.113.7" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.porkbun.com/api/json/v3/ping");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(JSON.parse(init.body as string)).toEqual({ apikey: "api-key-123", secretapikey: "api-secret-456" });
  });

  test("merges extra body fields with the auth credentials", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "SUCCESS", id: "9999" }), { status: 200 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await client.request("dns/create/example.com", { body: { name: "www", type: "A", content: "1.2.3.4" } });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      apikey: "api-key-123",
      secretapikey: "api-secret-456",
      name: "www",
      type: "A",
      content: "1.2.3.4",
    });
  });

  test("strips a leading slash from the path", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "SUCCESS" }), { status: 200 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await client.request("/ping");

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.porkbun.com/api/json/v3/ping");
  });

  test("treats HTTP-200 status:ERROR as a failure (Porkbun's app-level error shape)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "ERROR", message: "All hosts are valid for this domain" }), { status: 200 }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await expect(client.request("dns/retrieve/example.com")).rejects.toThrow("returned ERROR: All hosts are valid for this domain");
  });

  test("surfaces HTTP errors without leaking the credentials in the message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ERROR", message: "Invalid API key." }), { status: 400 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await expect(client.request("ping")).rejects.toThrow("Porkbun API POST /ping failed (400): Invalid API key.");
    await expect(client.request("ping")).rejects.not.toThrow("api-secret-456");
  });

  test("returns an empty object for an empty body", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    const result = await client.request("ping");
    expect(result).toEqual({});
  });
});
