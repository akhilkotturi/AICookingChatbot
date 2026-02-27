# AI Cooking Chatbot

An AI Powered Chatbot that helps you with various cooking-related questions.

---

## Getting Started Locally

### Backend

First, copy the example env file and plug in your API key:

```bash
cp backend/.env.example backend/.env
# open .env and set GROQ_API_KEY=your_actual_key
```

Then install dependencies and start the server:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The backend will be running at `http://localhost:8000`.

### Frontend

```bash
cd frontend
bun install   # or: npm install
bun run dev   # or: npm run dev
```

The frontend will be at `http://localhost:3000`. If your backend is running somewhere other than `http://localhost:8000`, set the `NEXT_PUBLIC_API_URL` env variable to point to it.

---

## Running with Docker

Prefer Docker? Just run:

```bash
docker compose up --build
```

Both services will come up:
- Frontend → `http://localhost:3000`
- Backend → `http://localhost:8000`

> **Heads up:** `NEXT_PUBLIC_API_URL` gets baked into the frontend bundle at build time. `http://localhost:8000` is the right value here — your browser talks to the backend through the host port mapping, not Docker's internal network.

---

## Trying It Out (curl Examples)

### Basic query

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"query":"What can I cook with eggs, tomatoes, and onions?"}'
```

### With debug info

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"query":"How do I make shakshuka?", "debug": true}'
```

### Streaming (SSE)

```bash
curl -N -X POST http://localhost:8000/query/stream \
  -H "Content-Type: application/json" \
  -d '{"query":"Give me a quick pasta recipe", "debug": true}'
```

---

## Known Limitations & Future Ideas

A few rough edges to be aware of:

- The LLM classifier occasionally returns unexpected labels — "cooking" turns out to be a surprisingly fuzzy concept.
- Cookware extraction can miss unusual tool names or over-eagerly extract generic ones.
- No chat persistence yet — conversation history only lives in frontend state for the current session.
- Ingredient queries don't currently trigger cookware validation (only recipe requests do). A nice future improvement would be to extend that validation to any recipe suggested in an ingredient response.
- Non-English queries aren't explicitly handled. The LLM might do fine, but the classification prompts are English-only.
- There's no memory pruning for long conversations — each query is processed independently without prior context.

---

## Deploying to AWS

Here's how I'd approach a production deployment:

### Compute

**ECS Fargate** is the natural fit for both services — no EC2 instances to babysit, and it scales at the task level.

- The FastAPI backend runs as a Fargate service behind an **Application Load Balancer (ALB)**.
- The Next.js frontend can go to **Vercel** (zero-ops, easiest path) or run as a second Fargate service behind **CloudFront** for static asset caching.
- Each service gets its own ECS Task Definition with CPU and memory tuned to what it actually needs.

### Networking

- VPC with **public subnets** for the ALB and **private subnets** for ECS tasks.
- A **NAT Gateway** in each AZ lets private tasks reach external APIs (Groq, DuckDuckGo) without being directly exposed to the internet.
- ALB listener rules route `/api/*` to the backend and everything else to the frontend.
- Security groups keep it tight: ALB accepts 443 from anywhere; ECS tasks only accept traffic from the ALB.

### Secrets

- `GROQ_API_KEY` and any future secrets live in **AWS Secrets Manager**.
- ECS Task Definitions reference them by ARN — the container gets them as environment variables at startup. Nothing sensitive ever touches source code or Docker images.
- IAM task execution roles follow least-privilege: each service only gets access to the secrets it needs.

### Observability

- **CloudWatch Logs** — uvicorn and Next.js logs are shipped via the `awslogs` driver. Logging currently uses a plain-text format; switching to structured JSON (e.g. with `python-json-logger`) would make CloudWatch filtering and metric extraction much easier and is a quick win.
- **CloudWatch Container Insights** — CPU, memory, and network metrics per ECS service.
- **AWS X-Ray** (future) — instrument FastAPI for distributed tracing across LangGraph nodes and tool calls.
- **CloudWatch Alarms** — alert on high 5xx rates, LLM latency spikes, and ECS crash-loops.

### Scaling

- ECS **Service Auto Scaling** using target tracking on ALB `RequestCountPerTarget`.
- Backend scales between a floor of 1 and a configurable ceiling — though Groq's rate limits are the practical bottleneck before horizontal scaling becomes the answer.
- CloudFront absorbs frontend traffic spikes without touching the ECS layer at all.

---

## Auth & Security

### API Authentication

- Short-lived **JWT tokens** issued by an auth service (Amazon Cognito or a custom `/auth/token` endpoint).
- FastAPI middleware validates the JWT on every request using `python-jose`; unauthenticated requests get a clean `401`.
- For machine-to-machine use, **API keys** passed via the `X-API-Key` header, validated against a hashed store in DynamoDB or Secrets Manager.

### CORS

