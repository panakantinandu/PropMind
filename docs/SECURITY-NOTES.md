# Security Status Report - LeaseHub

**Last Updated:** January 15, 2026

## Summary

LeaseHub has been hardened against common web application threats such as session hijacking, CSRF, NoSQL injection, and basic XSS vectors. All **production runtime vulnerabilities** identified during review have been mitigated. Any remaining npm audit warnings are **dev-only or low-severity** and do not impact deployed environments.

---

## ✅ Security Measures Implemented

### 1. Authentication & Authorization

- **Role-based access control**
  - Separate **Tenant** and **Admin** roles.
  - Admin-only access to management, configuration, and reporting routes.
- **Database-backed session validation**
  - Every protected route verifies the user still exists, is active, and not suspended.
  - Prevents reuse of cookies for deleted/disabled accounts.
- **Session fixation prevention**
  - Session IDs are regenerated on login.
- **Anti-enumeration**
  - Login errors are generic (e.g., "Invalid credentials") and do not reveal whether a user/email exists.
- **AJAX-aware auth**
  - Expired or invalid sessions return JSON `401/403` for AJAX calls, making it easier for the frontend to handle logout flows securely.

### 2. Session & Cookie Security

- **Hardened cookie settings** (for `express-session`):
  - `httpOnly: true` – Client-side JavaScript cannot read session cookies.
  - `sameSite: 'lax'` – Helps mitigate CSRF by limiting cross-site requests.
  - `secure: true` in production – Cookies are sent only over HTTPS.
  - `maxAge: 2 * 60 * 60 * 1000` – Sessions expire automatically after 2 hours of inactivity.
  - `rolling: true` – Active users have their sessions refreshed, idle ones time out.
  - `saveUninitialized: false` – Avoids storing empty sessions for anonymous visitors.
- **Proxy awareness**
  - `app.set('trust proxy', 1)` is configured for production behind a load balancer or reverse proxy.

### 3. Injection & Input Hardening

- **NoSQL injection protection**
  - `express-mongo-sanitize` removes malicious MongoDB operators from request payloads.
  - `mongoose.set('sanitizeFilter', true)` hardens query filters.
- **Regular expression safety**
  - User-controlled strings are escaped before being used to construct `RegExp` objects.
  - Input length is capped to reduce the risk of ReDoS.
- **Helmet**
  - `helmet` is used to set common security headers, including HSTS, X-Content-Type-Options, and X-Frame-Options.

### 4. XSS & CSRF Protection

- **XSS mitigation**
  - Handlebars templates default to escaped output (`{{value}}`) instead of raw HTML (`{{{value}}}`).
  - Inline script usage is minimized and can be governed via Content Security Policy (CSP) headers.
- **CSRF protection**
  - `csurf` middleware is enabled on state-changing routes (POST/PUT/DELETE).
  - Tokens are embedded in forms and passed via headers (`X-CSRF-Token`) for AJAX calls.

### 5. Request-Level Defenses

- **Request size limits**
  - JSON and URL-encoded payloads are limited in size to mitigate DoS via large bodies.
- **Rate limiting**
  - Login and other sensitive endpoints are protected with `express-rate-limit` (e.g., 30 requests per 15 minutes per IP).
- **Header hygiene**
  - `X-Powered-By` header is removed to reduce framework fingerprinting.

---

## ⚠️ Known npm Audit Warnings (Acceptable Risk)

### 1. `csurf` (Low Severity)

- **Status:** ✅ Acceptable
- **Context:** `csurf@1.11.0` depends on an archived `cookie` module that has low-severity parsing issues.
- **Why It’s Acceptable:**
  - The app uses session-backed CSRF tokens and does not rely on the cookie-based token mode.
  - The vulnerable path is not used in the current configuration.
  - Replacing `csurf` would require a non-trivial rework of the CSRF token flow.

### 2. `nodemon` / `semver` (High Severity, Dev-only)

- **Status:** ✅ Acceptable (development only)
- **Context:** `nodemon@2.0.22` pulls in a vulnerable `semver` dependency that can be abused in specific parsing scenarios.
- **Why It’s Acceptable:**
  - `nodemon` is a **devDependency** used only in local development (`npm run dev:*`).
  - Production startup scripts (`npm start`, `npm run start:all`) use `node app.js` directly.
  - Attackers cannot influence dev-only version parsing in a hosted production environment.

---

## 📋 Resolved Vulnerabilities (Examples)

| Package     | Severity | Fixed Version | Issue Summary                             |
|------------|----------|---------------|-------------------------------------------|
| nodemailer | Moderate | 7.0.12        | DoS via recursive address parsing         |
| nodemailer | Moderate | 7.0.12        | Emails possibly sent to unintended domain |

All production dependencies are kept up-to-date as part of regular maintenance.

---

## 🔒 Additional Recommendations

### Short-Term (Easy Wins)

1. **Input validation**
   - Use `Joi` or a similar library to validate:
     - Tenant registration and profile updates
     - Property creation/updates
     - Admin actions (e.g., approvals, cancellations)
2. **Template audit**
   - Review all `.hbs` files for `{{{triple-stash}}}` usages.
   - Replace with escaped `{{value}}` where HTML is not explicitly required.
3. **Dependency monitoring**
   - Enable Dependabot / GitHub security alerts for ongoing monitoring.

### Long-Term

1. **CSRF library refresh**
   - Migrate from `csurf` to a more actively maintained alternative when convenient.
2. **Upgrade dev tooling**
   - Move to `nodemon@3.x` when your Node.js baseline is updated.
3. **CSP tightening**
   - Move inline styles/scripts into static assets to allow a stricter Content Security Policy.
4. **Audit logging**
   - Expand structured audit logs for sensitive operations (user deletion, role changes, payment alterations).
5. **Password policy**
   - Enforce stronger password rules and add basic breach checks (e.g., zxcvbn-based strength hints).

---

## 🛡️ Current Risk Posture

| Attack Vector           | Status       | Notes                                                      |
|-------------------------|--------------|-----------------------------------------------------------|
| Session hijacking       | ✅ Mitigated | Regenerated on login; secure, httpOnly cookies            |
| CSRF attacks            | ✅ Mitigated | `csurf` tokens + sameSite cookies                         |
| NoSQL injection         | ✅ Mitigated | `express-mongo-sanitize` + Mongoose sanitizeFilter        |
| XSS (basic)             | ✅ Hardened  | Escaped templates, Helmet, reduced inline scripts         |
| ReDoS (regex injection) | ✅ Mitigated | Escaped user input, length caps                           |
| User enumeration        | ✅ Mitigated | Generic auth errors, no email/existence leaks             |
| Brute-force login       | ✅ Hardened  | Rate limiting on login endpoints                          |
| Deactivated user access | ✅ Blocked   | Active status verified on each protected route            |

**Overall Risk Level:** 🟢 **Low** for the intended use case and threat model.
