require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('[TEST] Starting email test with SSL port 465...');
console.log('[TEST] SMTP Configuration:');
console.log(`  Host: ${process.env.SMTP_HOST}`);
console.log(`  Port: ${process.env.SMTP_PORT}`);
console.log(`  Secure: ${process.env.SMTP_SECURE}`);
console.log(`  User: ${process.env.SMTP_USER}`);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  pool: true,
  maxConnections: 5,
  connectionTimeout: 10000,
  socketTimeout: 15000
});

transporter.verify(function(error, success) {
  if (error) {
    console.error('[TEST] ❌ SMTP connection failed:', error);
    process.exit(1);
  } else {
    console.log('[TEST] ✅ SMTP server is ready to send emails');
    
    const mailOptions = {
      from: `"Property Management" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: 'Test Email - Port 465 SSL',
      html: `
        <h2>SMTP Test Successful</h2>
        <p>This test email confirms that the SMTP configuration is working correctly.</p>
        <ul>
          <li>Port: ${process.env.SMTP_PORT}</li>
          <li>SSL: ${process.env.SMTP_SECURE}</li>
          <li>Host: ${process.env.SMTP_HOST}</li>
        </ul>
        <p>Sent at: ${new Date().toLocaleString()}</p>
      `
    };
    
    const startTime = Date.now();
    console.log('[TEST] Sending test email...');
    
    transporter.sendMail(mailOptions, (error, info) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(3);
      
      if (error) {
        console.error('[TEST] ❌ Email failed:', error);
        process.exit(1);
      } else {
        console.log(`[TEST] ✅ Email sent successfully in ${duration} seconds`);
        console.log('[TEST] Message ID:', info.messageId);
        console.log('[TEST] Response:', info.response);
        process.exit(0);
      }
    });
  }
});

setTimeout(() => {
  console.error('[TEST] ⏱️ Test timed out after 30 seconds');
  process.exit(1);
}, 30000);
