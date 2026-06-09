<div align="center">

# 🏠 PropMind
### AI-Powered Property Management Platform

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green?style=flat-square&logo=mongodb)](https://mongodb.com)
[![Stripe](https://img.shields.io/badge/Stripe-Payments-blueviolet?style=flat-square&logo=stripe)](https://stripe.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-Powered-412991?style=flat-square&logo=openai)](https://openai.com)
[![License](https://img.shields.io/badge/License-Source--Available-orange?style=flat-square)](./LICENSE)

**PropMind** automates the complete landlord–tenant lifecycle — from property discovery and lease applications to AI-assisted risk analysis, smart maintenance triage, secure Stripe payments, automated invoicing, and real-time notifications.

[Admin Portal](https://propmind-6mkn.onrender.com) · [Tenant Portal](https://propmind-tenant.onrender.com)

</div>

---

## 🧠 What Makes This Different

Most property management tools are just CRUD apps. PropMind is built around **real financial workflows, time-enforced rules, and AI-driven intelligence**:

| Feature | What it does |
|---|---|
| 🤖 AI Risk Scoring | Evaluates tenant applications using income, rent-to-income ratio, and payment history |
| 🔧 Smart Maintenance Triage | AI classifies ticket category (plumbing/electrical/HVAC…) and sets priority automatically |
| 💬 AI Support Assistant | Both admin and tenants can ask natural-language questions; AI queries live DB data |
| 📊 AI Financial Summary | Admin gets an AI-generated narrative of revenue, dues, and overdue tenants |
| ⏱️ Automated Enforcement | Cron jobs cancel unpaid deposits, expire stale applications, apply late fees |
| 🧾 Ledger-based Billing | Invoices ≠ Payments — every transaction creates a traceable ledger entry |

---

## 🗺️ System Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        PropMind Monorepo                      │
└──────────────┬────────────────────────────┬───────────────────┘
               │                            │
       ┌───────▼────────┐          ┌────────▼───────┐
       │   Admin App    │          │  Tenant App    │
       │  Port :3001    │          │  Port :3000    │
       │  Express + HBS │          │  Express + HBS │
       └───────┬────────┘          └────────┬───────┘
               │                            │
               └────────────┬───────────────┘
                            │
              ┌─────────────▼─────────────┐
              │       Shared Layer        │
              │  Models · Middleware      │
              │  Config · Utils           │
              └─────────────┬─────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼──────┐   ┌────────▼───────┐  ┌───────▼──────┐
│ MongoDB Atlas│   │  Redis + BullMQ│  │  OpenAI API  │
│  (database)  │   │  (job queues)  │  │  (AI layer)  │
└──────────────┘   └────────────────┘  └──────────────┘
        │
┌───────▼──────┐   ┌────────────────┐
│    Stripe    │   │  Resend.com    │
│  (payments)  │   │  (email / OTP) │
└──────────────┘   └────────────────┘
```

---

## 🤖 AI Feature Map

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Services                          │
│                    services/ai/                             │
└────────────┬──────────────────┬──────────────────┬──────────┘
             │                  │                  │
    ┌────────▼────────┐  ┌──────▼──────┐  ┌───────▼────────┐
    │ Maintenance     │  │ Risk        │  │ Support        │
    │ Triage AI       │  │ Analysis AI │  │ Assistant AI   │
    │─────────────────│  │─────────────│  │────────────────│
    │ • Category      │  │ • Risk score│  │ • Natural lang │
    │   classification│  │ • Confidence│  │   queries on   │
    │ • Priority level│  │ • Rent-to-  │  │   live DB data │
    │ • Urgency score │  │   income    │  │ • Admin + tenant│
    │ • Est. response │  │   ratio     │  │   facing       │
    │ • Suggested fix │  │ • Red flags │  │                │
    └────────┬────────┘  └──────┬──────┘  └───────┬────────┘
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                   ┌────────────▼────────────┐
                   │  ai.service.js          │
                   │  Provider-agnostic core │
                   │  OpenAI / NVIDIA NIM    │
                   │  Redis-backed rate limit│
                   └─────────────────────────┘
```

---

## 🔄 Lease State Machine

```
  Tenant applies
       │
       ▼
  ┌─────────┐   Admin rejects   ┌──────────┐
  │ PENDING ├──────────────────►│ REJECTED │
  └────┬────┘                   └──────────┘
       │ Admin approves
       ▼
  ┌──────────┐  Payment timeout  ┌───────────┐
  │ APPROVED ├──────────────────►│ CANCELLED │
  └────┬─────┘                   └───────────┘
       │ Tenant pays booking deposit
       ▼
  ┌──────────┐
  │ RESERVED │  ◄── Property locked (available → reserved)
  └────┬─────┘
       │ Lease start date reached
       ▼
  ┌────────┐   Lease ends / cancelled
  │ ACTIVE ├────────────────────────────► TERMINATED
  └────────┘
       │
       │ Every month
       ▼
  Invoice generated ──► Tenant pays ──► Ledger entry created
                              │
                              └──► Overdue? ──► Late fee applied
```

---

## 💳 Payment & Billing Flow

```
Tenant clicks "Pay Invoice"
         │
         ▼
  POST /tenant/invoices/:id/pay
         │
         ▼
  Stripe Checkout Session
  created server-side
         │
         ▼
  ┌─────────────────────┐
  │  Stripe Hosted Page │  ◄── PCI compliant, no card data on server
  └─────────┬───────────┘
            │  Payment complete
     ┌──────┴──────────┐
     │                 │
     ▼                 ▼
Stripe Webhook    Redirect to
(POST /webhook)   /payments/success
     │
     ▼
Signature verified
(STRIPE_WEBHOOK_SECRET)
     │
     ▼
Invoice → PAID
LedgerEntry created
Notification dispatched
Property status updated (if deposit)
```

---

## ⚙️ Background Jobs & Automation

```
cronService.js  ──────────────────────────────────────────┐
                                                           │
  ┌─ 1st of every month ──────────────────────────────┐   │
  │  generateMonthlyRentInvoices.js                   │   │
  │  → Create Invoice for every ACTIVE lease          │   │
  └───────────────────────────────────────────────────┘   │
                                                           │
  ┌─ 3 days before due date ──────────────────────────┐   │
  │  sendRentReminders.js                             │   │
  │  → Email + in-app notification to tenant          │   │
  └───────────────────────────────────────────────────┘   │
                                                           │
  ┌─ After grace period ──────────────────────────────┐   │
  │  applyLateFees.js                                 │   │
  │  → Append late fee to overdue invoices            │   │
  └───────────────────────────────────────────────────┘   │
                                                           │
BullMQ Workers (Redis-backed, fallback to inline) ─────────┘

  jobs/billing/       → Auto-cancel deposits on timeout
  jobs/leases/        → Expire stale pending applications
  jobs/notifications/ → Dispatch queued notification events
```

---

## 🧱 Actual Project Structure

```
Property-MS-main/
│
├── apps/
│   ├── admin-app/                  # Admin portal (Port 3001)
│   │   ├── app.js                  # Express entry point
│   │   ├── src/modules/admin/
│   │   │   ├── admin.controller.js          # 40+ route handlers
│   │   │   ├── admin.routes.js              # All admin routes
│   │   │   ├── adminReports.controller.js   # Financial reports
│   │   │   └── stripeConnect.controller.js  # Stripe Connect onboarding
│   │   └── views/                  # Handlebars templates
│   │
│   └── tenant-app/                 # Tenant portal (Port 3000)
│       ├── app.js
│       ├── src/modules/tenant/
│       │   ├── tenant.controller.js         # 50+ route handlers
│       │   └── tenant.routes.js             # All tenant routes
│       └── views/
│
├── shared/                         # Used by both apps
│   ├── models/                     # All Mongoose schemas
│   │   ├── tenant.js  property.js  application.js  lease.js
│   │   ├── invoice.js  payment.js  ledgerEntry.js
│   │   ├── notification.js  auditLog.js  supportTicket.js
│   │   ├── aiInsight.js  ticket.js  cancellation.js
│   │   └── index.js                # Barrel export
│   ├── middleware/
│   │   └── auth.js                 # requireAdmin() / requireTenant()
│   └── config/
│       └── db.js                   # MongoDB connection
│
├── services/
│   ├── ai/
│   │   ├── ai.service.js           # Core: OpenAI/NVIDIA, rate limiting
│   │   ├── maintenanceAI.service.js # Ticket classification
│   │   └── riskAnalysis.service.js  # Tenant risk scoring
│   ├── notifications/
│   │   └── notificationService.js
│   ├── payments/
│   │   └── paymentService.js
│   ├── auditService.js             # Audit log writer
│   ├── cronService.js              # Node-cron scheduler
│   ├── queueService.js             # BullMQ + Redis fallback
│   └── supportService.js           # AI support query engine
│
├── utils/
│   ├── emailService.js             # Resend.com integration
│   ├── pdfGenerator.js             # pdf-lib / pdfkit
│   ├── ledgerService.js            # Double-entry bookkeeping
│   ├── jwt.js  validation.js  logger.js  notify.js
│
├── jobs/
│   ├── billing/
│   │   ├── billingJobs.js
│   │   ├── generateMonthlyRentInvoices.js
│   │   └── applyLateFees.js
│   ├── leases/
│   │   └── expireApplications.js
│   └── notifications/
│       ├── sendRentReminders.js
│       └── sendExpiryWarnings.js
│
├── migrations/                     # One-time DB migrations
├── scripts/                        # Admin utility scripts
├── docs/                           # CONTRIBUTING, SECURITY, TESTING guides
├── Procfile                        # Render deployment
└── package.json                    # Monorepo root (concurrently)
```

---

## 🗄️ Data Models at a Glance

```
Tenant ──────────────────────────────────────────────────────┐
 tenantid, email, phone, status                              │
 isVerified, propertyId (ref), applicationId (ref)           │
                                                             │
Property ───────────────────────────────────────────────────┐│
 propertyname, propertytype, rent, bookingDeposit            ││
 status: available → reserved → leased → occupied            ││
 amenities[], images[]                                       ││
                                                             ││
Application ◄──────────────────────────────────────────────┘│
 applicantEmail, monthlyIncome, occupation, leaseDuration    │
 status: pending → approved → deposit_pending                │
         → reserved → cancelled / expired / rejected         │
 aiRiskScore, aiConfidence  ◄── AI-generated fields          │
                                                             │
Lease ◄──────────────────────────────────────────────────── ┘
 tenantId, propertyId, adminId
 startDate, endDate, monthlyRent, securityDeposit
 status: active / terminated
        │
        ├──► Invoice  (amount, dueDate, status, lateFee)
        ├──► Payment  (stripeSessionId, amount, paidAt)
        └──► LedgerEntry (type, amount, reference)

SupportTicket ◄──── AI Support
AuditLog      ◄──── Every sensitive admin action
Notification  ◄──── In-app alerts for both roles
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Handlebars (HBS) · Bootstrap |
| **Backend** | Node.js 18+ · Express.js |
| **Database** | MongoDB Atlas · Mongoose |
| **Payments** | Stripe Checkout · Stripe Webhooks · Stripe Connect |
| **AI** | OpenAI API · NVIDIA NIM (switchable via `AI_PROVIDER` env var) |
| **Job Queues** | BullMQ · ioredis (graceful fallback to inline if Redis unavailable) |
| **Email / OTP** | Resend.com |
| **PDF** | pdf-lib · pdfkit |
| **Auth** | JWT · express-session · bcryptjs |
| **Real-time** | Socket.io |
| **Security** | Helmet · CSRF (`csrf-csrf`) · Rate limiting · Mongo sanitize |
| **Logging** | Winston (app.log · error.log · payments.log) |
| **Deployment** | Render (two independent services) |

---

## 🚀 Local Setup

### Prerequisites

- Node.js v18+
- MongoDB Atlas URI
- Stripe account (test mode keys)
- Resend.com API key
- Redis (optional — jobs run inline without it)
- OpenAI or NVIDIA NIM API key

### Install

```bash
git clone https://github.com/panakantinandu/Property-MS-main.git
cd Property-MS-main
npm run setup        # installs root + both app dependencies
cp .env.example .env
```

### Environment Variables

```env
# Database
MONGO_URI=mongodb+srv://...

# Auth
JWT_SECRET=
SESSION_SECRET=

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email
RESEND_API_KEY=re_...
EMAIL_FROM=PropMind <onboarding@resend.dev>

# AI (choose one)
AI_PROVIDER=openai          # or: nvidia
OPENAI_API_KEY=sk-...
NVIDIA_API_KEY=              # if using NVIDIA NIM
NVIDIA_BASE_URL=             # NVIDIA NIM endpoint

# Redis (optional)
REDIS_URL=redis://localhost:6379

# App URLs
TENANT_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001
NODE_ENV=development
```

### Run

```bash
npm run dev:all         # Both apps (hot reload)
npm run dev:admin       # Admin only  → http://localhost:3001
npm run dev:tenant      # Tenant only → http://localhost:3000
```

### Test

```bash
npm test                # All tests
npm run test:billing    # Billing/invoice logic
npm run test:ai         # AI service tests
```

---

## 👤 User Roles

**Admin**
- Add / edit / manage properties with images and amenities
- Review lease applications — approve, reject, or cancel
- Re-run AI risk analysis on any application (`/applications/:id/rerun-ai`)
- View and update maintenance ticket status
- Access financial reports: paid vs due, overdue tenants
- AI-generated financial summary dashboard
- Stripe Connect account management
- Full audit log visibility

**Tenant**
- Browse available properties and submit lease applications
- Receive AI-powered maintenance triage before submitting a ticket
- Pay booking deposit and monthly rent via Stripe
- View invoices, payment history, and ledger
- Raise and track support tickets (with AI assistant)
- OTP-based registration, password reset, and password change

---

## 🧪 Demo Credentials

| Role | Email | Password |
|---|---|---|
| Admin | nan | nan427 |
| Tenant | email@email.com | Email@098 |

> ⚠️ Payments run in **Stripe Test Mode**. Use card `4242 4242 4242 4242` with any future date and CVC.

---

## 🔒 Security Highlights

- All secrets in environment variables — nothing hardcoded
- Stripe handles card data end-to-end (PCI DSS compliant)
- Webhook signature verification prevents spoofed payment events
- CSRF protection on all state-changing forms
- Per-route rate limiting (5 req/10 min on auth endpoints)
- `express-mongo-sanitize` blocks NoSQL injection
- Helmet sets secure HTTP headers
- Audit log records every admin action with IP + user-agent

---

## 🗑️ Files Safe to Delete

The following files are **already in `.gitignore`** but may exist in your local clone:

| Path | Reason |
|---|---|
| `scratch/` (entire folder) | Throwaway dev scripts — already gitignored |
| `admin_dashboard.html` | Prototype mockup, not used by Express |
| `admin_login.html` | Same — real UI lives in `apps/admin-app/views/` |
| `login_form.html` / `login_form2.html` | Same |
| `notifications_page.html` | Same |
| `FULL_FILE_STRUCTURE.md` | Auto-generated dump, superseded by this README |
| `logs/*.log` | Runtime artifacts, gitignored |
| `node_modules/` (root + both apps) | Never commit |

---

## 📂 Additional Docs

| File | Contents |
|---|---|
| `docs/CONTRIBUTING.md` | How to contribute |
| `docs/SECURITY-NOTES.md` | Security architecture notes |
| `docs/TESTING-GUIDE.md` | How to run and write tests |
| `docs/SENDGRID_SETUP.md` | Legacy email setup reference |
| `LEASE_LIFECYCLE_IMPLEMENTATION.md` | Detailed lease lifecycle change log |

---

## 🧾 License & Commercial Use

Source-available for learning and portfolio demonstration.
Commercial use, resale, or client deployment requires written permission.

📧 panakantinandu@gmail.com · See `LICENSE` for full terms.

---

## 📫 Contact

📧 panakantinandu@gmail.com
🔗 [LinkedIn](https://linkedin.com/in/nandu-panakanti-41839731a)
🌐 [Portfolio](https://nandu-portfolio-three.vercel.app)
💻 [GitHub](https://github.com/panakantinandu)
