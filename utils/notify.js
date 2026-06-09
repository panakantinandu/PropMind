const nodemailer = require('nodemailer');
const logger = require('./logger');

// Optional HTTPS fallback (avoids SMTP port blocks on some hosts like Render)
const sgMail = process.env.SENDGRID_API_KEY ? require('@sendgrid/mail') : null;
if (sgMail) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  logger.info('SendGrid fallback enabled (HTTPS port 443)');
}

// expects environment variables for SMTP configuration
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  pool: true, // Use pooled connections for better performance
  maxConnections: 5,
  maxMessages: 100,
  rateDelta: 1000,
  rateLimit: 5,
  connectionTimeout: 10000, // 10 seconds
  greetingTimeout: 5000,
  socketTimeout: 15000 // 15 seconds
});

// Verify SMTP connection on startup (optional, helps catch config errors early)
transporter.verify(function(error, success) {
  if (error) {
    logger.error('SMTP configuration error:', error);
  } else {
    logger.info('SMTP server is ready to send emails');
  }
});

function shouldFallbackToSendGrid(err) {
  if (!sgMail) return false;
  if (!err) return false;
  return (
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNECTION' ||
    err.code === 'ECONNRESET' ||
    err.command === 'CONN' ||
    /timeout/i.test(err.message || '')
  );
}

