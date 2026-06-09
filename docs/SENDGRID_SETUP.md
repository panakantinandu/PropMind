# SendGrid Setup Guide - Fix Render Email Timeout

## Problem:
Render blocks Gmail SMTP (port 587), causing:
```
Error: Connection timeout
code: 'ETIMEDOUT'
```

## Solution: Use SendGrid (Free & Fast)

### Step 1: Create SendGrid Account
1. Go to: https://sendgrid.com/
2. Click "Start for Free"
3. Sign up (Free: 100 emails/day forever)
4. Verify your email address

### Step 2: Create API Key
1. Login to SendGrid dashboard
2. Go to: Settings → API Keys
3. Click "Create API Key"
4. Name it: "Render LeaseHub"
5. Select "Full Access"
6. Click "Create & View"
7. **COPY THE KEY** (you won't see it again!)
   - Looks like: `SG.xxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyy`

### Step 3: Verify Sender Email
1. Go to: Settings → Sender Authentication
2. Click "Verify a Single Sender"
3. Fill in your details:
   - From Name: LeaseHub
   - From Email: leasehub.noreply@gmail.com (or your domain email)
   - Reply To: (same as From Email)
4. Click "Create"
5. **Check your email and click the verification link**

### Step 4: Update Render Environment Variables

Go to Render Dashboard → Your Service → Environment:

**Replace these 3 variables:**
```
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=SG.your_sendgrid_api_key_here
```

**Keep these the same:**
```
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_FROM=leasehub.noreply@gmail.com
```

⚠️ **Important:**
- SMTP_USER must be exactly: `apikey` (don't change this!)
- SMTP_PASS is your SendGrid API key (starts with `SG.`)
- EMAIL_FROM must match the verified sender email

### Step 5: Redeploy
Render will auto-redeploy when you save environment variables.

Check logs for:
```
✅ SMTP server is ready to send emails
```

### Step 6: Test OTP
1. Go to your Render URL
2. Login → Profile → Edit Profile
3. Try sending OTP
4. Should arrive in 1-2 seconds!

---

## Alternative: Mailgun (if you prefer)

### Mailgun Setup:
1. Sign up: https://mailgun.com (Free: 5,000 emails/month)
2. Get your SMTP credentials from dashboard
3. Update Render Environment:
   ```
   SMTP_HOST=smtp.mailgun.org
   SMTP_PORT=587
   SMTP_USER=postmaster@your-domain.mailgun.org
   SMTP_PASS=your_mailgun_password
   ```

---

## Why This Happens:

**Gmail SMTP Issues from Cloud:**
- Many cloud providers block ports 25, 587, 465
- Gmail is slow/unreliable from cloud IPs
- Gmail rate-limits cloud traffic

**SendGrid/Mailgun Benefits:**
- Designed for cloud platforms
- Not blocked by Render
- 10x faster delivery (1-2 seconds vs 15+ seconds)
- Better deliverability
- Free tier is generous

---

## Performance Comparison:

| Provider | Local | Render | Free Tier |
|----------|-------|--------|-----------|
| Gmail SMTP | ✅ 2s | ❌ Timeout | Unlimited |
| SendGrid | ✅ 1s | ✅ 1-2s | 100/day |
| Mailgun | ✅ 1s | ✅ 1-2s | 5000/month |

---

## Troubleshooting:

### "Invalid API key" error:
- Make sure SMTP_USER is exactly: `apikey`
- Verify SMTP_PASS is the full SendGrid API key (starts with `SG.`)

### Emails not arriving:
- Check you verified the sender email in SendGrid
- Check EMAIL_FROM matches verified sender
- Look in spam folder

### Still getting timeout:
- Double-check all 3 SMTP variables are updated
- Make sure you clicked "Save" in Render dashboard
- Wait for auto-redeploy to complete

---

## Quick Test Command:

After updating Render environment, check health:
```bash
curl https://your-app.onrender.com/health
```

Should show:
```json
{
  "smtp": {
    "configured": true,
    "host": "smtp.sendgrid.net"
  }
}
```
