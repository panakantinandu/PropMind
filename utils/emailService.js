const { Resend } = require('resend');
const logger = require('./logger');

// Initialize Resend only if API key is available
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
  logger.info('[RESEND] Resend email service initialized (HTTPS port 443)');
} else {
  logger.warn('[RESEND] RESEND_API_KEY not found - Resend service disabled');
}

/**
 * Send Password Reset OTP Email via Resend
 * @param {string} toEmail - Recipient email
 * @param {string} otp - 6-digit OTP code
 * @param {string} recipientName - Name of recipient
 * @returns {Promise<Object>} Email response
 */
async function sendResetOtpEmail(toEmail, otp, recipientName = 'User') {
  if (!resend) {
    logger.warn(`[MOCK EMAIL] Would have sent Password Reset OTP to ${toEmail}. OTP: ${otp}`);
    console.log(`\n==============================================`);
    console.log(`[MOCK EMAIL] PASSWORD RESET OTP FOR ${toEmail}: ${otp}`);
    console.log(`==============================================\n`);
    return { id: 'mock-id-' + Date.now() };
  }

  try {
    console.log(`[RESEND] Sending password reset OTP to ${toEmail}`);
    const startTime = Date.now();

    const result = await resend.emails.send({
      from: 'LeaseHub <onboarding@resend.dev>', // Use verified domain when ready
      to: toEmail,
      subject: 'Password Reset OTP - LeaseHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; text-align: center;">🔐 Password Reset OTP</h1>
          </div>
          
          <div style="background: #f5f5f5; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hi <strong>${recipientName}</strong>,</p>
            
            <p>You requested to reset your password for your LeaseHub Tenant Portal account.</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 25px 0;">
              <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">Your OTP is:</p>
              <h2 style="color: #667eea; font-size: 36px; letter-spacing: 8px; margin: 10px 0;">${otp}</h2>
              <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">Valid for 10 minutes</p>
            </div>
            
            <p style="color: #666;">Enter this OTP on the password reset page to create a new password.</p>
            
            <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; color: #856404;"><strong>⚠️ Security Notice:</strong> If you did not request a password reset, please ignore this email and ensure your account is secure.</p>
            </div>
            
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              This is an automated email from LeaseHub Tenant Portal. Please do not reply to this email.
            </p>
          </div>
        </div>
      `,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(3);
    logger.info(`[RESEND] ✅ Password reset OTP sent to ${toEmail} in ${duration}s, ID: ${result.id}`);
    console.log(`[RESEND] ✅ Email sent successfully in ${duration}s, Message ID: ${result.id}`);
    
    return result;
  } catch (error) {
    logger.error('[RESEND] ❌ Failed to send password reset OTP:', error);
    console.error('[RESEND] ❌ Email error:', error.message);
    throw error;
  }
}

/**
 * Send Password Change OTP Email via Resend
 * @param {string} toEmail - Recipient email
 * @param {string} otp - 6-digit OTP code
 * @param {string} recipientName - Name of recipient
 * @returns {Promise<Object>} Email response
 */
async function sendPasswordChangeOtpEmail(toEmail, otp, recipientName = 'User') {
  if (!resend) {
    logger.warn(`[MOCK EMAIL] Would have sent Password Change OTP to ${toEmail}. OTP: ${otp}`);
    console.log(`\n==============================================`);
    console.log(`[MOCK EMAIL] PASSWORD CHANGE OTP FOR ${toEmail}: ${otp}`);
    console.log(`==============================================\n`);
    return { id: 'mock-id-' + Date.now() };
  }

  try {
    console.log(`[RESEND] Sending password change OTP to ${toEmail}`);
    const startTime = Date.now();

    const result = await resend.emails.send({
      from: 'LeaseHub <onboarding@resend.dev>',
      to: toEmail,
      subject: 'Password Change OTP - LeaseHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #4a90e2 0%, #3a7bc8 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; text-align: center;">🔐 Password Change Verification</h1>
          </div>
          
          <div style="background: #f5f5f5; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hi <strong>${recipientName}</strong>,</p>
            
            <p>You requested to change your password for your LeaseHub account.</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 25px 0;">
              <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">Your verification OTP is:</p>
              <h2 style="color: #4a90e2; font-size: 36px; letter-spacing: 8px; margin: 10px 0;">${otp}</h2>
              <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">Valid for 10 minutes</p>
            </div>
            
            <p style="color: #666;">Enter this OTP on the password change page to proceed with updating your password.</p>
            
            <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; color: #856404;"><strong>⚠️ Security Notice:</strong> If you did not request this password change, please contact support immediately.</p>
            </div>
            
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              This is an automated email from LeaseHub. Please do not reply to this email.
            </p>
          </div>
        </div>
      `,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(3);
    logger.info(`[RESEND] ✅ Password change OTP sent to ${toEmail} in ${duration}s, ID: ${result.id}`);
    console.log(`[RESEND] ✅ Email sent successfully in ${duration}s, Message ID: ${result.id}`);
    
    return result;
  } catch (error) {
    logger.error('[RESEND] ❌ Failed to send password change OTP:', error);
    console.error('[RESEND] ❌ Email error:', error.message);
    throw error;
  }
}

/**
 * Check if Resend service is available
 * @returns {boolean}
 */
function isResendAvailable() {
  return resend !== null;
}

/**
 * Send Signup OTP Email via Resend
 * @param {string} toEmail - Recipient email
 * @param {string} otp - 6-digit OTP code
 * @param {string} recipientName - Name of recipient
 * @returns {Promise<Object>} Email response
 */
async function sendSignupOtpEmail(toEmail, otp, recipientName = 'User') {
  if (!resend) {
    logger.warn(`[MOCK EMAIL] Would have sent Signup OTP to ${toEmail}. OTP: ${otp}`);
    console.log(`\n==============================================`);
    console.log(`[MOCK EMAIL] SIGNUP OTP FOR ${toEmail}: ${otp}`);
    console.log(`==============================================\n`);
    return { id: 'mock-id-' + Date.now() };
  }

  try {
    console.log(`[RESEND] Sending signup OTP to ${toEmail}`);
    const startTime = Date.now();

    const result = await resend.emails.send({
      from: 'LeaseHub <onboarding@resend.dev>',
      to: toEmail,
      subject: 'Verify your LeaseHub Account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; text-align: center;">Welcome to LeaseHub!</h1>
          </div>
          
          <div style="background: #f5f5f5; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>Hi <strong>${recipientName}</strong>,</p>
            
            <p>Thank you for signing up for LeaseHub. To complete your registration and activate your account, please verify your email address.</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 25px 0;">
              <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">Your verification OTP is:</p>
              <h2 style="color: #667eea; font-size: 36px; letter-spacing: 8px; margin: 10px 0;">${otp}</h2>
              <p style="color: #999; margin: 10px 0 0 0; font-size: 12px;">Valid for 10 minutes</p>
            </div>
            
            <p style="color: #666;">Enter this OTP on the verification page to activate your account.</p>
            
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              This is an automated email from LeaseHub. Please do not reply to this email.
            </p>
          </div>
        </div>
      `,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(3);
    logger.info(`[RESEND] ✅ Signup OTP sent to ${toEmail} in ${duration}s, ID: ${result.id}`);
    console.log(`[RESEND] ✅ Email sent successfully in ${duration}s, Message ID: ${result.id}`);
    
    return result;
  } catch (error) {
    logger.error('[RESEND] ❌ Failed to send signup OTP:', error);
    console.error('[RESEND] ❌ Email error:', error.message);
    throw error;
  }
}

module.exports = {
  sendResetOtpEmail,
  sendPasswordChangeOtpEmail,
  sendSignupOtpEmail,
  isResendAvailable
};