async function sendMail({ to, subject, text, html }) {
  console.log('[NOTIFY] sendMail called for:', to);
  
  if (!to) {
    logger.warn('notify.sendMail called without `to` address');
    return;
  }
  
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    const error = new Error('SMTP credentials not configured. Check SMTP_USER and SMTP_PASS environment variables.');
    logger.error(error.message);
    throw error;
  }
  
  const mail = {
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  };
  
  try {
    console.log('[NOTIFY] Attempting to send email via', process.env.SMTP_HOST);
    const timerLabel = `[NOTIFY] Email Send Duration ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    console.time(timerLabel);
    
    // Add timeout wrapper
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Email send timeout after 20 seconds')), 20000)
    );
    
    const info = await Promise.race([
      transporter.sendMail(mail),
      timeoutPromise
    ]);
    
    console.timeEnd(timerLabel);
    logger.info(`Email sent to ${to}: ${info && info.messageId}`);
    console.log('[NOTIFY] ✅ Email sent successfully, Message ID:', info.messageId);
    return info;
  } catch (err) {
    console.timeEnd(timerLabel);
    logger.error('Error sending email', err);
    console.error('[NOTIFY] ❌ Email error:', err.message);

    if (shouldFallbackToSendGrid(err)) {
      try {
        console.log('[NOTIFY] Switching to SendGrid fallback over HTTPS (port 443)...');
        const sgMsg = {
          to,
          from: process.env.EMAIL_FROM || process.env.SMTP_USER,
          subject,
          text,
          html
        };

        const start = Date.now();
        const [sgRes] = await sgMail.send(sgMsg);
        const duration = ((Date.now() - start) / 1000).toFixed(3);
        const sgId = sgRes?.headers?.['x-message-id'] || sgRes?.headers?.['x-message-id'] || sgRes?.headers?.['X-Message-Id'];
        logger.info(`SendGrid email sent to ${to}: ${sgId || 'sendgrid'}`);
        console.log(`[NOTIFY] ✅ SendGrid email sent in ${duration}s, Status: ${sgRes?.statusCode}`);
        return { messageId: sgId || 'sendgrid', provider: 'sendgrid', statusCode: sgRes?.statusCode };
      } catch (sgErr) {
        logger.error('SendGrid fallback failed', sgErr);
        console.error('[NOTIFY] ❌ SendGrid fallback error:', sgErr.message);
        throw sgErr;
      }
    }

    throw err;
  }
}

async function notifyLandlordFlag({ landlordEmail, tenant, reason }) {
  const subject = `Tenant flagged: ${tenant.firstname} ${tenant.lastname}`;
  const html = `<p>Tenant <strong>${tenant.firstname} ${tenant.lastname}</strong> (email: ${tenant.email}) has been flagged.</p>
    <p>Reason: ${reason}</p>
    <p>Risk score: ${tenant.riskScore}</p>
    <p><a href="${process.env.APP_BASE_URL || ''}/admin/home/tenantlist">View in dashboard</a></p>`;
  return sendMail({ to: landlordEmail, subject, html, text: `${tenant.firstname} ${tenant.lastname} flagged: ${reason}` });
}

// Payment Escalation Notifications

async function sendPaymentReminder({ tenant, invoice, property, daysLate }) {
  const subject = `Payment Reminder: Rent Due for ${invoice.month}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff9800;">Payment Reminder</h2>
      <p>Dear ${tenant.firstname} ${tenant.lastname},</p>
      
      <p>This is a friendly reminder that your rent payment is now <strong>${daysLate} day(s) overdue</strong>.</p>
      
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Payment Details</h3>
        <p><strong>Property:</strong> ${property?.propertyname || 'N/A'}</p>
        <p><strong>Invoice Month:</strong> ${invoice.month}</p>
        <p><strong>Amount Due:</strong> $${invoice.totalAmount}</p>
        <p><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}</p>
      </div>
      
      <p>Please submit your payment as soon as possible to avoid late fees.</p>
      
      <p><a href="${process.env.APP_BASE_URL || 'http://localhost:3000'}/tenant/payments" 
         style="background: #4a90e2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
         Pay Now
      </a></p>
      
      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        If you have already made this payment, please disregard this notice.
      </p>
    </div>
  `;
  
  return sendMail({ 
    to: tenant.email, 
    subject, 
    html, 
    text: `Payment reminder: Your rent payment of $${invoice.totalAmount} is ${daysLate} day(s) overdue. Please pay immediately.` 
  });
}

// Upcoming / due-today rent reminders

async function sendFriendlyRentReminder({ tenant, invoice, property }) {
  const subject = `Upcoming Rent Due for ${property?.propertyname || 'your property'}`;
  const dueDateStr = new Date(invoice.dueDate).toLocaleDateString('en-IN');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4a90e2;">Friendly Rent Reminder</h2>
      <p>Dear ${tenant.firstname} ${tenant.lastname},</p>
      <p>This is a friendly reminder that your monthly rent will be due soon.</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Rent Details</h3>
        <p><strong>Property:</strong> ${property?.propertyname || 'N/A'}</p>
        <p><strong>Rent Amount:</strong> $${invoice.rentAmount}</p>
        <p><strong>Due Date:</strong> ${dueDateStr}</p>
      </div>
      <p>You can pay online at any time using the link below.</p>
      <p>
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/tenant/invoices" 
           style="background: #4a90e2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
           Pay Now
        </a>
      </p>
    </div>
  `;

  return sendMail({
    to: tenant.email,
    subject,
    html,
    text: `Friendly reminder: your rent of $${invoice.rentAmount} is due on ${dueDateStr}.`
  });
}

