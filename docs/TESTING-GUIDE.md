# Testing Guide - LeaseHub Property Management System

This guide describes how to manually test core workflows in the LeaseHub **Tenant Portal** and **Admin Console**. It’s intended for demos, regression testing, and QA, and assumes you have the app running locally as described in the main README.

---

## 1. Test Environment Setup

### 1.1 Start the Applications

From the project root:

```bash
npm run setup    # first time only, installs root + apps
npm run dev:all  # runs tenant-app and admin-app together
```

Typical local URLs (confirm ports in each `app.js` if needed):
- Tenant Portal: `http://localhost:3000`
- Admin Console: `http://localhost:3001` or another configured admin port

### 1.2 Seed an Admin User

If you don’t yet have an admin user:

```bash
node create-admin.js
```

Follow the CLI prompts (or default values) to create your first admin account.

---

## 2. Admin Portal Testing

### 2.1 Admin Login

- **URL:** `http://localhost:3001/admin/login/form` (adjust port if different)
- Enter the credentials created by `create-admin.js`.
- Expected result:
  - Successful login redirects to the Admin Dashboard.
  - Invalid credentials show a generic error message (no user enumeration).

### 2.2 Dashboard Overview

- Verify that the dashboard shows:
  - Total tenants
  - Total properties
  - Pending applications
  - Key alerts (overdue rent, upcoming expiries, etc., if data exists)
- Click the navigation links to ensure they route correctly:
  - **Tenants**, **Properties**, **Applications**, **Payments**, **Reports**.

### 2.3 Applications Management

- **URL:** `/admin/applications`
- Actions to test:
  - View list of applications with status badges (Pending/Approved/Rejected/Expired).
  - Open a single application and review all details.
  - Approve an application:
    - Property status should update (e.g., to Occupied).
    - Tenant should be associated with the property.
  - Reject an application:
    - Provide a rejection reason.
    - Tenant sees the updated status and message in the tenant portal.

### 2.4 Property Management

- **URL:** `/admin/properties`
- Verify you can:
  - View all properties with filters/status badges.
  - Create a new property (fill out required fields; invalid data should be rejected).
  - Edit an existing property.
  - Confirm status transitions (Available → Reserved → Occupied) based on workflows.

### 2.5 Tenant Management

- **URL:** `/admin/tenants`
- Verify you can:
  - View tenant list and basic details.
  - Search or filter tenants (if supported).
  - Open tenant detail pages and see assigned property/lease info.

### 2.6 Financial & Reports

- **Payments URL:** `/admin/payments`
- **Reports URL:** `/admin/reports`

Check that:
- Payment records display invoices, amounts, status (Paid/Unpaid/Overdue).
- Reports screen shows:
  - Property overview (available, reserved, occupied counts).
  - Tenant overview (active tenants, tenants with overdue rent).
  - Financial summary (total rent collected, outstanding rent, deposits, late fees).

---

## 3. Tenant Portal Testing

### 3.1 Tenant Registration

- **URL:** `http://localhost:3000/tenant/register/form`
- Steps:
  1. Fill out the registration form with realistic data.
  2. Ensure client-side validation runs (e.g., required fields, email format).
  3. Submit the form.
- Expected result:
  - Successful registration redirects to the login page with a success message.
  - Attempting to register with an existing email or tenant ID should show a clear error.

### 3.2 Tenant Login

- **URL:** `http://localhost:3000/tenant/login/form`
- Use the newly created credentials.
- Expected result:
  - Valid credentials → Tenant Dashboard.
  - Invalid credentials → Generic "Invalid credentials" message.

### 3.3 Tenant Dashboard

- Verify:
  - Basic tenant profile data is visible.
  - If the tenant has an approved application, their property/lease info shows.
  - Navigation links for **Properties**, **Applications**, **Invoices/Payments**, **Maintenance**, **Profile**, **Notifications** work correctly.

### 3.4 Browse Properties

- **URL:** `/tenant/properties`
- Actions:
  - View list of current available properties.
  - Filter (if supported) by city/type/rent.
  - Open a property details page.
  - Click **Apply** or **Apply Now** to start an application.

### 3.5 Apply for a Property

