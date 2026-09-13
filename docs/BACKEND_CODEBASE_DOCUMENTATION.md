# Comprehensive Technical Documentation: GrowthOS Backend

> **Target Audience:** New & Existing Backend Engineers  
> **Document Purpose:** Complete, line-by-line, architectural and operational walkthrough of the GrowthOS Backend API repository.  
> **Repository Root:** `d:\Internships\Renoweb\Growth-OS-Backend`

---

## 1. Project Overview

### What This Backend Project Does
The **GrowthOS Backend** is a Node.js and Express RESTful API server that powers the GrowthOS platform. It provides core services for user management, multi-tenant organization provisioning (both self-serve and invite-driven), authentication and authorization, OTP-based password reset via email, sales lead capture, and progressive user onboarding state synchronization.

### What Problem It Solves
GrowthOS addresses the administrative and operational workflow needs of B2B and B2C agencies and clients. This backend provides:
1. **Secure Access & Lifecycle Management:** User registration, password authentication, and temporary OTP-based password recovery.
2. **Multi-Tenant Provisioning:** Isolation and registration of client organizations (tenants), complete with brand color validation and plan tiers.
3. **Invitation System:** Pre-provisioned invitation codes allowing prospective tenants to complete onboarding securely.
4. **Lead Acquisition:** Public-facing API endpoints to collect and track prospective sales leads.
5. **Stateful Onboarding:** Progressive profile updates allowing frontends to save multi-step onboarding progress seamlessly.

### Type of Application / Product
A multi-tenant **Software-as-a-Service (SaaS)** platform for digital agencies (`agency_owner`) and their end clients (`client`), managed by administrative staff (`sales_admin`).

### Main Responsibilities of the Backend
- Validating and persisting user profiles and password hashes.
- Issuing and verifying JSON Web Tokens (JWT) for session management and password reset flows.
- Enforcing API security through HTTP header protection (Helmet), rate limiting, and CORS.
- Managing tenant lifecycle states (`trial`, `active`) and invitation redemptions.
- Capturing prospective client interest (Sales Leads).
- Synchronizing multi-step onboarding forms safely via property whitelisting.

### Main Technologies / Frameworks / Libraries
- **Core Runtime:** Node.js (CommonJS module system)
- **Web Framework:** Express.js (`v5.2.1`)
- **Database / ODM:** MongoDB via Mongoose (`v9.7.4`)
- **Authentication:** `jsonwebtoken` (`v9.0.3`), `bcrypt` (`v6.0.0`)
- **Email Dispatch:** `nodemailer` (`v9.0.3`)
- **Security & Utilities:** `helmet` (`v8.3.0`), `express-rate-limit` (`v8.5.2`), `cors` (`v2.8.6`), `morgan` (`v1.11.0`), `dotenv` (`v17.4.2`)
- **Development Tooling:** `nodemon` (`v3.1.14`)

### Programming Language and Runtime
- **Language:** JavaScript (ES6+ features including async/await, arrow functions, destructuring)
- **Runtime:** Node.js (v18+ recommended)

### Overall Backend Architecture
The application follows a **Model-Controller-Routes Architecture** with centralized error middleware and utility helpers. HTTP requests land on Express routes, pass through security and authentication middleware, execute controller logic interacting with Mongoose schemas, and return structured JSON responses.

---

## 2. Complete Folder Structure

Below is the directory map of the repository:

```
Growth-OS-Backend/
├── controllers/
│   ├── authController.js        # Auth, Registration, OTP & Password Reset
│   ├── onboardingController.js  # Tenant creation, Invite lookup, Lead capture
│   └── userController.js        # User profile retrieval & onboarding step updates
├── middleware/
│   ├── authMiddleware.js        # JWT Bearer verification guard ('protect')
│   └── errorMiddleware.js       # Centralized global error handling middleware
├── models/
│   ├── User.js                  # User schema, credentials, role, onboarding fields
│   ├── Tenant.js                # Tenant schema, plan tier, brand colors, owner ID
│   ├── PendingTenant.js         # Pre-approved invite token schema
│   └── SalesLead.js             # Public sales contact form entries
├── routes/
│   ├── auth.js                  # Mounts /api/auth routes
│   ├── onboarding.js            # Mounts /api/onboarding routes
│   └── userRoutes.js            # Mounts /api/users routes
├── utils/
│   ├── asyncHandler.js          # Async wrapper eliminating try/catch blocks
│   └── sendEmail.js             # Nodemailer email dispatch utility
├── .gitignore                   # Version control ignore definitions
├── AI_GUIDELINES.md             # Code standards & AI development guidelines
├── CHANGES_TIMELINE.md          # Architectural and feature change log
├── package.json                 # Node.js project manifest & dependencies
├── package-lock.json            # Exact dependency version lockfile
├── README.md                    # Project summary & architecture diagram
└── server.js                    # Application entry point & server setup
```

### Detailed Breakdown of Folders & Files

#### `controllers/`
Responsible for processing incoming HTTP requests, executing business logic, querying MongoDB models, and sending responses.
- `authController.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js)): Contains handlers for user registration, user login, requesting password reset OTP, verifying OTP, and setting new passwords. Dependents: `routes/auth.js`.
- `onboardingController.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/onboardingController.js)): Contains handlers for looking up invite tokens, creating new tenants, and capturing sales leads. Dependents: `routes/onboarding.js`.
- `userController.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/userController.js)): Contains handlers for fetching authenticated user profiles and updating onboarding steps. Dependents: `routes/userRoutes.js`.

#### `middleware/`
Express middleware functions that intercept requests before they reach controllers or handle output after execution.
- `authMiddleware.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/middleware/authMiddleware.js)): Provides `protect` middleware to extract JWT from `Authorization: Bearer <token>`, decode user identity, attach `req.user`, or throw 401 Unauthorized. Dependents: `routes/userRoutes.js`.
- `errorMiddleware.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/middleware/errorMiddleware.js)): Provides `errorHandler` middleware to format error responses as `{ message, stack }`, hiding stack traces when `NODE_ENV === 'production'`. Dependents: `server.js`.

#### `models/`
Mongoose schemas defining database entity structures, data types, constraints, and relationships.
- `User.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/User.js)): Defines user fields, authentication fields (password, authProvider, reset OTP/expiry), role enum (`client`, `agency_owner`, `sales_admin`), tenant relation, and 12 onboarding profile fields. Dependents: `authController.js`, `userController.js`, `authMiddleware.js`, `Tenant.js`.
- `Tenant.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/Tenant.js)): Defines organization data (`companyName`, `description`, `brandColors` array of 3 strings, `planTier`, `status`, `createdVia`, `ownerUserId`). Dependents: `onboardingController.js`.
- `PendingTenant.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/PendingTenant.js)): Defines invite tokens issued by sales team for tenant signup. Dependents: `onboardingController.js`.
- `SalesLead.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/SalesLead.js)): Defines public lead submission records. Dependents: `onboardingController.js`.

#### `routes/`
Express routers defining HTTP methods and endpoints, attaching middleware and delegating to controllers.
- `auth.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/routes/auth.js)): Defines `/register`, `/login`, `/forgot-password`, `/verify-otp`, `/reset-password`. Dependents: `server.js`.
- `onboarding.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/routes/onboarding.js)): Defines `/invites/:token`, `/tenants`, `/leads`. Dependents: `server.js`.
- `userRoutes.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/routes/userRoutes.js)): Defines `/me`, `/onboarding` (protected with `protect`). Dependents: `server.js`.

#### `utils/`
Reusable helper modules.
- `asyncHandler.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/utils/asyncHandler.js)): Higher-order function wrapping async route handlers to catch rejected promises and pass errors to `next()`. Dependents: All controllers and `authMiddleware.js`.
- `sendEmail.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/utils/sendEmail.js)): Email dispatch helper using Nodemailer with fallback console logging for dev mode. Dependents: `authController.js`.

