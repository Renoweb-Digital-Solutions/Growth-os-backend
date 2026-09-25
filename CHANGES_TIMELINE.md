# Backend Changes Timeline

## [2026-09-13] Phase 3 — GROmentum Insights & Data Delivery Implementation
- **Overview**: Implemented Phase 3 capability-aware, normalized, dashboard-ready Gromentum APIs built on top of Phase 1 OAuth and Phase 2 Graph API retrieval foundations.
- **Data Flow**:
  - `GET /api/meta/insights/overview`: Returns executive cross-channel summary (Social + Ads) with capability headers and resolved date ranges.
  - `GET /api/meta/insights/social`: Returns normalized performance metrics for connected Facebook Pages and Instagram Accounts.
  - `GET /api/meta/insights/content`: Consolidated post & media content insights list with reverse-chronological date filtering.
  - `GET /api/meta/insights/ads`: Advertising Insights for Ad Accounts with derived CTR, CPC, CPM, and CPA metrics.
  - `GET /api/meta/insights/campaigns`: Campaign performance list with budget currency subunit conversion (`getCurrencyDivisor`).
- **Technical Details**:
  - Created `services/metaInsightService.js` for server-side client requirement derivation (`deriveClientRequirements`), capability matrix evaluator (`evaluateCapabilities`), currency offset divisor helper (`getCurrencyDivisor`), bounded reverse-chronological pagination helper for `publishedMediaInPeriod`, and metric transformations.
  - Created `controllers/metaInsightController.js` for controller handlers with strict date parameter validation (`since` <= `until`).
  - Mounted Phase 3 endpoints under `/api/meta/insights/...` in `routes/metaRoutes.js` protected by Gromentum JWT authentication.
  - Formatted all responses with deterministic capability headers (`available`, `code`, `reason`) and resolved dateRange metadata.

## [2026-09-13] Meta Access-Token Lifecycle & Long-Lived Token Exchange Fix
- **Overview**: Resolved Meta access-token expiration issue by performing Meta's official long-lived User Access Token exchange during OAuth callback.
- **Data Flow**:
  - `services/metaService.js`: Updated `exchangeCodeForToken()` to exchange initial short-lived user token for Meta's 60-day long-lived token via `grant_type=fb_exchange_token`.
  - `controllers/metaDataController.js`: Updated `getAccessToken()` to reject known-expired tokens (`tokenExpiresAt < Date.now()`), persist `status='expired'` and `accessToken=null` in MongoDB, and throw 401.
  - `controllers/metaController.js`: Updated `getStatus()` to persist `status='expired'` to MongoDB when token expiration is detected.
- **Technical Details**:
  - Long-lived user access token exchange retains ~60 day duration (`expires_in = 5184000` seconds).
  - Preserved token privacy: access tokens are never logged or returned in API responses.

## [2026-09-13] Phase 2 — Meta Asset & Data Integration Implementation
- **Overview**: Implemented Meta Graph API v26.0 asset discovery, social data (Facebook Pages & Instagram Professional accounts), advertising hierarchy (Ad Accounts, Campaigns, Ad Sets, Ads), Ads Insights, cursor pagination, and normalized error response handling.
- **Data Flow**:
  - `GET /api/meta/assets`: Discovers all connected Facebook Pages, Instagram Professional Accounts, Ad Accounts, and capability availability flags (`pagesAvailable`, `instagramAvailable`, `adsAvailable`).
  - `GET /api/meta/pages`, `/pages/:pageId`, `/pages/:pageId/posts`, `/pages/:pageId/insights`: Retrieves Page profile, posts with cursor pagination, and performance metrics.
  - `GET /api/meta/instagram`, `/instagram/:id/media`, `/instagram/:id/insights`: Retrieves Instagram Professional accounts linked via Page, media posts with cursor pagination, and daily insights metrics.
  - `GET /api/meta/ad-accounts`, `/ad-accounts/:id/campaigns`, `/adsets`, `/ads`, `/insights`: Retrieves Ad Accounts, marketing hierarchy, and performance metrics with derived CTR/CPC/CPM calculations.
- **Technical Details**:
  - Extended `services/metaService.js` with v26.0 Graph API request wrappers, error normalizer (`190` token expiry -> 401, `200-299` permission error -> 403, `17`/`613` rate limit -> 429), and cursor pagination engine.
  - Created `controllers/metaDataController.js` for Phase 2 controller endpoints with strict date parameter validation (`since` <= `until`).
  - Mounted Phase 2 endpoints under `/api/meta` in `routes/metaRoutes.js` protected by Gromentum JWT authentication.
  - Preserved all Phase 1 OAuth connection & authorization endpoints.

## [2026-09-12] Phase 1 — Meta Connection & Authorization Implementation
- **Overview**: Implemented secure Meta OAuth connection and persistence flow for authenticated Gromentum users.
- **Data Flow**:
  - `GET /api/meta/connect` (Protected): Validates JWT, generates single-use CSRF state token in `MetaOAuthState` (10-min TTL), constructs Meta Login for Business OAuth URL (`config_id` or `scope`), and redirects user.
  - `GET /api/meta/callback` (Public): Atomically consumes state via `findOneAndDelete` to prevent replay attacks, performs code exchange via `metaService.exchangeCodeForToken`, fetches Meta User ID (`/me`) and authoritative granted permissions (`/me/permissions`), and upserts `MetaIntegration`.
  - `GET /api/meta/status` (Protected): Returns sanitized connection details (`connected`, `status`, `metaUserId`, `grantedScopes`, `connectedAt`). Never exposes tokens or secrets.
  - `DELETE /api/meta/disconnect` (Protected): Updates integration status to `'disconnected'` and unsets `accessToken` to `null`.
- **Technical Details**:
  - Created models: `models/MetaIntegration.js` and `models/MetaOAuthState.js`.
  - Created service: `services/metaService.js` with mandatory `META_GRAPH_API_VERSION` environment variable enforcement.
  - Created controller & routes: `controllers/metaController.js` and `routes/metaRoutes.js`.
  - Mounted `/api/meta` in `server.js` while maintaining all existing middlewares and routes untouched.

## [2026-07-16] Password Reset Flow Implementation
- **Overview**: Implemented a secure OTP-based password reset system.
- **Data Flow**:
  - `POST /api/auth/forgot-password`: Generates 6-digit OTP, hashes it, saves to `User` model with 15min expiry, sends via `nodemailer`.
  - `POST /api/auth/verify-otp`: Compares user OTP with hashed DB OTP. Returns a 15-minute temporary JWT for reset.
  - `POST /api/auth/reset-password`: Validates temporary JWT, hashes new password, updates DB.
- **Technical Details**:
  - Integrated `nodemailer` (via `utils/sendEmail.js`) for outbound emails (configured for dev logging).
  - Expanded `User` model to include `resetPasswordOtp` and `resetPasswordExpires`.

## [2026-07-16] Production Architecture & Auth Upgrade
- **Overview**: Upgraded backend security, error handling, and authentication mechanisms to production-ready standards.
- **Data Flow**:
  - **Auth**: `POST /api/auth/login` -> `authController.login` -> Validates via `User` model using `bcrypt` -> Generates JWT.
  - **Onboarding**: Uses `onboardingController` to manage `Tenant` and `PendingTenant` models.
- **Technical Details**:
  - Implemented `asyncHandler` to eliminate `try/catch` blocks.
  - Added global `errorMiddleware`.
  - Added `helmet`, `morgan`, and `express-rate-limit` for security.
