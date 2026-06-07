# Network and Communication Strategy (MVP)

## 1. Communication path (SSOT)

The communication direction between MVP services is unified as:

`Browser → Frontend → Backend API → PostgreSQL / Mail Provider / Logs`

Description:
- Browser does not directly access databases and mail providers.
- The database only allows Backend API access.
- Email sending calls can only be initiated by Backend.

## 2. Port and access direction

### Local

- Frontend:`http://localhost:3000`
- Backend API:`http://localhost:3001`
- PostgreSQL: `localhost:5432` (local development link only)

### Staging / Production (example convention)

- Frontend:`https://<env-domain>`(443)
- Backend API:`https://api.<env-domain>`(443)
- PostgreSQL: not open to the public network, only allowing access to the network where Backend is located (5432 intranet)

## 3. Domain name and HTTPS

1. Staging and Production must use separate domain names.
2. Front-end and back-end access to Staging and Production must be through HTTPS.
3. Local can use HTTP for development and debugging.

## 4. API Base URL Convention

- Local front end is called by default: `http://localhost:3001`
- Staging front-end call: `https://api.staging.<domain>`
- Production front-end call: `https://api.<domain>`

## 5. CORS basic strategy

1. Allow only whitelisted sources to access the backend API.
2. Local: Allow `http://localhost:3000`.
3. Staging: Only staging front-end domain names are allowed.
4. Production: Only production front-end domain names are allowed.
5. Disable `*` to wildcard the authentication interface CORS.

## 6. Database access strategy

- PostgreSQL is not exposed to Browser.
- PostgreSQL is not exposed to the public network.
- Only Backend API uses database connection credentials.
- The Staging and Production database network layers must be isolated.

## 7. Log and monitoring links

- Backend outputs structured logs to a centralized logging system.
- Key indicators (login failure rate, email failure rate, subscription access rejection) enter the monitoring system.
- Production must configure the alarm receiving channel.
