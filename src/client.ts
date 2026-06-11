import { execFileSync } from "node:child_process";
import os from "node:os";

export type PorkbunSecretName = "key" | "secret";

export interface PorkbunClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  readSecret?: (name: PorkbunSecretName) => Promise<string> | string;
}

export interface RequestOptions {
  /**
   * Extra JSON body fields merged with the auth credentials. Porkbun is a
   * POST-only JSON API: every call carries `{ apikey, secretapikey, ...body }`.
   */
  body?: Record<string, unknown>;
}

/** The one place the API base lives. Override with PORKBUN_BASE_URL for testing. */
const DEFAULT_BASE_URL = process.env.PORKBUN_BASE_URL || "https://api.porkbun.com/api/json/v3";

const KEYCHAIN_SERVICES: Record<PorkbunSecretName, string> = {
  key: "porkbun-api-key",
  secret: "porkbun-api-secret",
};

const ENV_NAMES: Record<PorkbunSecretName, string> = {
  key: "PORKBUN_API_KEY",
  secret: "PORKBUN_API_SECRET",
};

// Turnkey for anyone: the Keychain account is the current OS user, never hardcoded.
const KEYCHAIN_ACCOUNT = process.env.PORKBUN_KEYCHAIN_ACCOUNT || process.env.USER || os.userInfo().username;

export async function readPorkbunSecret(name: PorkbunSecretName): Promise<string> {
  const fromEnv = process.env[ENV_NAMES[name]];
  if (fromEnv) return fromEnv;

  if (process.platform === "darwin") {
    try {
      const value = execFileSync(
        "security",
        ["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICES[name], "-w"],
        { stdio: ["ignore", "pipe", "ignore"] },
      )
        .toString()
        .trim();
      if (value) return value;
    } catch {
      // Fall through to setup guidance below.
    }
  }

  throw new Error(
    `${ENV_NAMES[name]} is not set and macOS Keychain service '${KEYCHAIN_SERVICES[name]}' was not found. Add it with: security add-generic-password -U -a ${KEYCHAIN_ACCOUNT} -s ${KEYCHAIN_SERVICES[name]} -w <value>`,
  );
}

/**
 * Pull a human-readable message out of a Porkbun error body WITHOUT ever
 * echoing the request (which contains the credentials).
 */
function errorMessageFromBody(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { message?: unknown; status?: unknown };
    if (typeof parsed.message === "string" && parsed.message) return parsed.message;
    return body;
  } catch {
    return body;
  }
}

export class PorkbunClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly secretReader: (name: PorkbunSecretName) => Promise<string> | string;

  constructor(options: PorkbunClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.secretReader = options.readSecret ?? readPorkbunSecret;
  }

  /**
   * Porkbun's API is uniformly `POST {base}/{path}` with the credentials in the
   * JSON body. `path` should NOT have a leading slash (e.g. "ping",
   * "dns/retrieve/example.com").
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const normalizedPath = path.replace(/^\//, "");
    const url = `${this.baseUrl}/${normalizedPath}`;

    const [apikey, secretapikey] = await Promise.all([this.secretReader("key"), this.secretReader("secret")]);
    const payload = {
      apikey,
      secretapikey,
      ...(options.body ?? {}),
    };

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Porkbun API POST /${normalizedPath} failed (${response.status}): ${errorMessageFromBody(text)}`);
    }

    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Porkbun API POST /${normalizedPath} returned non-JSON response.`);
      }
    }

    // Porkbun signals app-level failures with HTTP 200 + {"status":"ERROR","message":...}.
    const status = (parsed as { status?: unknown }).status;
    if (status === "ERROR") {
      const message = (parsed as { message?: unknown }).message;
      throw new Error(`Porkbun API POST /${normalizedPath} returned ERROR: ${typeof message === "string" ? message : "unknown error"}`);
    }

    return parsed as T;
  }
}