#### Root Files
- `server.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/server.js)): Main startup script initializing Express, loading env vars, applying global middleware, connecting MongoDB, and starting HTTP server.
- `package.json` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/package.json)): Defines scripts (`dev`), project metadata, runtime and dev dependencies.
- `package-lock.json`: Fixes exact versions of installed node_modules.
- `README.md` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/README.md)): Primary documentation containing architecture flow diagram.
- `AI_GUIDELINES.md` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/AI_GUIDELINES.md)): Coding standards for developers and AI assistants.
- `CHANGES_TIMELINE.md` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/CHANGES_TIMELINE.md)): Historical log of architectural updates.

---

## 3. Application Entry Point

The entry point of the GrowthOS Backend is `server.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/server.js)).

### Step-by-Step Startup Flow

```
1. Require Dependencies (express, mongoose, cors, helmet, morgan, express-rate-limit, dotenv)
   │
2. Load Environment Variables (dotenv.config())
   │
3. Environment Validation Check (MONGODB_URI and JWT_SECRET presence check)
   │  └─► If missing: Log FATAL ERROR and call process.exit(1)
   │
4. Initialize Express App & Port Setup (const app = express(), PORT = process.env.PORT || 5000)
   │
5. Register Core Security & Parsing Middleware:
   │  ├── helmet()
   │  ├── cors()
   │  ├── express.json()
   │  └── morgan('combined' or 'dev' based on NODE_ENV)
   │
6. Register Rate Limiting Middleware:
   │  └── rateLimit({ windowMs: 15 min, max: 100 requests }) mounted on /api
   │
7. Mount Application Routers:
   │  ├── app.use('/api/auth', authRoutes)
   │  ├── app.use('/api/onboarding', onboardingRoutes)
   │  ├── app.use('/api/users', userRoutes)
   │  └── app.get('/api/health', inline handler)
   │
8. Register Global Error Handler:
   │  └── app.use(errorHandler) [Must be registered AFTER all routes]
   │
9. Connect to MongoDB & Start Listener:
   │  └── mongoose.connect(process.env.MONGODB_URI)
   │        └─► On Success: app.listen(PORT, callback)
   │        └─► On Failure: console.error(err)
```

---

## 4. Architecture Explanation

### Architectural Pattern
The backend uses a **Model-Controller-Routes Architecture** (a variant of Layered/MVC Architecture without server-side rendering views).

### Layer Responsibilities
1. **Route Layer (`routes/`):** Defines URL patterns and HTTP verbs. Binds middleware (e.g. `protect`) to endpoints and routes requests to appropriate controller functions.
2. **Middleware Layer (`middleware/`):** Performs request pre-processing (authentication guard, rate limiting, request body parsing, security header generation) and error formatting.
3. **Controller Layer (`controllers/`):** Contains application business logic, handles request parameter extraction, invokes data operations on models, triggers email utilities, and formats HTTP responses.
4. **Data Model Layer (`models/`):** Encapsulates Mongoose schemas, field types, default values, validations, and MongoDB interaction methods.
5. **Database Layer:** Remote or local MongoDB cluster storing document collections (`users`, `tenants`, `pendingtenants`, `salesleads`).

### Dependency & Request Execution Flow
```
Client HTTP Request
  └─► Express App (server.js)
        └─► Helmet / CORS / RateLimiter / Morgan / BodyParser
              └─► Route Router (routes/auth.js, onboarding.js, userRoutes.js)
                    └─► Auth Middleware (middleware/authMiddleware.js) [If Protected]
                          └─► Async Wrapper (utils/asyncHandler.js)
                                └─► Controller (controllers/*)
                                      ├── Utility (utils/sendEmail.js) [If Email Needed]
                                      └─► Mongoose Model (models/*)
                                            └─► MongoDB Database
                                      ◄─ Output JSON Response
                                [If Error Thrown]
                                      └─► Error Middleware (middleware/errorMiddleware.js)
                                            ◄─ Output Error JSON Response
```

---

## 5. Complete API Documentation

### Summary Table of Endpoints

| HTTP Method | Endpoint | Route File | Controller Function | Auth Required | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | `routes/auth.js` | `authController.register` | No | Register a new user and receive JWT |
| `POST` | `/api/auth/login` | `routes/auth.js` | `authController.login` | No | Authenticate user with credentials and receive JWT |
| `POST` | `/api/auth/forgot-password` | `routes/auth.js` | `authController.forgotPassword` | No | Request password reset OTP sent via email |
| `POST` | `/api/auth/verify-otp` | `routes/auth.js` | `authController.verifyOtp` | No | Validate OTP and receive temporary reset JWT |
| `POST` | `/api/auth/reset-password` | `routes/auth.js` | `authController.resetPassword` | No | Reset user password using temporary reset JWT |
| `GET` | `/api/onboarding/invites/:token` | `routes/onboarding.js` | `onboardingController.getInvite` | No | Fetch valid invitation details by token |
| `POST` | `/api/onboarding/tenants` | `routes/onboarding.js` | `onboardingController.createTenant` | No | Create tenant and optionally redeem invite token |
| `POST` | `/api/onboarding/leads` | `routes/onboarding.js` | `onboardingController.submitLead` | No | Submit a public sales lead inquiry |
| `GET` | `/api/users/me` | `routes/userRoutes.js` | `userController.getCurrentUser` | **Yes (Bearer)** | Fetch logged-in user profile |
| `PUT` | `/api/users/onboarding` | `routes/userRoutes.js` | `userController.updateOnboardingStep` | **Yes (Bearer)** | Update progressive user onboarding fields |
| `GET` | `/api/health` | `server.js` | Inline Handler | No | Application health check status |

---

### Detailed Endpoint Analysis