async function sendDueTodayRentReminder({ tenant, invoice, property }) {
  const subject = `Rent Payment Due Today for ${property?.propertyname || 'your property'}`;
  const dueDateStr = new Date(invoice.dueDate).toLocaleDateString('en-IN');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff9800;">Rent Due Today</h2>
      <p>Dear ${tenant.firstname} ${tenant.lastname},</p>
      <p>This is a reminder that your rent payment is <strong>due today</strong>.</p>
      <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Property:</strong> ${property?.propertyname || 'N/A'}</p>
        <p><strong>Amount:</strong> $${invoice.rentAmount}</p>
        <p><strong>Due Date:</strong> ${dueDateStr}</p>
      </div>
      <p>Please make your payment today to avoid late fees.</p>
      <p>
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/tenant/invoices" 
           style="background: #ff9800; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
           Pay Now
        </a>
      </p>
    </div>
  `;

  return sendMail({
    to: tenant.email,
    subject,
    html,
    text: `Your rent of $${invoice.rentAmount} is due today (${dueDateStr}). Please pay to avoid late fees.`
  });
}

async function sendOverdueRentReminder({ tenant, invoice, property, daysLate }) {
  // 1-day overdue gentle nudge before stronger escalation kicks in
  return sendPaymentReminder({ tenant, invoice, property, daysLate });
}

async function sendDefaultNotice({ tenant, invoice, property, daysLate }) {
  const subject = `⚠️ Default Notice: Rent Payment ${daysLate} Days Overdue`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #f44336;">Default Notice</h2>
      <p>Dear ${tenant.firstname} ${tenant.lastname},</p>
      
      <p><strong>This is a formal notice that your rent payment is now ${daysLate} days overdue.</strong></p>
      
      <div style="background: #ffebee; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f44336;">
        <h3 style="margin-top: 0; color: #f44336;">Overdue Payment</h3>
        <p><strong>Property:</strong> ${property?.propertyname || 'N/A'}</p>
        <p><strong>Invoice Month:</strong> ${invoice.month}</p>
        <p><strong>Original Amount:</strong> $${invoice.rentAmount}</p>
        <p><strong>Late Fees:</strong> $${invoice.lateFeeAmount}</p>
        <p><strong>Total Amount Due:</strong> $${invoice.totalAmount}</p>
        <p><strong>Original Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}</p>
      </div>
      
      <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h4 style="margin-top: 0;">⚠️ Important Notice</h4>
        <p>Continued non-payment may result in:</p>
        <ul>
          <li>Additional late fees</li>
          <li>Legal action</li>
          <li>Termination of lease agreement</li>
          <li>Damage to credit rating</li>
        </ul>
      </div>
      
      <p><strong>Please make payment immediately to avoid further action.</strong></p>
      
      <p><a href="${process.env.APP_BASE_URL || 'http://localhost:3000'}/tenant/payments" 
         style="background: #f44336; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
         Pay Now
      </a></p>
      
      <p style="margin-top: 30px;">If you are experiencing financial difficulties, please contact us immediately to discuss payment arrangements.</p>
    </div>
  `;
  
  return sendMail({ 
    to: tenant.email, 
    subject, 
    html, 
    text: `DEFAULT NOTICE: Your rent payment is ${daysLate} days overdue. Total due: $${invoice.totalAmount}. Pay immediately to avoid legal action.` 
  });
}

