# GrowthOS Backend

Central technical documentation for the GrowthOS Node.js / Express backend API.

## Architecture & Data Flow

The backend employs a Model-Controller-Routes architecture with centralized error handling and middleware.

```mermaid
graph TD
    Client((Client App)) -->|HTTP Request| Server[server.js]
    
    subgraph Middleware
        Server --> Helmet[Helmet/Security]
        Helmet --> RateLimit[Rate Limiter]
        RateLimit --> Morgan[Logging]
    end
    
    Morgan --> Routes[API Routes]
    
    Routes -->|/api/auth| AuthCtrl[authController]
    Routes -->|/api/onboarding| OnboardCtrl[onboardingController]
    
    AuthCtrl -->|Uses| UserMod[User Model]
    OnboardCtrl -->|Uses| TenantMod[Tenant Models]
    
    UserMod -.-> DB[(MongoDB)]
    TenantMod -.-> DB
    
    AuthCtrl -.-> ErrorMid[errorMiddleware]
    OnboardCtrl -.-> ErrorMid
```

## Guidelines
See `AI_GUIDELINES.md` for AI and developer contribution rules. Check `CHANGES_TIMELINE.md` for a historical log of implementations.