#### 1. `POST /api/auth/register`
- **Controller:** `authController.register` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js#L9-L61))
- **Request Body:**
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "SecretPassword123",
    "role": "client" // optional, defaults to 'client'. Options: 'client', 'agency_owner', 'sales_admin'
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "message": "User registered successfully",
    "token": "eyJhbGciOiJIUzI1Ni...",
    "user": {
      "id": "66967f...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "role": "client",
      "onboardingStep": 0,
      "onboardingComplete": false
    }
  }
  ```
- **Errors:**
  - `400 Bad Request`: `{"message": "User already exists"}`
- **Execution Flow:** Checks if user email exists -> Hashes password with bcrypt (salt 10) -> Creates and saves `User` document -> Signs 24-hour JWT token -> Returns user data & token.

---

#### 2. `POST /api/auth/login`
- **Controller:** `authController.login` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js#L65-L111))
- **Request Body:**
  ```json
  {
    "email": "jane@example.com",
    "password": "SecretPassword123"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "message": "Login successful",
    "token": "eyJhbGciOiJIUzI1Ni...",
    "user": {
      "id": "66967f...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "role": "client",
      "tenantId": null,
      "onboardingStep": 0,
      "onboardingComplete": false
    }
  }
  ```
- **Errors:**
  - `401 Unauthorized`: `{"message": "Invalid credentials"}`
- **Execution Flow:** Queries `User` by email -> Compares password hash via `bcrypt.compare` -> Signs 24-hour JWT token -> Returns profile and token.

---

#### 3. `POST /api/auth/forgot-password`
- **Controller:** `authController.forgotPassword` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js#L115-L153))
- **Request Body:**
  ```json
  {
    "email": "jane@example.com"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "message": "OTP sent to email"
  }
  ```
- **Errors:**
  - `404 Not Found`: `{"message": "There is no user with that email address"}`
  - `500 Internal Server Error`: `{"message": "Email could not be sent"}`
- **Execution Flow:** Finds user -> Generates 6-digit random OTP -> Hashes OTP via `bcrypt` -> Saves hashed OTP and 15-minute expiration timestamp (`Date.now() + 15 * 60 * 1000`) on `User` document -> Calls `sendEmail()` utility.

---

#### 4. `POST /api/auth/verify-otp`
- **Controller:** `authController.verifyOtp` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js#L157-L187))
- **Request Body:**
  ```json
  {
    "email": "jane@example.com",
    "otp": "492015"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "message": "OTP verified successfully",
    "resetToken": "eyJhbGciOiJIUzI1Ni..."
  }
  ```
- **Errors:**
  - `400 Bad Request`: `{"message": "OTP is invalid or has expired"}`
  - `400 Bad Request`: `{"message": "Invalid OTP"}`
- **Execution Flow:** Finds user with email and `resetPasswordExpires > Date.now()` -> Compares provided OTP with stored hashed OTP via `bcrypt.compare` -> Generates 15-minute temporary JWT signed with `{ id, email, purpose: 'reset-password' }` -> Returns `resetToken`.

---

#### 5. `POST /api/auth/reset-password`
- **Controller:** `authController.resetPassword` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js#L191-L229))
- **Request Body:**
  ```json
  {
    "resetToken": "eyJhbGciOiJIUzI1Ni...",
    "newPassword": "NewSecurePassword456"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "message": "Password reset successfully. You can now log in."
  }
  ```
- **Errors:**
  - `400 Bad Request`: `{"message": "Missing token or new password"}`
  - `400 Bad Request`: `{"message": "Invalid token purpose"}`
  - `404 Not Found`: `{"message": "User not found"}`
  - `401 Unauthorized`: `{"message": "Invalid or expired token"}`
- **Execution Flow:** Decodes and verifies `resetToken` -> Checks `decoded.purpose === 'reset-password'` -> Finds user by `decoded.id` -> Hashes new password with `bcrypt` -> Unsets `resetPasswordOtp` and `resetPasswordExpires` -> Saves updated user.

---

#### 6. `GET /api/onboarding/invites/:token`
- **Controller:** `onboardingController.getInvite` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/onboardingController.js#L8-L21))
- **URL Parameter:** `token` (String)
- **Response `200 OK`:**
  ```json
  {
    "invite": {
      "_id": "66968a...",
      "token": "INVITE-88291",
      "companyName": "Acme Marketing",
      "description": "Enterprise Client Account",
      "brandColors": ["#FF5733", "#33FF57", "#3357FF"],
      "planTier": "tier2",
      "contactEmail": "admin@acme.com",
      "expiresAt": "2026-10-01T00:00:00.000Z",
      "redeemed": false,
      "createdBySales": true
    }
  }
  ```
- **Errors:**
  - `404 Not Found`: `{"message": "Invalid or expired invite code"}`
- **Execution Flow:** Queries `PendingTenant` where `token` matches parameter, `redeemed === false`, and `expiresAt > current date`.

---

#### 7. `POST /api/onboarding/tenants`
- **Controller:** `onboardingController.createTenant` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/onboardingController.js#L25-L48))
- **Request Body:**
  ```json
  {
    "companyName": "Acme Corp",
    "description": "Digital Marketing Agency",
    "brandColors": ["#1A1A1A", "#4A90E2", "#FFFFFF"],
    "planTier": "tier1", // Options: 'tier1', 'tier2', 'enterprise_pending'
    "createdVia": "self_serve", // Options: 'invite_code', 'self_serve'
    "ownerUserId": "66967f...",
    "inviteToken": "INVITE-88291" // optional
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "message": "Tenant created successfully",
    "tenant": {
      "_id": "66969b...",
      "companyName": "Acme Corp",
      "description": "Digital Marketing Agency",
      "brandColors": ["#1A1A1A", "#4A90E2", "#FFFFFF"],
      "planTier": "tier1",
      "status": "trial",
      "createdVia": "self_serve",
      "ownerUserId": "66967f..."
    }
  }
  ```
- **Errors:**
  - Mongoose ValidationError if `brandColors` length is not exactly 3 or required fields are missing.
- **Execution Flow:** Instantiates `Tenant` model -> Saves tenant document -> If `inviteToken` is provided, updates corresponding `PendingTenant` record setting `redeemed: true`.

---

#### 8. `POST /api/onboarding/leads`
- **Controller:** `onboardingController.submitLead` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/onboardingController.js#L52-L65))
- **Request Body:**
  ```json
  {
    "companyName": "Global Tech Sol",
    "contactEmail": "contact@globaltech.com",
    "message": "Interested in custom enterprise tier demo."
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "message": "Sales lead submitted successfully",
    "lead": {
      "_id": "6696a0...",
      "companyName": "Global Tech Sol",
      "contactEmail": "contact@globaltech.com",
      "message": "Interested in custom enterprise tier demo.",
      "status": "new"
    }
  }
  ```
- **Execution Flow:** Creates and saves new `SalesLead` document with default status `'new'`.

---

#### 9. `GET /api/users/me`
- **Controller:** `userController.getCurrentUser` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/userController.js#L64-L73))
- **Headers:** `Authorization: Bearer <token>`
- **Response `200 OK`:**
  ```json
  {
    "user": {
      "_id": "66967f...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "role": "client",
      "authProvider": "local",
      "onboardingStep": 2,
      "onboardingComplete": false,
      "businessType": "b2b",
      "companyName": "Acme Marketing",
      "industry": "Software",
      "companySize": "11-50",
      "createdAt": "2026-09-03T15:45:00.000Z",
      "updatedAt": "2026-09-03T15:50:00.000Z"
    }
  }
  ```
- **Errors:**
  - `401 Unauthorized`: `{"message": "Not authorized, no token"}` or `{"message": "Not authorized, token failed"}`
  - `404 Not Found`: `{"message": "User not found"}`

---

#### 10. `PUT /api/users/onboarding`
- **Controller:** `userController.updateOnboardingStep` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/userController.js#L6-L60))
- **Headers:** `Authorization: Bearer <token>`
- **Request Body (Partial or Full):**
  ```json
  {
    "onboardingStep": 3,
    "onboardingComplete": true,
    "businessType": "b2b",
    "companyName": "Acme Software",
    "industry": "Technology",
    "companySize": "51-200",
    "b2bClients": "10-50",
    "companyWebsite": "https://acme.com",
    "position": "CEO",
    "phoneNumber": "+1234567890",
    "brandColor": "#3357FF",
    "pricingTier": "tier2"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "message": "Onboarding step updated successfully",
    "user": {
      "id": "66967f...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "role": "client",
      "onboardingStep": 3,
      "onboardingComplete": true,
      "businessType": "b2b",
      "companyName": "Acme Software",
      "industry": "Technology",
      "companySize": "51-200",
      "b2bClients": "10-50",
      "companyWebsite": "https://acme.com",
      "position": "CEO",
      "phoneNumber": "+1234567890",
      "brandColor": "#3357FF",
      "pricingTier": "tier2"
    }
  }
  ```
- **Execution Flow:** Finds user by `req.user._id` -> Filters `req.body` against explicit `allowedFields` array -> Updates matched properties -> Saves user -> Returns sanitized user object.

---

## 6. Authentication and Authorization

### System Mechanics
- **Mechanism:** Stateless JSON Web Token (JWT) combined with bcrypt password hashing (10 salt rounds).
- **Token Signing:** Standard authentication tokens expire in `1d` (24 hours).
- **Password Reset Mechanism:** Two-stage flow utilizing numeric OTP + temporary reset token:
  1. `forgotPassword`: Generates 6-digit random numeric string (`100000` to `999999`). Hashes it with bcrypt and stores `resetPasswordOtp` and 15-minute expiration `resetPasswordExpires`. Sends unhashed OTP via email.
  2. `verifyOtp`: Compares user-supplied OTP with DB hashed OTP. Upon match, returns a 15-minute signed JWT containing `{ id, email, purpose: 'reset-password' }`.
  3. `resetPassword`: Verifies `resetToken` and confirms `decoded.purpose === 'reset-password'`. Hashes the new password, updates DB, and clears `resetPasswordOtp` and `resetPasswordExpires`.

### Protection Middleware
Defined in `middleware/authMiddleware.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/middleware/authMiddleware.js)):
```javascript
const protect = asyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      req.user = await User.findById(decoded.user?.id || decoded.id).select('-password');
      next();
    } catch (error) {
      res.status(401);
      throw new Error('Not authorized, token failed');
    }
  }
  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no token');
  }
});
```

