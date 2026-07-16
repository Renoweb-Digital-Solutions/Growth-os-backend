# Backend Changes Timeline

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
