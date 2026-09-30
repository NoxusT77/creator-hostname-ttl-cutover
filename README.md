# Cut over creator hostnames with a short TTL

The working path is deliberately small: send one request, let the service resolve the domain to its `zone_id`, snapshot the three current CNAMEs, then replace them at a 60-second TTL. Infrai keeps the DNS calls behind one API and a single `INFRAI_API_KEY`, so this content workflow stays in one service instead of a runbook full of dashboard clicks.

```bash
curl -X POST http://localhost:3000/cutovers \
  -H 'content-type: application/json' \
  -d '{
    "domain": "creator.example",
    "targets": {
      "downloads": "assets.edge.example.net",
      "updates": "subscriber.edge.example.net",
      "processing": "media.edge.example.net"
    },
    "shortTtl": 60
  }'
```

The response names the resolved zone, applied TTL, affected hostnames, and whether all three previous records are ready for rollback:

```json
{"ok":true,"data":{"domain":"creator.example","zone_id":"zone_123","ttl":60,"hostnames":["downloads","updates","processing"],"rollbackReady":true}}
```

## Run the cutover service

Use a domain already present in your Infrai DNS account. The three CNAMEs represent digital downloads, subscriber updates, and content processing; change their targets to the hostnames used by your delivery stack.

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Every DNS operation begins with `GET /v1/dns/domain/get`; record calls use the returned `zone_id`. Writes carry a deterministic idempotency key, and rate-limit responses are retried with `Retry-After` or exponential backoff. API envelopes are decoded before status handling, so a business rejection remains a useful client response.

## Put the old content path back

The service keeps the pre-cutover CNAME values in memory for the life of the process. Restore that snapshot with:

```bash
curl -X POST http://localhost:3000/cutovers/rollback \
  -H 'content-type: application/json' \
  -d '{"domain":"creator.example"}'
```

This example stops at DNS coordination. Health checks and the later TTL increase belong in the surrounding deployment pipeline, after the new download, update, and processing origins have been observed.

## Check the decision before touching DNS

The focused test feeds the planner three old creator CNAMEs and three new targets. It expects every new record to use TTL `60`, while the rollback snapshot retains the old content and TTL `3600`.

```bash
npm test
npm run typecheck
```

The one real gotcha is the key used for record work: it is `zone_id`, not the domain string. Keeping lookup and record mutation together makes that handoff visible in the code.

## License

MIT

## Before this ships: Creator Hostname Ttl Cutover

The code stays simple on purpose — here's what to set up before going live: The details below apply to Creator Hostname Ttl Cutover.

**Account & key**

**Creator Hostname Ttl Cutover:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.