### Roles and Permissions
Roles are defined in the `User` schema via `role: { type: String, enum: ['client', 'agency_owner', 'sales_admin'], required: true }`:
- **`client`:** Standard tenant user. Default role for self-registration.
- **`agency_owner`:** Organization administrator managing tenant configurations and team members.
- **`sales_admin`:** Platform administrator capable of pre-generating `PendingTenant` invite tokens and reviewing `SalesLead` entries.

---

## 7. Database Documentation

### Database Engine & Drivers
- **Database:** MongoDB
- **ODM Driver:** Mongoose (`v9.7.4`)
- **Connection Logic:** Implemented in `server.js`:
  ```javascript
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));
  ```

---

### Entity Schemas & Relationships

```
┌─────────────────────────┐           ┌─────────────────────────┐
│          User           │           │         Tenant          │
├─────────────────────────┤           ├─────────────────────────┤
│ _id (ObjectId)          │           │ _id (ObjectId)          │
│ name (String)           │           │ companyName (String)    │
│ email (String, Unique)  │◄──────────┤ ownerUserId (ObjectId)  │
│ password (String)       │  (Owner)  │ description (String)    │
│ role (Enum)             │           │ brandColors ([String]*3)│
│ tenantId (ObjectId) ────┼──────────►│ planTier (Enum)         │
│ authProvider (Enum)     │ (Belongs) │ status (Enum)           │
│ resetPasswordOtp       │           │ createdVia (Enum)       │
│ resetPasswordExpires   │           └─────────────────────────┘
│ onboardingStep          │
│ onboardingComplete      │           ┌─────────────────────────┐
│ businessType (Enum)     │           │      PendingTenant      │
│ companyName             │           ├─────────────────────────┤
│ industry                │           │ _id (ObjectId)          │
│ companySize             │           │ token (String, Unique)  │
│ b2bClients              │           │ companyName (String)    │
│ companyWebsite          │           │ planTier (String)       │
│ position                │           │ contactEmail (String)   │
│ phoneNumber             │           │ expiresAt (Date)        │
│ brandColor              │           │ redeemed (Boolean)      │
│ pricingTier             │           └─────────────────────────┘
└─────────────────────────┘
                                      ┌─────────────────────────┐
                                      │        SalesLead        │
                                      ├─────────────────────────┤
                                      │ _id (ObjectId)          │
                                      │ companyName (String)    │
                                      │ contactEmail (String)   │
                                      │ message (String)        │
                                      │ status (Enum)           │
                                      └─────────────────────────┘
```

#### Detailed Model Specs

1. **`User` Model (`models/User.js`):**
   - Stores user accounts, authentication credentials, role assignments, and onboarding profile metadata.
   - Index: Unique index on `email`.
   - References: `tenantId` -> `Tenant`.

2. **`Tenant` Model (`models/Tenant.js`):**
   - Stores organization entities.
   - Validation: Custom array validator ensuring `brandColors` contains exactly 3 string values (`arr => arr.length === 3`).
   - References: `ownerUserId` -> `User`.

3. **`PendingTenant` Model (`models/PendingTenant.js`):**
   - Stores single-use invitation tokens created by sales administrators.
   - Index: Unique index on `token`.

4. **`SalesLead` Model (`models/SalesLead.js`):**
   - Stores inbound contact requests.

---

## 8. Request Lifecycle

Here is the exact lifecycle of an authenticated request (e.g. `PUT /api/users/onboarding`):

```
Client App
   │
   │ 1. Sends HTTP PUT with 'Authorization: Bearer <JWT>'
   ▼
Express Server (server.js)
   │
   │ 2. Runs app.use(helmet()) -> Sets security headers (X-Frame-Options, CSP, etc.)
   │ 3. Runs app.use(cors()) -> Verifies Origin header
   │ 4. Runs app.use(express.json()) -> Parses incoming raw body into req.body object
   │ 5. Runs app.use(morgan()) -> Logs HTTP method, URL, status code, response time
   │ 6. Runs rateLimit middleware -> Checks request count for client IP
   ▼
Router Matching (routes/userRoutes.js)
   │
   │ 7. Matches 'PUT /onboarding' endpoint
   ▼
Auth Guard Middleware (middleware/authMiddleware.js)
   │
   │ 8. Extracts Bearer token string from req.headers.authorization
   │ 9. Verifies token signature and expiration via jwt.verify()
   │10. Queries DB: User.findById(decoded.user.id).select('-password')
   │11. Attaches user object to req.user
   ▼
Controller Execution (controllers/userController.js)
   │
   │12. Wrapped inside asyncHandler helper (utils/asyncHandler.js)
   │13. Finds user: User.findById(req.user._id)
   │14. Whitelists fields from req.body (matches against allowedFields array)
   │15. Mutates allowed user fields
   │16. Calls user.save() -> Mongoose persists update to MongoDB
   ▼
Response Handshake
   │
   │17. res.json(...) returns HTTP 200 OK with sanitized user object
   ▼
[If Exception Thrown at Any Point]
   │
   └─► Caught by asyncHandler -> Passes error to next(err)
         └─► Express forwards error to errorMiddleware.js
               └─► Responds HTTP status code (4xx/5xx) + JSON { message, stack }
```

---

## 9. Controllers

### 1. `authController.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js))
- **`register`:** Handles user signup. Hashes password via bcrypt, stores user, signs and returns JWT.
- **`login`:** Validates email and password via bcrypt.compare. Returns user profile and JWT.
- **`forgotPassword`:** Generates 6-digit numeric OTP, stores bcrypt-hashed OTP with 15m expiration, sends OTP via `sendEmail`.
- **`verifyOtp`:** Validates OTP string against stored hash for unexpired user, generates temporary 15m reset JWT.
- **`resetPassword`:** Decodes reset JWT, verifies `purpose === 'reset-password'`, hashes new password, unsets OTP fields.

### 2. `onboardingController.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/onboardingController.js))
- **`getInvite`:** Queries `PendingTenant` by token string where `redeemed === false` and `expiresAt > Date.now()`.
- **`createTenant`:** Creates new `Tenant` record. If `inviteToken` is provided, marks `PendingTenant` as `redeemed: true`.
- **`submitLead`:** Persists public sales lead message into `SalesLead` collection.

### 3. `userController.js` ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/userController.js))
- **`updateOnboardingStep`:** Updates allowed onboarding properties on `User` model using an explicit whitelist array.
- **`getCurrentUser`:** Fetches authenticated user profile by `req.user._id`, omitting password field.

---

## 10. Services / Business Logic

The GrowthOS backend embeds business logic directly within controller functions rather than maintaining a separate `services/` folder. Key business operations include:

1. **OTP Generation & Lifecycle:**
   - 6-digit random number generated via `Math.floor(100000 + Math.random() * 900000).toString()`.
   - Hashed before saving to DB to prevent plaintext OTP exposure if database is compromised.
   - Automated invalidation after 15 minutes.
2. **Tenant Provisioning:**
   - Supports self-serve or invite-driven flows.
   - Enforces strict array length (3 items) on brand hex colors.
3. **Onboarding Property Injection Protection:**
   - Whitelists acceptable keys in `userController.js` to prevent malicious mutation of sensitive fields (e.g. `role`, `password`, `_id`).

---

## 11. Middleware