- In production, swap out `allow_origins=["*"]` for an explicit allowlist of your actual frontend origins (e.g. `https://app.yourdomain.com`).
- The ALB handles HTTPS termination and HTTP redirects, so TLS doesn't need to be managed at the app level.

### Rate Limiting

- **`slowapi`** middleware to enforce per-IP and per-user quotas (e.g. 20 requests/minute) — keeps abuse from burning through LLM budget.
- ALB WAF rules add a second layer of DDoS and bot protection.

### Input Validation

- Pydantic already handles schema validation. On top of that:
  - Enforce a max query length (e.g. 1,000 characters) to cap token costs.
  - Strip whitespace and reject queries that are purely whitespace.

### Prompt Injection

- The recipe and ingredient handler nodes use LangChain's `HumanMessage` / `ToolMessage` structure to keep user content and tool results separate. The classification nodes still use `PromptTemplate` string interpolation — a future improvement would be to move those to a proper `SystemMessage` + `HumanMessage` split as well.
- The system prompt explicitly instructs the model to ignore override attempts.
- Queries matching known injection patterns (e.g. "ignore previous instructions") get flagged and logged for review.

### Secrets

- `.env` is gitignored; `.env.example` only has placeholders.
- In production, secrets are pulled from AWS Secrets Manager at container startup — never baked into images.
- Rotate `GROQ_API_KEY` regularly; Secrets Manager supports automatic rotation.

---

## Analytics Pipeline (Bonus)

To give stakeholders a window into what people are actually cooking, here's how I'd build a lightweight ELT pipeline.

### Extract

The backend currently logs node transitions and tool calls to stdout in plain text. To make this pipeline work cleanly, I'd swap in structured JSON logging (e.g. `python-json-logger`) so each completed query emits an event like:

```json
{
  "timestamp": "2025-01-01T12:00:00Z",
  "query": "How do I make shakshuka?",
  "question_type": "recipe_request",
  "cookware_in_use": ["Frying Pan", "Spatula"],
  "missing_cookware": [],
  "scope": "in_scope"
}
```

In production, ECS ships these to CloudWatch Logs via the `awslogs` driver.

### Transform & Load

- **Amazon Kinesis Data Firehose** subscribes to the log group and buffers events to **S3** (raw zone) in JSON-lines format.
- An **AWS Glue** job (or dbt on Athena) runs hourly to parse, normalize, and deduplicate raw events, writing clean records to a processed S3 prefix partitioned by date.
- **Amazon Athena** (or Redshift Serverless for higher volume) serves as the query layer — no infrastructure to manage.

### Visualize

**Amazon QuickSight** dashboards for stakeholders:
- Most requested recipes
- Most common missing cookware (great for identifying content gaps)
- In-scope vs. out-of-scope query ratio over time
- Peak usage hours

### Simpler Alternative

For a low-traffic MVP, skip Kinesis entirely — **CloudWatch Logs Insights** can produce ad-hoc reports directly until the volume warrants a full pipeline.

---

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| LLM provider | Groq + LLaMA 3.3 70B | Sub-second TTFT, free tier, and swappable via LangChain |
| LangChain | All LLM calls via `langchain-groq` / `langchain-core` | No raw SDK calls; portable if provider changes |
| Graph design | `StateGraph` with explicit nodes + conditional edges | Predictable and debuggable vs. a fully autonomous ReAct agent |
| Tool invocation | `llm.bind_tools([search])` | LLM decides at runtime via structured output — satisfies the agentic requirement |
| Search tool | DuckDuckGo | No API key needed; works fine for cooking queries |
| Streaming | SSE via `sse-starlette`; chunked post-generation | True token streaming adds complexity; chunking delivers the right UX feel for the timebox |
| Frontend | Next.js App Router + Tailwind + shadcn/ui | Matches the spec; shadcn components are locally copied so no extra runtime dependency |

---

## Timeboxing Notes

Around 3 hrs
(2hrs backend)
(1hr frontend)

### What I prioritized

1. LangGraph backbone 
2. FastAPI endpoints (`/query`, `/query/stream`)
3. SSE streaming end-to-end
4. Next.js frontend with live streaming UI
5. Docker + docker-compose
6. README and docs

### Things left out

- **Unit tests** — skipped for time; `classify_scope` and `check_cookware` are the highest-value targets for a first test suite.
- **CI pipeline** — no GitHub Actions yet; would add Ruff + ESLint lint and test jobs on push.
- **Generated TypeScript types** — frontend types in `lib/api.ts` are hand-written; `openapi-typescript` could automate this.
- **Multi-turn memory** — each query is stateless for now; `ConversationBufferMemory` or a Redis-backed store would unlock follow-up questions.
- **True token streaming** — Groq supports async streaming but the current SSE implementation buffers the full response and chunks the string. Simpler, but not real token streaming.
- **Auth** — no auth layer yet; the full plan is described above.