async function sendLegalWarning({ tenant, invoice, property, daysLate }) {
  const subject = `🚨 LEGAL WARNING: Rent Payment ${daysLate} Days Overdue - Immediate Action Required`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #d32f2f; border-bottom: 3px solid #d32f2f; padding-bottom: 10px;">
        LEGAL WARNING - IMMEDIATE ACTION REQUIRED
      </h2>
      
      <p><strong>Dear ${tenant.firstname} ${tenant.lastname},</strong></p>
      
      <div style="background: #ffcdd2; padding: 20px; border-radius: 5px; margin: 20px 0; border: 2px solid #d32f2f;">
        <h3 style="margin-top: 0; color: #d32f2f;">🚨 FINAL NOTICE</h3>
        <p style="font-size: 16px;">
          Your rent payment is now <strong>${daysLate} days overdue</strong>. 
          This is your final notice before legal proceedings commence.
        </p>
      </div>
      
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Outstanding Payment Details</h3>
        <p><strong>Property:</strong> ${property?.propertyname || 'N/A'}</p>
        <p><strong>Invoice Month:</strong> ${invoice.month}</p>
        <p><strong>Original Rent:</strong> $${invoice.rentAmount}</p>
        <p><strong>Accumulated Late Fees:</strong> $${invoice.lateFeeAmount}</p>
        <p style="font-size: 18px; color: #d32f2f;"><strong>TOTAL AMOUNT DUE: $${invoice.totalAmount}</strong></p>
        <p><strong>Original Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}</p>
        <p><strong>Days Overdue:</strong> ${daysLate} days</p>
      </div>
      
      <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ff6f00;">
        <h4 style="margin-top: 0; color: #ff6f00;">⚖️ Legal Consequences</h4>
        <p><strong>If payment is not received within 48 hours, we will proceed with:</strong></p>
        <ul style="line-height: 1.8;">
          <li><strong>Eviction proceedings</strong></li>
          <li><strong>Legal action for recovery of dues</strong></li>
          <li><strong>Reporting to credit agencies</strong></li>
          <li><strong>Additional legal fees and court costs</strong></li>
          <li><strong>Blacklisting from future rentals</strong></li>
        </ul>
      </div>
      
      <p style="font-size: 16px; font-weight: bold; color: #d32f2f;">
        PAYMENT MUST BE MADE WITHIN 48 HOURS TO AVOID LEGAL ACTION
      </p>
      
      <p><a href="${process.env.APP_BASE_URL || 'http://localhost:3000'}/tenant/payments" 
         style="background: #d32f2f; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
         PAY NOW - URGENT
      </a></p>
      
      <div style="margin-top: 30px; padding: 15px; background: #e3f2fd; border-radius: 5px;">
        <p style="margin: 0;"><strong>Need Help?</strong></p>
        <p style="margin: 5px 0 0 0;">
          If you are experiencing genuine financial hardship, contact us immediately at 
          <strong>${process.env.SUPPORT_EMAIL || process.env.SMTP_USER}</strong> to discuss payment arrangements before legal action begins.
        </p>
      </div>
      
      <p style="color: #666; font-size: 11px; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
        This is a formal legal notice. Failure to respond or make payment may result in legal proceedings without further notice.
      </p>
    </div>
  `;
  
  return sendMail({ 
    to: tenant.email, 
    subject, 
    html, 
    text: `LEGAL WARNING: Your rent payment is ${daysLate} days overdue. Total due: $${invoice.totalAmount}. Legal proceedings will commence within 48 hours if payment is not received. This is your final notice.` 
  });
}

async function sendApplicationCancelledByAdmin({ tenant, application, property, reason }) {
  const subject = `Your application for ${property?.propertyname || 'the property'} has been cancelled`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #f44336;">Application Cancelled</h2>
      <p>Dear ${tenant.firstname} ${tenant.lastname},</p>
      <p>Your application for <strong>${property?.propertyname || 'the property'}</strong> has been <strong>cancelled by the admin</strong>.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>If you have any questions or believe this was a mistake, please contact the management office.</p>
      <p style="color: #777; font-size: 12px; margin-top: 30px;">This is an automated message from LeaseHub.</p>
    </div>
  `;

  return sendMail({
    to: tenant.email,
    subject,
    html,
    text: `Your application for ${property?.propertyname || 'the property'} has been cancelled by the admin.${reason ? ' Reason: ' + reason : ''}`
  });
}

module.exports = { 
  sendMail, 
  notifyLandlordFlag,
  sendPaymentReminder,
  sendDefaultNotice,
  sendLegalWarning,
  sendFriendlyRentReminder,
  sendDueTodayRentReminder,
  sendOverdueRentReminder,
  sendApplicationCancelledByAdmin,
  // Booking deposit expiry notification
  async sendBookingDepositExpired({ tenant, property, application }) {
    const subject = `Booking Deposit Window Expired for ${property?.propertyname || 'your application'}`;
    const expires = application?.expiresAt
      ? new Date(application.expiresAt).toLocaleString('en-IN')
      : 'the expiry time';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f44336;">Booking Deposit Window Expired</h2>
        <p>Dear ${tenant.firstname} ${tenant.lastname},</p>
        <p>Your booking deposit window for <strong>${property?.propertyname || 'the selected property'}</strong> has expired.</p>
        <p>
          The booking deposit was not received within the required 48-hour period
          (deadline: <strong>${expires}</strong>), so the property has been released and is now available to other tenants.
        </p>
        <p>
          If you are still interested, please browse available properties and submit a new application.
        </p>
        <p>
          <a href="${process.env.APP_BASE_URL || 'http://localhost:3001'}/tenant/properties" 
             style="background: #4a90e2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
             View Available Properties
          </a>
        </p>
        <p style="color: #777; font-size: 12px; margin-top: 30px;">
          This is an automated message from LeaseHub. No booking deposit has been charged.
        </p>
      </div>
    `;

    return sendMail({
      to: tenant.email,
      subject,
      html,
      text: `Your booking deposit window for ${property?.propertyname || 'your application'} has expired. The property has been released back to the market.`
    });
  }
};