### 1. `protect` (`middleware/authMiddleware.js`)
- **Purpose:** Protects endpoints requiring authentication.
- **Operation:** Inspects `Authorization` header for `Bearer <token>`. Verifies JWT signature using `process.env.JWT_SECRET`. Fetches user document without password field and attaches to `req.user`.
- **Failure:** Throws 401 Unauthorized if token is missing, invalid, or expired.

### 2. `errorHandler` (`middleware/errorMiddleware.js`)
- **Purpose:** Centralized global error handling.
- **Operation:** Catches unhandled errors passed through Express `next(err)`. Automatically uses existing `res.statusCode` (or defaults to 500 if status code is 200). Returns JSON `{ message: err.message, stack }`. Stack trace is set to `null` if `NODE_ENV === 'production'`.

### 3. Third-Party Global Middleware (`server.js`)
- **`helmet()`:** Sets standard HTTP security headers to protect against clickjacking, cross-site scripting (XSS), etc.
- **`cors()`:** Enables cross-origin request access for web applications.
- **`express.json()`:** Parses incoming JSON request payloads into `req.body`.
- **`morgan()`:** HTTP logger format selected dynamically based on `NODE_ENV` (`combined` for production, `dev` for development).
- **`express-rate-limit`:** Implements IP rate limiting (100 requests per 15 minutes per IP under `/api`).

---

## 12. Models / Schemas

### 1. User Schema (`models/User.js`)
| Field Name | Type | Options / Validation | Default |
| :--- | :--- | :--- | :--- |
| `name` | String | `required: true` | - |
| `email` | String | `required: true`, `unique: true` | - |
| `password` | String | Optional (for OAuth support) | - |
| `authProvider` | String | `enum: ['local', 'google', 'linkedin']` | `'local'` |
| `role` | String | `enum: ['client', 'agency_owner', 'sales_admin']`, `required: true` | - |
| `tenantId` | ObjectId | `ref: 'Tenant'` | - |
| `resetPasswordOtp` | String | Hashed OTP string | - |
| `resetPasswordExpires`| Date | OTP expiration timestamp | - |
| `onboardingStep` | Number | Integer tracking current step | `0` |
| `onboardingComplete` | Boolean | True when completed | `false` |
| `businessType` | String | `enum: ['b2b', 'b2c']` | - |
| `companyName` | String | Text | - |
| `industry` | String | Text | - |
| `companySize` | String | Text (e.g. "11-50") | - |
| `b2bClients` | String | Text | - |
| `companyWebsite` | String | Text | - |
| `position` | String | Text | - |
| `phoneNumber` | String | Text | - |
| `brandColor` | String | Text | - |
| `pricingTier` | String | Text | - |

---

### 2. Tenant Schema (`models/Tenant.js`)
| Field Name | Type | Options / Validation | Default |
| :--- | :--- | :--- | :--- |
| `companyName` | String | `required: true` | - |
| `description` | String | Text | - |
| `brandColors` | [String] | Custom validator: `arr.length === 3` | - |
| `planTier` | String | `enum: ['tier1', 'tier2', 'enterprise_pending']`, `required: true` | - |
| `status` | String | `enum: ['trial', 'active']` | `'trial'` |
| `createdVia` | String | `enum: ['invite_code', 'self_serve']`, `required: true` | - |
| `ownerUserId` | ObjectId | `ref: 'User'` | - |

---

### 3. PendingTenant Schema (`models/PendingTenant.js`)
| Field Name | Type | Options / Validation | Default |
| :--- | :--- | :--- | :--- |
| `token` | String | `required: true`, `unique: true` | - |
| `companyName` | String | `required: true` | - |
| `description` | String | Text | - |
| `brandColors` | [String] | Custom validator: `arr.length === 3` | - |
| `planTier` | String | `required: true` | - |
| `contactEmail` | String | `required: true` | - |
| `expiresAt` | Date | `required: true` | - |
| `redeemed` | Boolean | Invalidation flag | `false` |
| `createdBySales`| Boolean| Creator indicator | `true` |

---

### 4. SalesLead Schema (`models/SalesLead.js`)
| Field Name | Type | Options / Validation | Default |
| :--- | :--- | :--- | :--- |
| `companyName` | String | `required: true` | - |
| `contactEmail` | String | `required: true` | - |
| `message` | String | Text message | - |
| `status` | String | `enum: ['new', 'contacted', 'closed']` | `'new'` |

---

## 13. Validation

Data validation is performed through two layers:

1. **Mongoose Schema Validation:**
   - Field requirement checks (`required: true`).
   - Unique constraints on `User.email` and `PendingTenant.token`.
   - String enumeration enforcement (`role`, `authProvider`, `businessType`, `planTier`, `status`, `createdVia`).
   - Custom array length validation on `Tenant.brandColors` and `PendingTenant.brandColors` requiring exactly 3 hex/color strings (`validate: [arr => arr.length === 3, 'Exactly 3 brand colors required']`).
2. **Controller Request Filtering:**
   - Explicit whitelist array validation in `userController.updateOnboardingStep` to prevent field injection:
     ```javascript
     const allowedFields = [
       'onboardingStep', 'onboardingComplete', 'businessType', 'companyName',
       'industry', 'companySize', 'b2bClients', 'companyWebsite',
       'position', 'phoneNumber', 'brandColor', 'pricingTier'
     ];
     ```

---

## 14. Error Handling

### Error Strategy Rules
- Controllers do **NOT** use `try/catch` blocks (per `AI_GUIDELINES.md`).
- All async controller functions are wrapped with `asyncHandler` (`utils/asyncHandler.js`):
  ```javascript
  const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
  ```
- To signal an operational error, controllers set `res.status(code)` and throw an `Error`:
  ```javascript
  res.status(401);
  throw new Error('Invalid credentials');
  ```
- Unhandled rejections are caught by `asyncHandler` and passed to `next(err)`, landing in `middleware/errorMiddleware.js`.
- The error handler returns JSON output:
  ```json
  {
    "message": "Invalid credentials",
    "stack": null // Stack trace is populated in dev, null in production
  }
  ```

---

## 15. Environment Variables

The application consumes environment variables using `dotenv`. Critical environment variables are checked during initial startup in `server.js`.

| Variable Name | Purpose | Used In File(s) | Required / Optional | Sensitivity |
| :--- | :--- | :--- | :--- | :--- |
| `MONGODB_URI` | MongoDB connection URI string | `server.js` | **Required** (App crashes if missing) | **High** |
| `JWT_SECRET` | Secret key for signing and verifying JWTs | `server.js`, `authController.js`, `authMiddleware.js` | **Required** (App crashes if missing) | **High** |
| `PORT` | Listening port for Express HTTP server | `server.js` | Optional (Defaults to `5000`) | Low |
| `NODE_ENV` | Environment mode (`development` / `production`) | `server.js`, `errorMiddleware.js` | Optional (Defaults to `development`) | Low |
| `SMTP_HOST` | Host address of SMTP email server | `utils/sendEmail.js` | Optional (Defaults to `smtp.mailtrap.io`) | Medium |
| `SMTP_PORT` | Port number of SMTP email server | `utils/sendEmail.js` | Optional (Defaults to `2525`) | Low |
| `SMTP_EMAIL` | Username/email for SMTP server auth | `utils/sendEmail.js` | Optional (Defaults to `dummy_user`) | **High** |
| `SMTP_PASSWORD` | Password for SMTP server auth | `utils/sendEmail.js` | Optional (Defaults to `dummy_password`) | **High** |
| `FROM_NAME` | Display name for outbound emails | `utils/sendEmail.js` | Optional (Defaults to `GrowthOS`) | Low |
| `FROM_EMAIL` | Outbound sender email address | `utils/sendEmail.js` | Optional (Defaults to `noreply@growthos.com`) | Low |

---

## 16. External Services / APIs