- **URL pattern:** `/tenant/properties/apply/:propertyId`
- Steps:
  1. Confirm pre-filled personal information is accurate.
  2. Fill out any required fields (move-in date, lease duration, etc.).
  3. Submit the application.
- Expected result:
  - Redirected to **My Applications** with the new application in Pending state.

### 3.6 My Applications

- **URL:** `/tenant/applications`
- Verify:
  - Applications list shows correct statuses and timestamps.
  - Status updates after admin approves/rejects.
  - Rejection reasons are visible (if provided by admin).

### 3.7 Profile Management

- **URL:** `/tenant/profile`
- Tests:
  - View profile info (personal + professional details).
  - Update certain fields and save.
  - Optionally change password and log in again with the new password.

---

## 4. Payments & Invoicing Flows

> Note: These scenarios assume Stripe test keys and webhook configuration are set up.

### 4.1 Booking Deposit Payment

- Precondition: Admin has configured a property/lease that requires a booking deposit.
- Tenant Flow:
  1. Tenant applies and gets approved.
  2. Tenant navigates to **Payments/Invoices**.
  3. Tenant selects the booking deposit invoice and proceeds to pay via Stripe.
- Expected result:
  - Stripe test checkout succeeds.
  - Invoice status becomes **Paid** in both tenant and admin views.

### 4.2 Monthly Rent Invoices

- Precondition: Rent invoices are generated via background jobs (e.g., a `generateMonthlyRentInvoices` script or scheduled job).
- Admin/Tenant Checks:
  - Admin can see generated rent invoices under `/admin/payments`.
  - Tenant sees new invoices in the **Invoices/Payments** section.
  - When a payment is completed through Stripe:
    - Admin view updates to **Paid**.
    - Tenant’s payment history includes the transaction.

### 4.3 Late Fees

- Precondition: At least one invoice is past its due date.
- If you have a job such as `applyLateFees.js`:
  - Run the job manually or via scheduler.
  - Verify that overdue invoices gain an associated late fee.
- Expected result:
  - Admin reports reflect increased late fee revenue.
  - Tenant sees updated balances including late fees.

---

## 5. Notifications & Maintenance

### 5.1 Email & In-App Notifications

- Triggers to test (if configured):
  - New invoice created.
  - Payment received.
  - Application approved/rejected.
- Verify:
  - Emails are sent (check SMTP logs or test inbox).
  - In-app notifications appear in tenant/admin notification views.

### 5.2 Maintenance Requests

- Tenant:
  - Go to the **Maintenance/Tickets** section.
  - Create a new request with title, description, and priority.
- Admin:
  - Review new tickets, update status (e.g., In Progress, Resolved).
- Verify:
  - Tenant can track ticket status changes.
  - Admin has a clear view of open vs resolved tickets.

---

## 6. Basic Security & Error Handling Checks

These are quick manual checks to validate behavior of security-related features:

1. **Unauthorized access**
   - Try accessing an admin URL in a fresh browser/incognito window (no session).
   - Expected: Redirect to login or 401/403.
2. **Tenant vs Admin isolation**
   - Log in as a tenant and attempt to hit an admin route.
   - Expected: Access denied or redirect.
3. **Session expiry**
   - Log in, wait longer than the configured session `maxAge`, then interact again.
   - Expected: Forced re-login.
4. **Form validation**
   - Submit clearly invalid data (empty required fields, malformed email, etc.).
   - Expected: Client-side and/or server-side validation errors; no server crash.

---

## 7. Suggested Demo Flow

For portfolio demos or recruiter walkthroughs, a clean end-to-end flow is:

1. Start apps with `npm run dev:all`.
2. Create admin via `node create-admin.js` (if needed).
3. Log in as admin, add a property.
4. Register as a new tenant and log in.
5. Browse properties and submit an application.
6. As admin, approve the application.
7. Trigger or show rent/booking deposit invoices.
8. Complete a Stripe test payment.
9. Show updated admin reports and tenant payment history.
10. Optionally, demonstrate a maintenance ticket and notification.

This sequence demonstrates LeaseHub as a realistic, production-style rental management platform rather than a simple CRUD app.
