# Node.js Product Catalog — Jenkins + Helm + ArgoCD + ELK

A production-style DevOps project built on a home lab. REST API deployed to Kubernetes using a full CI/CD pipeline with GitOps, distributed tracing, and centralized logging.

## Architecture

```
Developer pushes code
        │
        ▼
   Jenkins CI (8 stages)
   ├── npm install (node:20-alpine container)
   ├── Jest tests (node:20 container)
   ├── Docker build + push → Docker Hub
   ├── Update helm/values.yaml (image tag)
   ├── Git push → GitHub
   └── Trigger ArgoCD sync → wait for healthy
        │
        ▼
   ArgoCD (GitOps)
   └── Detects values.yaml change → Helm deploy → K8s
        │
        ▼
   K8s Cluster (K3s on home lab)
   ├── nodejs-app pod (Express + Mongoose)
   ├── mongo pod (MongoDB 7.0)
   └── observability namespace
       ├── OTel Collector → Jaeger (traces)
       ├── Filebeat → Elasticsearch → Kibana (logs)
       └── Logstash
```

## Tech Stack

| Layer | Tool |
|---|---|
| Application | Node.js, Express, Mongoose |
| Testing | Jest, Supertest, mongodb-memory-server |
| Containerization | Docker (multi-stage build) |
| CI | Jenkins (declarative pipeline, 8 stages) |
| Registry | Docker Hub |
| CD | ArgoCD (GitOps) |
| Packaging | Helm 3 |
| Orchestration | Kubernetes (K3s) |
| Tracing | OpenTelemetry → OTel Collector → Jaeger |
| Logging | Winston → Filebeat → Elasticsearch → Kibana |

## Project Structure

```
.
├── app/
│   ├── src/
│   │   ├── tracing.js          # OTel SDK init (must be first require)
│   │   ├── index.js            # Express entry point
│   │   ├── logger.js           # Winston JSON logger
│   │   ├── models/Product.js   # Mongoose schema
│   │   ├── routes/products.js  # CRUD endpoints
│   │   └── middleware/
│   │       ├── requestLogger.js   # injects traceId into logs
│   │       └── errorHandler.js
│   ├── config/otel-collector.yaml
│   ├── docker-compose.yaml     # local dev
│   ├── Dockerfile              # multi-stage build
│   ├── package.json
│   └── tests/products.test.js
├── helm/nodejs-app/            # Helm chart
│   ├── templates/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── ingress.yaml
│   │   └── configmap.yaml
│   ├── values.yaml             # default (updated by Jenkins)
│   ├── values-local.yaml       # local K3s overrides
│   └── values-prod.yaml        # production overrides
├── argocd/
│   └── application.yaml        # ArgoCD Application manifest
├── k8s/observability/          # ELK + Jaeger + OTel manifests
└── Jenkinsfile                 # 8-stage CI/CD pipeline
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/products` | List products (paginated) |
| POST | `/api/products` | Create product |
| GET | `/api/products/:id` | Get product by ID |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Soft delete product |

Valid categories: `electronics`, `clothing`, `food`, `books`, `sports`, `other`

### Example requests

```bash
# Create a product
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Gaming Mouse","price":49.99,"category":"electronics","stock":50}'

# List products
curl http://localhost:3000/api/products

# Health check
curl http://localhost:3000/health
```

## Jenkins Pipeline (8 Stages)

```
Stage 1  Checkout         git log — audit trail
Stage 2  Install          docker run node:20-alpine npm ci
Stage 3  Test             docker run node:20 npm test (Jest + mongodb-memory-server)
Stage 4  Docker Build     docker build --tag repo:sha --tag repo:latest
Stage 5  Push to Hub      docker login + docker push
Stage 6  Update Helm      sed image tag in values.yaml
Stage 7  Push to Git      git commit + push [skip ci]
Stage 8  Deploy ArgoCD    POST /api/v1/applications/.../sync → poll until Healthy
```

Jenkins build turns green only when the pod is **actually Running and Healthy** in K8s, not just when the image was pushed.

### Jenkins Credentials Required

| ID | Kind | Value |
|---|---|---|
| `DOCKERHUB_REPO` | Secret text | `username/nodejs-product-catalog` |
| `GIT_REPO_URL` | Secret text | `https://github.com/username/repo.git` |
| `ARGOCD_TOKEN` | Secret text | ArgoCD admin API token |
| `ARGOCD_SERVER` | Secret text | `localhost:8090` |
| `dockerhub-creds` | Username/password | Docker Hub username + access token |
| `github-token` | Username/password | GitHub username + PAT |

## Local Development

```bash
# Start app + MongoDB + OTel Collector + Jaeger
cd app/
docker compose up -d

# Test the API
curl http://localhost:3000/health

# View traces
open http://localhost:16686

# Run tests
npm test
```