### Nodemailer (Email Dispatch)
- **Purpose:** Used for sending transactional emails (such as password reset OTP messages).
- **Configuration:** Configured in `utils/sendEmail.js` using standard SMTP options (`SMTP_HOST`, `SMTP_PORT`, `SMTP_EMAIL`, `SMTP_PASSWORD`).
- **Development Fallback:** If `SMTP_EMAIL` is missing or equal to `'dummy_user'`, `sendEmail.js` does NOT throw an error; instead, it outputs formatted email contents directly to the server console log for local testing:
  ```
  ===================================================
  [DEV MODE] Email intended for: user@example.com
  [DEV MODE] Subject: Password Reset OTP
  [DEV MODE] Message:
  Your password reset OTP is: 123456
  ===================================================
  ```

---

## 17. File Upload System

*Not implemented in the current repository version.* There are no file upload middlewares (e.g. Multer) or cloud storage integrations (e.g. AWS S3, Cloudinary) configured.

---

## 18. Background Jobs / Queues / Cron

*Not implemented in the current repository version.* Tasks such as email dispatch are handled inline asynchronously. There are no background job queues (e.g. BullMQ, Redis) or cron schedulers attached.

---

## 19. Caching

*Not implemented in the current repository version.* Responses are calculated and served directly from MongoDB queries. No Redis or in-memory cache layer is currently integrated.

---

## 20. Logging and Monitoring

### HTTP Request Logging
- **Library:** `morgan` (`v1.11.0`)
- **Implementation:** Registered globally in `server.js`:
  ```javascript
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  ```
- **Behavior:** In development mode (`dev`), outputs concise, color-coded response status logs to console. In production mode (`combined`), logs standard Apache-style combined HTTP logs.

### Operational Logging
- Standard console outputs for database connectivity (`Connected to MongoDB`) and HTTP server listening state (`Server running on port 5000 in development mode`).

---

## 21. Security

### Existing Security Implementations
1. **Password Security:** Passwords are never stored in plain text. Hashed using `bcrypt` with a cost factor of 10.
2. **HTTP Header Security:** `helmet()` is applied globally to prevent clickjacking, MIME sniffing, and cross-site scripting (XSS).
3. **Rate Limiting:** `express-rate-limit` limits clients to 100 requests per 15-minute window per IP under `/api` routes to prevent DDoS and brute-force attacks.
4. **Token Security:** JWTs are signed with a server secret (`JWT_SECRET`) and expire in 24 hours (or 15 minutes for password reset tokens). Reset tokens include explicit `purpose: 'reset-password'` payload checks.
5. **Sensitive Field Protection:** User model password hashes are excluded from responses via `.select('-password')`.
6. **Stack Trace Hiding:** Error middleware sets `stack: null` when `NODE_ENV === 'production'`.
7. **Mass Assignment Prevention:** White-listing allowed fields during user onboarding step updates prevents privilege escalation.

### Identified Security Gaps & Recommendations
> [!WARNING]
> 1. **Missing Role-Based Access Control (RBAC) Middleware:** While roles (`client`, `agency_owner`, `sales_admin`) exist in the `User` schema, there is no authorization middleware enforcing role restrictions on protected endpoints.
> 2. **CORS Configuration:** `app.use(cors())` uses default settings, allowing access from any origin (`*`). It should be restricted to specific frontend domains in production.
> 3. **Fallback Secrets:** Fallback values like `'secret'` exist for `JWT_SECRET` in controllers if env variables are missing during runtime execution (though `server.js` checks startup variables).

---

## 22. Important Utility Functions

### 1. `asyncHandler` (`utils/asyncHandler.js`) ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/utils/asyncHandler.js))
- **Signature:** `(fn: Function) => (req: Request, res: Response, next: NextFunction) => void`
- **Purpose:** Wraps async functions to automatically route rejected promises to Express error handling middleware without requiring `try/catch` blocks.
- **Used In:** All controller modules (`authController.js`, `onboardingController.js`, `userController.js`) and `authMiddleware.js`.

### 2. `sendEmail` (`utils/sendEmail.js`) ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/utils/sendEmail.js))
- **Signature:** `(options: { email: string, subject: string, message: string, html?: string }) => Promise<void>`
- **Purpose:** Sends emails via Nodemailer with console logging fallback for dev mode when SMTP credentials are absent.
- **Used In:** `authController.forgotPassword`.

---

## 23. Important Constants and Enums

### Schemas Enums
- **User Roles:** `['client', 'agency_owner', 'sales_admin']` (`User.js`)
- **Authentication Providers:** `['local', 'google', 'linkedin']` (`User.js`)
- **Business Types:** `['b2b', 'b2c']` (`User.js`)
- **Tenant Plan Tiers:** `['tier1', 'tier2', 'enterprise_pending']` (`Tenant.js`)
- **Tenant Statuses:** `['trial', 'active']` (`Tenant.js`)
- **Tenant Creation Methods:** `['invite_code', 'self_serve']` (`Tenant.js`)
- **Sales Lead Statuses:** `['new', 'contacted', 'closed']` (`SalesLead.js`)

---

## 24. Main Features of the Backend

### Feature 1: User Authentication & Security
- **Endpoints:** `POST /api/auth/register`, `POST /api/auth/login`
- **Involved Files:** [auth.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/routes/auth.js), [authController.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js), [User.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/User.js)
- **Description:** Enables user registration and credential-based login. Validates password hashes via bcrypt and returns JWT signed tokens.

### Feature 2: OTP-Based Password Recovery
- **Endpoints:** `POST /api/auth/forgot-password`, `POST /api/auth/verify-otp`, `POST /api/auth/reset-password`
- **Involved Files:** [authController.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js), [sendEmail.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/utils/sendEmail.js), [User.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/User.js)
- **Description:** Sends 6-digit OTP to user email. Verifies OTP against hashed DB record and grants a 15-minute reset token to complete password reset safely.

### Feature 3: Tenant & Invite Management
- **Endpoints:** `GET /api/onboarding/invites/:token`, `POST /api/onboarding/tenants`
- **Involved Files:** [onboarding.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/routes/onboarding.js), [onboardingController.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/onboardingController.js), [Tenant.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/Tenant.js), [PendingTenant.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/PendingTenant.js)
- **Description:** Verifies sales-issued invite tokens, creates tenant entities with strict brand color validations, and redeems invitation tokens.

### Feature 4: Lead Capture System
- **Endpoint:** `POST /api/onboarding/leads`
- **Involved Files:** [onboardingController.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/onboardingController.js), [SalesLead.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/SalesLead.js)
- **Description:** Stores prospect inquiry submissions for follow-up by the sales team.

### Feature 5: Stateful User Onboarding Sync
- **Endpoints:** `GET /api/users/me`, `PUT /api/users/onboarding`
- **Involved Files:** [userRoutes.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/routes/userRoutes.js), [userController.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/userController.js), [authMiddleware.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/middleware/authMiddleware.js), [User.js](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/User.js)
- **Description:** Returns authenticated profile data and processes step-by-step onboarding updates safely via property whitelisting.

---

## 25. Feature Flow Diagrams

### 1. Password Reset Flow (OTP & Verification)

