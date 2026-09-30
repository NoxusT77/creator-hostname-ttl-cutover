import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { CUTOVER_NAMES, idempotencyKey, planCreatorCutover } from "./creator_cutover.js";
import { InfraiDnsClient, InfraiError, type DnsRecord } from "./infrai_dns.js";

const requestSchema = z.object({
  domain: z.string().min(1),
  targets: z.object({
    downloads: z.string().min(1),
    updates: z.string().min(1),
    processing: z.string().min(1),
  }),
  shortTtl: z.number().int().min(30).max(300).default(60),
});

type CutoverRequest = z.infer<typeof requestSchema>;
type SavedCutover = { zoneId: string; rollback: DnsRecord[] };
const saved = new Map<string, SavedCutover>();

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: AsyncIterable<Buffer | string>): Promise<unknown> {
  let body = "";
  for await (const chunk of request) body += chunk.toString();
  return JSON.parse(body);
}

async function applyCutover(client: InfraiDnsClient, input: CutoverRequest) {
  const { zone_id: zoneId } = await client.getZone(input.domain);
  const current = await client.listRecords(zoneId);
  const plan = planCreatorCutover(input.targets, current, input.shortTtl);
  await Promise.all(plan.apply.map((record) =>
    client.upsertRecord(zoneId, record, idempotencyKey(input.domain, "apply", record)),
  ));
  saved.set(input.domain, { zoneId, rollback: plan.rollback });
  return {
    domain: input.domain,
    zone_id: zoneId,
    ttl: input.shortTtl,
    hostnames: CUTOVER_NAMES,
    rollbackReady: plan.rollback.length === CUTOVER_NAMES.length,
  };
}

async function rollbackCutover(client: InfraiDnsClient, domain: string) {
  const snapshot = saved.get(domain);
  if (!snapshot) return null;
  await Promise.all(snapshot.rollback.map((record) =>
    client.upsertRecord(snapshot.zoneId, record, idempotencyKey(domain, "rollback", record)),
  ));
  saved.delete(domain);
  return { domain, zone_id: snapshot.zoneId, restored: snapshot.rollback.map(({ name }) => name) };
}

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const client = new InfraiDnsClient(apiKey);

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/cutovers") {
      const parsed = requestSchema.safeParse(await readBody(request));
      if (!parsed.success) return json(response, 400, { ok: false, issues: parsed.error.issues });
      return json(response, 200, { ok: true, data: await applyCutover(client, parsed.data) });
    }

    if (request.method === "POST" && request.url === "/cutovers/rollback") {
      const parsed = z.object({ domain: z.string().min(1) }).safeParse(await readBody(request));
      if (!parsed.success) return json(response, 400, { ok: false, issues: parsed.error.issues });
      const result = await rollbackCutover(client, parsed.data.domain);
      return result
        ? json(response, 200, { ok: true, data: result })
        : json(response, 404, { ok: false, error: "No saved cutover for this domain" });
    }

    return json(response, 404, { ok: false, error: "Route not found" });
  } catch (error) {
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { ok: false, error: error.details });
    }
    return json(response, 500, { ok: false, error: "Request could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Creator hostname cutover service listening on http://localhost:${port}`));
