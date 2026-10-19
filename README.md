# Train Ticket Graph Query

Implemented in TypeScript with Express and a small React frontend. The assignment prefers TypeScript; Express and React are my choices. The UI uses Cytoscape.js to render the graph and highlight individual routes.

## Quick start

Requires Node.js 24 or later. From the project directory:

```sh
npm ci
npm run dev
```

This starts the API and frontend together. Open [localhost:3000](http://localhost:3000). No database or external services are needed. If port 3000 is busy, use `PORT=3001 npm run dev` and open [localhost:3001](http://localhost:3001).

Frontend changes reload automatically; restart after backend changes. Node runs the backend TypeScript directly.

Use Basic mode for the three preset filters or Advanced mode to edit a JSON query. Choose a matching route to highlight it.

## Scope and assumptions

This implementation targets the supplied dataset:

- **Known input.** I treat the file as trusted local data with the inspected structure. The loader handles its mixed `to` format and missing assurance node, without a general-purpose dataset validator.
- **Graph structure.** The supplied JSON has no cycles, self-loops, duplicate node names, or duplicate edges. I rely on these facts and omit cycle handling, duplicate checks, and input-edge deduplication.
- **Scale.** I assume a small, static graph and few concurrent requests, so I precompute all routes at startup.

I would review these assumptions before changing the dataset. The API validates requests, and file-loading failures stop startup with a clear error.

## Assignment requirements

Along with the JSON dataset, the assignment includes a system graph image and links to the [Train Ticket GitHub repository](https://github.com/FudanSELab/train-ticket).

The brief asks me to:

- Load the supplied JSON into a basic query engine.
- Provide a RESTful API that returns a graph the frontend can render.
- Support filters for routes that start at a public service (`publicExposed: true`), end at a “Sink (rds/sql),” or contain a vulnerable node.
- Make additional filters easy to add.
- Provide the implementation in a repository, with a short README explaining decisions and assumptions.

The brief describes the input as a full, working graph. It does not define what counts as a route, how filters combine, or how the API and storage should work. It also gives no scale requirements.

## Evidence: supplied data and external sources

**JSON facts.** The [supplied file](<train-ticket-be (1).json>) contains 46 node records and 27 edge records that expand to 98 directed connections. The graph has no cycles.

- `assurance-service` is referenced twice but has no node definition.
- Only `consign-service → consign-price-service` uses a string for `to`; the other 26 edge records use arrays.
- Five nodes have no connections: `avatar-service`, `gateway-service`, `news-service`, `ticket-office-service`, and `ui-dashboard`.
- Two vulnerability messages describe SQL injection but are labeled CWE-22 (path traversal).

**External comparison.** “Upstream” means the original [Train Ticket repository](https://github.com/FudanSELab/train-ticket/tree/313886e99befb94be6cd45f085c98e0019f59829). The references below use commit `313886e99befb94be6cd45f085c98e0019f59829` and its [architecture diagram](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/image/2.png).

| Topic | Observed in the JSON | External evidence |
| --- | --- | --- |
| Assurance | Both preserve services reference `assurance-service`, but its node definition is missing. | The diagram includes assurance. Both [preserve](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-preserve-service/src/main/java/preserve/service/PreserveServiceImpl.java#L316-L324) and [preserve-other](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-preserve-other-service/src/main/java/preserveOther/service/PreserveOtherServiceImpl.java#L317-L326) call it. |
| Public entry points | `frontend` connects only to `admin-basic-info-service`; `gateway-service` has no connections. Neither public node reaches a vulnerable node or database. | The diagram connects frontend to gateway. The [UI proxy](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-ui-dashboard/nginx.conf#L40-L42) and [gateway configuration](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-gateway-service/src/main/resources/application.yml) route requests through gateway to many services. |
| Omitted services | Delivery and voucher are missing; `food-delivery-service` is present. | The diagram and repository include voucher and show delivery and food-delivery as separate services. |
| Relationships | Wait-order points to order and contacts. There is no recorded connection between the route and station services. | The diagram connects wait-order to preserve/other; the [wait-order code](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-wait-order-service/src/main/java/waitorder/utils/PollThread.java) calls preserve. The diagram also shows route ↔ station. |
| Infrastructure | PostgreSQL on AWS RDS, plus SQS. | The diagram shows MySQL and RabbitMQ. No arrows connect RabbitMQ to the services. |
| Messaging connections | `inside-payment-service` and `rebook-service` point to `prod-sqs`. The JSON gives no message contents, consumer roles, or outgoing queue edges. | The inspected code shows no active messaging in either service to support these connections. [Rebook's queue configuration](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-rebook-service/src/main/resources/application.yml#L14-L32) is commented out. |

**Upstream messaging.** [Food service](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-food-service/src/main/java/foodsearch/service/FoodServiceImpl.java#L113-L150) sends delivery details through RabbitMQ. [Delivery service](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-delivery-service/src/main/java/delivery/mq/RabbitReceive.java#L35-L50) receives them and saves delivery records. Notification service also has an [email consumer](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-notification-service/src/main/java/notification/mq/RabbitReceive.java#L51-L90), but the calls that trigger it during booking are commented out in [preserve](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-preserve-service/src/main/java/preserve/service/PreserveServiceImpl.java#L260-L261) and [preserve-other](https://github.com/FudanSELab/train-ticket/blob/313886e99befb94be6cd45f085c98e0019f59829/ts-preserve-other-service/src/main/java/preserveOther/service/PreserveOtherServiceImpl.java#L259-L260).

**Inference:** SQS may be the assignment's substitute for RabbitMQ, but these sources do not establish what the JSON queue is used for.

## Route rules and API

This section describes the API's behavior and my assumptions where the assignment leaves it unspecified.

### Routes and filters

- A route follows directed edges in the supplied graph. A route containing one node (a singleton), such as `["gateway-service"]`, is valid; `[]` is invalid.
- Any node can start or end a route, even if it has outgoing edges. Because the assignment provides endpoint filters, I assume those restrictions apply only when requested. This lets callers explore internal paths, paths from public services, or paths to databases. Different routes may share nodes.
- All filters must match the **same route** (AND). The `start` scope checks the first node, `end` checks the last, and `any` checks for a match anywhere in the route, including its endpoints. Separate `any` filters may match different nodes. For a singleton, all scopes check the same node.
- The vulnerability filter matches nodes with a nonempty `vulnerabilities` array. The engine uses these annotations without verifying them.
- A node does not match a filter on an attribute it lacks. For example, a missing `publicExposed` matches neither `eq true` nor `eq false`. Values are compared without type conversion.

**Sink interpretation.** In application security, a sink is a sensitive code operation where untrusted input can cause harm, such as executing SQL, running a shell command, or writing a file. For this service graph, I interpret the assignment’s “Sink (rds/sql)” as nodes with `kind: "rds"`. The JSON has no nodes with `kind: "sql"` or `kind: "rds/sql"`. Receiving data or having no outgoing edges alone does not make a node a security sink. The engine queries the supplied relationships; it does not trace untrusted values through source code.

**Singletons.** Routes with one node keep isolated nodes visible in unfiltered results.

### API

I chose a single read-only **`POST /graph/query`** endpoint because it covers the assignment's graph retrieval and filtering requirements.

I chose POST so callers can send a structured list of filters in a JSON request body. This makes filters easy to add and combine without building a long URL query string. For example:

```json
{
  "filters": [
    { "scope": "start", "field": "publicExposed", "operator": "eq", "value": true },
    { "scope": "end", "field": "kind", "operator": "eq", "value": "rds" },
    { "scope": "any", "field": "vulnerabilities", "operator": "notEmpty" }
  ]
}
```

A registry defines the supported fields: `name`, `kind`, `publicExposed`, and `vulnerabilities`. It also defines which operators and values each field accepts:

| Operator | Meaning |
| --- | --- |
| `eq` | The field's scalar value equals the supplied value. |
| `in` | The field's scalar value matches one of the values in the supplied array. |
| `notEmpty` | The field is an array with at least one item. |

Adding a filter extends this registry without changing how routes are found.

Each query converts an `in` filter's values to a `Set` once, giving average constant-time membership checks instead of repeatedly scanning the list.

Responses include:

- **`routes`**: the matching paths, each represented as an ordered array of node IDs.
- **`graph: { nodes, edges }`**: every node and edge in those paths, included once even when several routes share it. Nodes keep their input attributes and gain `id = name`. Edges use `{ "source": "...", "target": "..." }`.

The combined graph can contain paths that did not match the query, so the response also identifies the matching routes. For example, suppose only `V1` and `V2` are vulnerable. Combining `A → V1 → B → DB` and `A → C → B → V2 → DB` also allows the non-vulnerable path `A → C → B → DB`. React displays the combined graph and lets users highlight the returned routes.

- An empty `filters` array returns all precomputed routes and their combined graph. This includes every loaded node and, for this dataset, every edge.
- A query with no matches returns HTTP `200` with empty arrays. An invalid query returns HTTP `400` with validation errors.

**Result for the supplied data:** the example query returns the following because neither public node reaches a vulnerable node or database:

```json
{
  "graph": { "nodes": [], "edges": [] },
  "routes": []
}
```

Filtering by start name `user-service` and end kind `rds` returns `["user-service", "auth-service", "prod-postgresdb"]`. Filtering only for a public start includes `["gateway-service"]`.

## Loading and storage

Because the assignment asks me to load and query the supplied JSON, I treat it as the source of truth. The diagram and upstream implementation provide context for documenting discrepancies; they do not override or supplement the graph.

The source file remains unchanged. At startup, the backend:

1. Reads and parses the JSON. Stops startup with a clear error if the file cannot be read or parsed.
2. Converts string and array `to` values into individual directed edges.
3. Creates one unresolved placeholder for each referenced node that has no definition. Keeps its edges and records a warning.
4. Builds the indexes below in input order. Runs depth-first search (DFS) from every node, recording its singleton and each path extension to precompute all routes.
5. Starts Express once the graph and routes are ready.

| Stored structure | Purpose |
| --- | --- |
| `nodesById: Map<NodeId, GraphNode>` | Node attributes by ID. |
| `edges: GraphEdge[]` | Directed edges expanded from the input. |
| `outgoing: Map<NodeId, NodeId[]>` | Outgoing neighbors for every node, including empty lists. |
| `routes: NodeId[][]` | Precomputed routes storing IDs rather than copies of node attributes. |

The loaded graph and routes stay read-only. Each request builds its own results. Loading and query logic are separate, with automated tests covering loading, traversal, request validation, filtering, and response construction. Changes to the file take effect after a restart and route recomputation, provided the input still meets the assumptions above.

The missing assurance node becomes this in-memory placeholder:

```json
{ "id": "assurance-service", "name": "assurance-service", "unresolved": true }
```

Its kind, exposure, and vulnerabilities are unknown, so those attributes stay absent. Its two incoming edges are kept. An empty outgoing list means the supplied data records no dependencies; the real service may still have them. The frontend marks this node as unresolved.

**Counts calculated from this data and these rules:** 47 loaded nodes, 98 edges, and **487 routes**, including 47 singletons. The assignment does not specify these totals.

## Tradeoffs, scope, and tests

**Precomputation.** Computing routes once at startup avoids searching the graph on every request. Each request still filters the stored routes and builds a JSON response. The tradeoffs are slower startup, recomputation after changes, and memory for the graph and the node IDs stored in every route.

**Scale.** Even a graph without cycles can have exponentially many simple paths. Precomputation works well when the route count is manageable, the graph rarely changes, and queries are frequent. Finding routes on demand may save work when queries are selective or the graph changes often. Listing every route remains expensive either way; more RAM or pagination alone does not remove that work.

For production, I would choose an approach based on measured graph sizes and query patterns. I would also consider limits on computation and response size, timeouts, cancellation, and clearly labeled partial results.

**Other scope limits.** The UI is minimal. I have also left out:

- Persistent storage beyond the input file, live discovery, and updates to the running graph.
- Authentication, authorization, multi-tenancy, and rate limiting.
- Distributed execution, high availability, and production monitoring.
- Pagination and enforced query budgets.

**Tests** run with `npm test` using Node's built-in test runner:

- Loading: read and parse the JSON, normalize `to`, and create placeholders for unresolved references.
- Routes: handle singletons, isolated nodes, and shared branches.
- Queries: check individual and combined filters, missing attributes, empty and invalid queries, and consistency between matching routes and the returned graph.
- Supplied data: verify the calculated node, edge, and route counts.

Synthetic fixtures cover routes that start at a public service, include a vulnerable node, and end at a database, because the supplied data has no such routes.