```
User (Client)            Backend API                    Database (MongoDB)           Mail Service
     │                        │                                 │                         │
     │ 1. POST /forgot-password (email)                         │                         │
     ├───────────────────────►│                                 │                         │
     │                        │ 2. Find User                    │                         │
     │                        ├────────────────────────────────►│                         │
     │                        │ 3. Generate 6-digit OTP & Hash  │                         │
     │                        │ 4. Save resetPasswordOtp/Expires│                         │
     │                        ├────────────────────────────────►│                         │
     │                        │ 5. Send OTP Email               │                         │
     │                        ├──────────────────────────────────────────────────────────►│
     │                        │ 6. Response 200 OK              │                         │
     │◄───────────────────────┤                                 │                         │
     │                        │                                 │                         │
     │ 7. POST /verify-otp (email, otp)                         │                         │
     ├───────────────────────►│                                 │                         │
     │                        │ 8. Validate OTP & Expiration    │                         │
     │                        ├────────────────────────────────►│                         │
     │                        │ 9. Generate 15m Reset Token     │                         │
     │                        │10. Response 200 OK (resetToken) │                         │
     │◄───────────────────────┤                                 │                         │
     │                        │                                 │                         │
     │11. POST /reset-password (resetToken, newPassword)        │                         │
     ├───────────────────────►│                                 │                         │
     │                        │12. Verify Token & purpose       │                         │
     │                        │13. Hash New Password            │                         │
     │                        │14. Update User & Clear OTP      │                         │
     │                        ├────────────────────────────────►│                         │
     │                        │15. Response 200 OK              │                         │
     │◄───────────────────────┤                                 │                         │
```

---

### 2. Tenant Provisioning & Invite Redemption Flow

```
User / Frontend          Backend API                    Database (MongoDB)
     │                        │                                 │
     │ 1. POST /api/onboarding/tenants                        │
     │    { companyName, brandColors, inviteToken, ... }        │
     ├───────────────────────►│                                 │
     │                        │ 2. Validate Brand Colors        │
     │                        │    (Must be length === 3)       │
     │                        │ 3. Create & Save Tenant         │
     │                        ├────────────────────────────────►│
     │                        │                                 │
     │                        │ 4. If inviteToken present:      │
     │                        │    Update PendingTenant         │
     │                        │    set redeemed = true          │
     │                        ├────────────────────────────────►│
     │                        │                                 │
     │                        │ 5. Response 201 Created         │
     │◄───────────────────────┤                                 │
```

---

## 26. Dependency Analysis

### Dependencies (`package.json`)

#### Production Dependencies
- **`express` (`^5.2.1`):** Core web application framework (notably using Express v5).
- **`mongoose` (`^9.7.4`):** Object Data Modeling (ODM) library for MongoDB.
- **`jsonwebtoken` (`^9.0.3`):** Implementation of JSON Web Tokens for authentication.
- **`bcrypt` (`^6.0.0`):** Password hashing library utilizing key derivation functions.
- **`nodemailer` (`^9.0.3`):** Client for sending emails via SMTP.
- **`helmet` (`^8.3.0`):** Middleware providing security headers.
- **`express-rate-limit` (`^8.5.2`):** Middleware for rate limiting API calls.
- **`cors` (`^2.8.6`):** Middleware enabling Cross-Origin Resource Sharing.
- **`morgan` (`^1.11.0`):** HTTP request logging middleware.
- **`dotenv` (`^17.4.2`):** Zero-dependency module loading environment variables from `.env`.

#### Development Dependencies
- **`nodemon` (`^3.1.14`):** Utility monitoring source changes and automatically restarting Node server.

---

## 27. Important Configuration

### 1. Server Configuration (`server.js`)
- Critical environment checks at boot exit process immediately (`process.exit(1)`) if `MONGODB_URI` or `JWT_SECRET` are not set.
- Rate limiting configured to 100 requests per 15 minutes per IP applied to `/api` routes.
- HTTP request logging switches between `combined` (production) and `dev` (development) formats automatically based on `NODE_ENV`.

### 2. Guideline Enforcement (`AI_GUIDELINES.md`)
- Mandates `asyncHandler` usage for all async controller functions.
- Prohibits standard `try/catch` blocks inside controllers.
- Enforces strict architectural change documentation in `CHANGES_TIMELINE.md`.

---

## 28. How to Run the Project Locally

### Prerequisites
- **Node.js:** v18.x or higher installed.
- **npm:** v9.x or higher installed.
- **MongoDB:** A running MongoDB instance (Local server or MongoDB Atlas connection string).

### Step-by-Step Local Setup

1. **Clone & Navigate to Workspace:**
   ```bash
   cd d:\Internships\Renoweb\Growth-OS-Backend
   ```

2. **Install Node Dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/growthos
   JWT_SECRET=your_super_secret_jwt_key_here
   
   # Optional Email Setup (Leave default for console logging fallback)
   SMTP_HOST=smtp.mailtrap.io
   SMTP_PORT=2525
   SMTP_EMAIL=dummy_user
   SMTP_PASSWORD=dummy_password
   FROM_NAME=GrowthOS
   FROM_EMAIL=noreply@growthos.com
   ```

4. **Start Development Server:**
   ```bash
   npm run dev
   ```
   *Expected Output:*
   ```
   [nodemon] 3.1.14
   [nodemon] to restart at any time, enter `rs`
   [nodemon] watching path(s): *.*
   [nodemon] watching extensions: js,mjs,cjs,json
   [nodemon] starting `node server.js`
   Connected to MongoDB
   Server running on port 5000 in development mode
   ```

5. **Verify API Status:**
   Visit `http://localhost:5000/api/health` in your browser or Postman.
   Response: `{"status":"ok","message":"GrowthOS API is running safely"}`.

---

## 29. Deployment

### Production Preparation
1. **Set Production Environment Variables:**
   - Set `NODE_ENV=production`.
   - Set strong secrets for `JWT_SECRET` and secure `MONGODB_URI`.
   - Set valid production SMTP credentials (`SMTP_EMAIL`, `SMTP_PASSWORD`, `SMTP_HOST`).
2. **Production Startup Command:**
   ```bash
   node server.js
   ```
   *(Or using a process manager such as PM2: `pm2 start server.js --name growthos-backend`)*.

---

## 30. Testing

### Current Status
- No automated test suite is currently configured in `package.json` (`"test": "echo \"Error: no test specified\" && exit 1"`).

### Recommended Testing Implementation
- **Unit Testing:** Implement Jest or Vitest for testing utility functions (`asyncHandler`, `sendEmail`).
- **Integration & API Testing:** Implement Supertest + Jest to test routes (`/api/auth/*`, `/api/onboarding/*`, `/api/users/*`).

---

## 31. Important Code Flows to Understand

Ranked order of priority flows for new backend developers joining GrowthOS:

1. **Password Reset OTP Lifecycle:**
   - *Why it matters:* Multi-step flow involving OTP generation, hashing, time-based expiration, email utility execution, temporary token generation, and password update.
   - *Files:* `authController.js` ([L115-L229](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js#L115-L229)), `sendEmail.js`, `User.js`.
2. **Authentication & Protecting Routes:**
   - *Why it matters:* Core security layer verifying JWTs and attaching user state to requests.
   - *Files:* `authMiddleware.js` ([L5-L28](file:///d:/Internships/Renoweb/Growth-OS-Backend/middleware/authMiddleware.js#L5-L28)), `authController.js`, `userRoutes.js`.
3. **Multi-Tenant Provisioning & Invitation Redemption:**
   - *Why it matters:* Key domain flow linking organizations, user ownership, custom validations (brand colors), and single-use invite tokens.
   - *Files:* `onboardingController.js` ([L8-L48](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/onboardingController.js#L8-L48)), `Tenant.js`, `PendingTenant.js`.
4. **Onboarding Progress Synchronization:**
   - *Why it matters:* Demonstrates input sanitization via whitelisting to safely allow multi-step user profile updates.
   - *Files:* `userController.js` ([L6-L60](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/userController.js#L6-L60)), `User.js`.

---

## 32. Code Quality / Possible Issues

### Confirmed Issues / Gaps
1. **Missing Role Enforcement Middleware:** Roles exist in `User.js`, but endpoints lack role-checking guards (e.g. any authenticated user can hit `/api/users/me`).
2. **Lack of Database Transactions:** In `onboardingController.createTenant`, tenant creation and `PendingTenant` token redemption occur sequentially without a MongoDB session transaction. If token redemption fails, tenant creation is not rolled back.
3. **No Automated Test Coverage:** No unit or integration tests exist in the repository.
4. **Missing Request Schema Validation Library:** Validation relies on Mongoose schemas and manual whitelisting rather than upfront validation libraries (e.g. Zod, Joi).

### Potential Concerns
1. **Dual JWT User ID Property Structure:** In `authMiddleware.js`, user lookup checks `decoded.user?.id || decoded.id`. This handles both standard auth tokens (`{ user: { id } }`) and password reset tokens (`{ id }`), but consolidating JWT payload structures would improve consistency.

---

## 33. Things That Are Easy to Miss

1. **Fatal Environmental Boot Check:** `server.js` exits immediately (`process.exit(1)`) if `MONGODB_URI` or `JWT_SECRET` are undefined.
2. **Silent Email Console Fallback:** If `SMTP_EMAIL` is unset or equals `'dummy_user'`, `sendEmail.js` outputs email content to `console.log` rather than throwing an SMTP connection error.
3. **Strict Brand Colors Constraint:** `Tenant.js` and `PendingTenant.js` enforce a custom array validator that fails if `brandColors` contains any number of items other than **exactly 3**.
4. **Token Purpose Claim Check:** `verifyOtp` issues a reset token with `purpose: 'reset-password'`. `resetPassword` validates `decoded.purpose === 'reset-password'`, preventing general auth tokens from resetting passwords.
5. **No `try/catch` Rule:** Per repository rules (`AI_GUIDELINES.md`), controllers must avoid `try/catch` and use `asyncHandler`.

---

## 34. Backend Developer Onboarding Guide

### First Files to Read (In Recommended Order)
1. **`server.js`** ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/server.js)): Understand server boot logic, middleware stack, and database initialization.
2. **`middleware/authMiddleware.js`** ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/middleware/authMiddleware.js)) & **`middleware/errorMiddleware.js`** ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/middleware/errorMiddleware.js)): Understand authentication guards and centralized error handling.
3. **`utils/asyncHandler.js`** ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/utils/asyncHandler.js)): Understand why controllers lack `try/catch` blocks.
4. **`models/User.js`** ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/User.js)) & **`models/Tenant.js`** ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/models/Tenant.js)): Understand core data entities and validation constraints.
5. **`controllers/authController.js`** ([view](file:///d:/Internships/Renoweb/Growth-OS-Backend/controllers/authController.js)): Understand authentication and OTP flows.

### Critical Rules Before Modifying Code
- Never wrap controller logic in `try/catch`. Use `asyncHandler`.
- Always document new logic in `CHANGES_TIMELINE.md`.
- Keep `README.md` diagrams in sync when modifying architecture or routes.
- Respect Mongoose schema constraints (e.g. `brandColors` array length).

---

## 35. Final Project Summary

### Project in 10 Points
1. **Purpose:** Node.js/Express REST API powering GrowthOS multi-tenant SaaS application.
2. **Architecture:** Model-Controller-Routes architecture with centralized middleware and MongoDB.
3. **Authentication:** JWT authentication with bcrypt password hashing (10 salt rounds).
4. **Password Reset:** 2-step OTP flow (6-digit OTP -> email -> temporary 15m reset JWT -> password reset).
5. **Tenants:** Supports self-serve and invite-driven tenant creation with brand color validation.
6. **Lead Generation:** Public endpoint to capture prospective client sales leads.
7. **Onboarding:** Stateful multi-step onboarding sync with strict property whitelisting.
8. **Security:** Protected by Helmet security headers, rate limiting (100 req/15 min), and CORS.
9. **Error Handling:** Centralized error handler + `asyncHandler` wrapper eliminating controller `try/catch`.
10. **Emailing:** Nodemailer wrapper with automatic console output fallback for local development.

---

### Architecture in One View

```
[ Client Application ]
         │
         ▼
[ HTTP Server: server.js ]
   ├── Helmet Header Security
   ├── CORS Cross-Origin Handler
   ├── Express Body Parser (JSON)
   ├── Morgan HTTP Request Logger
   └── Express Rate Limiter (100 req / 15 min)
         │
         ▼
[ Express Router Layer ]
   ├── /api/auth       ---> [ authController.js ]
   ├── /api/onboarding ---> [ onboardingController.js ]
   └── /api/users      ---> [ userController.js ] (Protected via authMiddleware.js)
         │
         ▼
[ Processing Layer ]
   ├── Helpers: asyncHandler.js, sendEmail.js
   └── Data Models: User.js, Tenant.js, PendingTenant.js, SalesLead.js
         │
         ▼
[ Database Layer: MongoDB ]
```

---

### Important Files Cheat Sheet

| File Path | Primary Purpose | Architectural Importance |
| :--- | :--- | :--- |
| `server.js` | Server boot & application entry point | **Critical** |
| `middleware/authMiddleware.js` | JWT Bearer token authentication guard | **Critical** |
| `middleware/errorMiddleware.js` | Global error response formatter | **High** |
| `controllers/authController.js` | Authentication & OTP password reset handlers | **Critical** |
| `controllers/onboardingController.js` | Tenant provisioning & invite redemption | **High** |
| `controllers/userController.js` | Profile retrieval & onboarding step sync | **High** |
| `models/User.js` | User entity schema & onboarding attributes | **Critical** |
| `models/Tenant.js` | Organization entity schema | **High** |
| `utils/asyncHandler.js` | Async error handling wrapper | **Critical** |
| `utils/sendEmail.js` | Nodemailer email dispatch helper | **Medium** |

---

### Important APIs Cheat Sheet

| Verb | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | User signup & JWT issuance | No |
| `POST` | `/api/auth/login` | User login & JWT issuance | No |
| `POST` | `/api/auth/forgot-password` | Request password reset OTP email | No |
| `POST` | `/api/auth/verify-otp` | Verify OTP & receive reset token | No |
| `POST` | `/api/auth/reset-password` | Set new password using reset token | No |
| `GET` | `/api/onboarding/invites/:token` | Retrieve unredeemed invite details | No |
| `POST` | `/api/onboarding/tenants` | Create tenant organization | No |
| `POST` | `/api/onboarding/leads` | Submit sales lead inquiry | No |
| `GET` | `/api/users/me` | Fetch logged-in user profile | **Yes** |
| `PUT` | `/api/users/onboarding` | Save onboarding step progress | **Yes** |

---

### Important Database Tables Cheat Sheet

| Model Name | Main Purpose | Key Fields |
| :--- | :--- | :--- |
| `User` | User identity & onboarding state | `email`, `password`, `role`, `tenantId`, `resetPasswordOtp`, `onboardingStep` |
| `Tenant` | Tenant organization account | `companyName`, `brandColors`, `planTier`, `status`, `ownerUserId` |
| `PendingTenant` | Pre-approved invite tokens | `token`, `companyName`, `contactEmail`, `expiresAt`, `redeemed` |
| `SalesLead` | Prospective client contact leads | `companyName`, `contactEmail`, `message`, `status` |

---

### Important Environment Variables Cheat Sheet

| Variable | Recommended Dev Value | Purpose |
| :--- | :--- | :--- |
| `MONGODB_URI` | `mongodb://localhost:27017/growthos` | MongoDB database URI |
| `JWT_SECRET` | `your_secret_key` | Key for signing JWTs |
| `PORT` | `5000` | HTTP listening port |
| `NODE_ENV` | `development` | Runtime environment mode |
| `SMTP_EMAIL` | `dummy_user` | SMTP username (logs to console if dummy) |

---

### Things I Should Remember Before Editing Code
1. **Never add `try/catch` blocks inside controllers.** Wrap the function with `asyncHandler`.
2. **Ensure `MONGODB_URI` and `JWT_SECRET` exist in your local `.env`.** Server will exit immediately otherwise.
3. **Respect `brandColors` schema validation.** Array MUST contain exactly 3 color strings when creating a `Tenant`.
4. **Log changes in `CHANGES_TIMELINE.md`.** Update documentation whenever adding or altering endpoints or data models.
