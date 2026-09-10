# Developer Guide: Digital Identity Workshop

This guide provides direct, practical instructions to start, develop, and test the Digital Identity Workshop locally.

> [!IMPORTANT]
> **Educational and Demonstration Purpose Only**: This workshop and code repository are created strictly for educational, training, and local demonstration purposes. It is not designed or intended for real-world or production use.

---

## 1. What You Need to Run

To run this application, you only need:
- **Docker** and **Docker Compose v2** (Docker Desktop on macOS/Windows, or Docker Engine on Linux).
- **Node.js 18+** (optional, only if you want to run the Verifier server locally on your host instead of in Docker).

### Required Ports
Ensure these ports are free on your machine:
- `8080`: Keycloak OID4VCI Issuer
- `3001`: Digital Wallet Frontend
- `8002`: Digital Wallet Backend
- `3306`: Wallet MariaDB
- `4000`: Verifier Portal & Store Cart

All `*.localhost` domains (`keycloak.localhost`, `verifier.localhost`) resolve automatically to `127.0.0.1` in all modern browsers without any hosts file changes.

---

## 2. Start the Application

### Step 1: Prepare Environment Configuration
From the repository root:

```bash
# macOS / Linux
cp -n docker/.env.example docker/.env

# Windows (PowerShell)
if (-not (Test-Path docker/.env)) { Copy-Item docker/.env.example docker/.env }
```

### Step 2: Start All Services
```bash
docker compose -f docker/docker-compose.yml up -d
```

### Step 3: Check Startup & Health
```bash
docker compose -f docker/docker-compose.yml ps
```

Keycloak takes about 20 to 30 seconds to initialize. Once `keycloak` reports `(healthy)`, the `bootstrap` container automatically runs `bootstrap.js` to register OID4VCI scopes and user credentials, then exits with code 0.

To view bootstrap progress:
```bash
docker compose -f docker/docker-compose.yml logs bootstrap
```

### Step 4: Open in Your Browser
Once running, the services are available at:

| Component | URL | Notes |
| :--- | :--- | :--- |
| **Google Issuer Portal** | http://localhost:8080/ | Login: `ronak`, `raj`, or `milan` / Password: `workshop` |
| **Digital Wallet** | http://localhost:3001/ | User wallet interface |
| **Verifier** | http://localhost:4000/ | E-commerce demo with 20% discount |
| **Keycloak Admin** | http://localhost:8080/admin/ | Admin login: `admin` / `admin` |

---

## 3. Local Development Mode (Live Reload)

If you are modifying the Verifier backend (`server.js`) or frontend (`public/app.js`, `public/index.html`, `public/style.css`), run the Verifier locally on your host machine for instant live reload:

### Step 1: Start Infrastructure in Docker
Start Keycloak, MariaDB, the Wallet, and Bootstrap:
```bash
docker compose -f docker/docker-compose.yml up -d keycloak wallet-db wallet-backend wallet-frontend bootstrap
```

### Step 2: Install Local Dependencies
In the root directory:
```bash
npm install
```

### Step 3: Run Verifier with Auto-Reload
```bash
node --watch server.js
```
The Verifier runs on `http://localhost:4000`. Any edits to `server.js` automatically restart the server, and edits in `public/` are served immediately upon browser refresh.

---

## 4. Bootstrap Automation (`docker/bootstrap.js`)

The bootstrap process handles everything Keycloak's static realm import cannot express dynamically:
- Creates the `rsa-enc-generated` encryption key provider required by compliant OID4VCI wallets.
- Registers the `employee-badge` (`dc+sd-jwt`) and `employee-badge-jwt` client scopes.
- Attaches scopes as optional to the `workshop-badge` client.
- Assigns credential scopes to demo users (`ronak`, `raj`, `milan`).

### Running Bootstrap Manually (Host Level)
You can run the script manually against a running Keycloak instance without Docker:
```bash
KC_URL=http://localhost:8080 CREDENTIAL_SCOPES_FILE=docker/keycloak-credential-scopes.json node docker/bootstrap.js
```

---

## 5. Repository Structure

```text
.
├── README.md                         # Project overview and end-to-end demo walkthrough
├── DEVELOPER.md                      # Developer onboarding and setup guide (this file)
├── AGENTS.md                         # Architecture guidelines for AI pair programmers
├── Dockerfile                        # Verifier container definition (Node.js 20 Alpine)
├── package.json                      # Verifier dependencies (express, jose, node-forge, cors)
├── server.js                         # Verifier backend: OID4VP endpoints, DCQL queries, Direct Post receiver
├── keys/                             # Verifier PKI assets (EC private key & X.509 cert)
├── public/                           # Verifier frontend (Store Cart, Badge CTA, QR Modal)
│   ├── index.html                    # Cart UI, QR modal, scenario panels
│   ├── app.js                        # OID4VP session creation, QR polling, dynamic badge rendering
│   ├── style.css                     # Store & modal styling
│   └── qrcode.min.js                 # Offline QR code generator library
└── docker/                           # Stack orchestration and configuration
    ├── docker-compose.yml            # Multi-service compose file
    ├── bootstrap.js                  # One-shot Node.js automation script
    ├── keycloak-realm.json           # Keycloak realm configuration
    ├── keycloak-credential-scopes.json # OID4VCI client scope definitions
    ├── keycloak-theme/               # Custom Google Issuer theme
    └── wwwallet/                     # Wallet configuration and database seed
```

---

## 6. Verification & API Testing

For the interactive browser demo walkthrough (collecting the badge and testing cart verification), see the **[Demo Walkthrough in README.md](README.md#step-by-step-demo-walkthrough)**.

### Terminal Smoke Tests with cURL
Verify that all services are answering API requests properly:

```bash
# 1. Test Keycloak OID4VCI discovery
curl -s http://localhost:8080/realms/workshop/.well-known/openid-credential-issuer | grep -o '"credential_issuer":"[^"]*"'

# 2. Test Wallet accessibility
curl -s -I http://localhost:3001/ | grep HTTP

# 3. Test Verifier OID4VP session creation
curl -s -X POST http://localhost:4000/api/oid4vp/session \
  -H "Content-Type: application/json" \
  -d '{"useCase":"cart_discount","returnOrigin":"http://localhost:4000"}'
```

---

## 7. Common Commands Cheat Sheet

```bash
# Start all containers
docker compose -f docker/docker-compose.yml up -d

# Stop all containers
docker compose -f docker/docker-compose.yml down

# View logs for a service
docker compose -f docker/docker-compose.yml logs -f verifier
docker compose -f docker/docker-compose.yml logs -f keycloak

# Restart a specific service
docker compose -f docker/docker-compose.yml restart verifier

# Complete state reset (clears wallet database and re-imports realm on next up)
docker compose -f docker/docker-compose.yml down -v
```

---

## 8. Troubleshooting

- **Port already in use (`address already in use`)**:
  Check what is using the port with `lsof -i :<PORT>` (macOS/Linux) or `netstat -ano | findstr :<PORT>` (Windows) and terminate the conflicting process.
- **Keycloak health check takes long**:
  Keycloak requires sufficient RAM to boot. Ensure Docker has at least 4 GB of memory allocated.
- **Bootstrap container shows exited**:
  This is expected. The `bootstrap` service runs once on startup, completes in under 2 seconds, and exits with code 0.
- **Stale login in Keycloak**:
  On `http://localhost:8080/`, click **Clear sign-in state** or open the page in a private / incognito window.
