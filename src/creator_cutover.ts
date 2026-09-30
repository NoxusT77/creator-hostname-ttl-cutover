import type { DnsRecord } from "./infrai_dns.js";

export const CUTOVER_NAMES = ["downloads", "updates", "processing"] as const;
export type CutoverName = (typeof CUTOVER_NAMES)[number];

export type CreatorTargets = Record<CutoverName, string>;

export type CutoverPlan = {
  apply: DnsRecord[];
  rollback: DnsRecord[];
};

export function planCreatorCutover(
  targets: CreatorTargets,
  currentRecords: DnsRecord[],
  shortTtl: number,
): CutoverPlan {
  const apply = CUTOVER_NAMES.map((name) => ({
    record_type: "CNAME" as const,
    name,
    content: targets[name],
    ttl: shortTtl,
    metadata: { workflow: "creator-hostname-cutover", channel: name },
  }));

  const rollback = CUTOVER_NAMES.map((name) =>
    currentRecords.find((record) => record.record_type === "CNAME" && record.name === name),
  ).filter((record): record is DnsRecord => record !== undefined);

  return { apply, rollback };
}

export function idempotencyKey(domain: string, phase: "apply" | "rollback", record: DnsRecord): string {
  return `creator-cutover:${domain}:${phase}:${record.name}:${record.content}:${record.ttl ?? "default"}`;
}
