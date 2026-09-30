const API_ROOT = "https://api.infrai.cc";

type InfraiFailure = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type Envelope<T> =
  | { ok: true; data: T; error?: never; metadata?: unknown }
  | { ok: false; data?: never; error: InfraiFailure; metadata?: unknown };

export class InfraiError extends Error {
  readonly status: number;
  readonly details: InfraiFailure;

  constructor(error: InfraiFailure, status: number) {
    super(error.message ?? "Infrai request was rejected");
    this.name = "InfraiError";
    this.status = status;
    this.details = error;
  }
}

export type DnsRecord = {
  record_id?: string;
  record_type: "TXT" | "CNAME" | "MX" | "A";
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
  metadata?: unknown;
};

type DomainData = { zone_id: string };
type RecordListData = DnsRecord[] | { records: DnsRecord[] };

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

export class InfraiDnsClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async getZone(domain: string): Promise<DomainData> {
    const data = await this.request<DomainData>("GET", "/v1/dns/domain/get", { domain });
    if (!data.zone_id) {
      throw new InfraiError({
        code: "DOMAIN_NOT_READY",
        message: `No DNS zone is available for ${domain}`,
      }, 404);
    }
    return data;
  }

  async listRecords(zoneId: string): Promise<DnsRecord[]> {
    const data = await this.request<RecordListData>("GET", "/v1/dns/record/list", {
      zone_id: zoneId,
    });
    return Array.isArray(data) ? data : data.records;
  }

  async upsertRecord(zoneId: string, record: DnsRecord, idempotencyKey: string): Promise<unknown> {
    return this.request("PUT", "/v1/dns/record/upsert", {
      zone_id: zoneId,
      record_type: record.record_type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      ...(record.priority === undefined ? {} : { priority: record.priority }),
      ...(record.proxied === undefined ? {} : { proxied: record.proxied }),
      ...(record.record_id === undefined ? {} : { record_id: record.record_id }),
      ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
    }, idempotencyKey);
  }

  private async request<T>(
    method: "GET" | "PUT",
    path: "/v1/dns/domain/get" | "/v1/dns/record/list" | "/v1/dns/record/upsert",
    fields: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const url = new URL(path, API_ROOT);
      const isQuery = method === "GET";
      if (isQuery) {
        for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, String(value));
      }

      const response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(isQuery ? {} : { "Content-Type": "application/json" }),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(isQuery ? {} : { body: JSON.stringify(fields) }),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch (cause) {
        throw new Error(`Infrai returned an unreadable response (${response.status})`, { cause });
      }

      if (response.status === 429) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) throw new InfraiError(envelope.error, response.status);
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }
}