## Deploy to K8s with Helm

```bash
# Create MongoDB secret
kubectl create secret generic mongodb-secret \
  --namespace default \
  --from-literal=MONGO_URI="mongodb://mongo:27017/productcatalog"

# Create service account
kubectl create serviceaccount nodejs-app -n default

# Deploy MongoDB
kubectl apply -f - << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongo
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mongo
  template:
    metadata:
      labels:
        app: mongo
    spec:
      containers:
        - name: mongo
          image: mongo:7.0
          ports:
            - containerPort: 27017
          volumeMounts:
            - name: mongo-data
              mountPath: /data/db
      volumes:
        - name: mongo-data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: mongo
  namespace: default
spec:
  selector:
    app: mongo
  ports:
    - port: 27017
      targetPort: 27017
EOF

# Deploy app via Helm
helm install nodejs-app helm/nodejs-app \
  --namespace default \
  --values helm/nodejs-app/values-local.yaml

# Access from network
kubectl port-forward svc/nodejs-app 3000:80 -n default --address 0.0.0.0
```

## ArgoCD GitOps Setup

```bash
# Apply ArgoCD Application
kubectl apply -f argocd/application.yaml

# Check sync status
kubectl get application -n argocd
```

ArgoCD watches `helm/nodejs-app/values.yaml` in Git. When Jenkins pushes a new image tag, ArgoCD detects the change and automatically deploys the new version.

## Observability

**Traces (Jaeger):**
```bash
kubectl port-forward svc/jaeger 16686:16686 -n observability --address 0.0.0.0
# Open http://10.0.0.148:16686
```

**Logs (Kibana):**
```bash
kubectl port-forward svc/kibana 5601:5601 -n observability --address 0.0.0.0
# Open http://10.0.0.148:5601
# Create data view: nodejs-logs-* with @timestamp field
```

Every log line includes a `traceId` field, you can copy a traceId from Kibana and paste it into Jaeger to see the exact trace for that request.

## Real Bugs Fixed During This Project

**Bug 1 — `npm ci` fails in Dockerfile**
`npm ci --frozen-lockfile` exits with code 1 when `package-lock.json` doesn't exist yet. Fixed by using `npm install` first locally to generate the lockfile, then committing it.

**Bug 2 — `PeriodicExportingMetricReader is not a constructor`**
Imported from wrong package. `PeriodicExportingMetricReader` lives in `@opentelemetry/sdk-metrics` not `@opentelemetry/sdk-node`. Fixed by removing metrics entirely from tracing.js.

**Bug 3 — `Resource is not a constructor`**
Version mismatch between `@opentelemetry/resources` and the version bundled inside `@opentelemetry/sdk-node`. Fixed by removing explicit `Resource` import and letting sdk-node read `OTEL_SERVICE_NAME` from environment variable automatically.

**Bug 4 — `MongoDBResponse.make is not a function`**
OTel MongoDB instrumentation conflicts with mongoose's bundled mongodb driver (different versions nested at `node_modules/mongoose/node_modules/mongodb`). Fixed by disabling MongoDB instrumentation in tracing.js.

**Bug 5 — mongodb-memory-server fails on Alpine Linux**
`UnknownLinuxDistro: Unknown/unsupported linux "alpine"`. mongodb-memory-server downloads a real MongoDB binary at test time, Alpine is not supported. Fixed by using `node:20` (Debian) for the test stage and setting `MONGOMS_VERSION=7.0.14` since Debian 12 requires MongoDB 7.0.3+.

**Bug 6 — Groovy syntax error `unexpected char: '#'`**
`${GIT_REPO_URL#https://}` is bash parameter substitution syntax, Groovy parser crashes on the `#` character before the shell even runs. Fixed by stripping the prefix at runtime using `sed 's|https://||'` inside the shell block.

**Bug 7 — Jenkins `when { branch 'master' }` always skips**
`branch 'master'` only works in Multibranch Pipeline jobs. Regular Pipeline jobs use `env.GIT_BRANCH` which is set to `origin/master`. Fixed by replacing with `expression { return env.GIT_BRANCH == 'origin/master' || env.GIT_BRANCH == 'master' }`.

**Bug 8 — ArgoCD `serviceaccount not found`**
Helm chart tried to create and reference a `nodejs-app` ServiceAccount but it wasn't being created. Fixed by setting `serviceAccount.create: false` and `serviceAccount.name: default` in values.yaml.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | App port | `3000` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/productcatalog` |
| `NODE_ENV` | Environment | `development` |
| `LOG_LEVEL` | Winston log level | `info` |
| `OTEL_SERVICE_NAME` | Service name in Jaeger | `nodejs-product-catalog` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel Collector endpoint | `http://localhost:4318` |