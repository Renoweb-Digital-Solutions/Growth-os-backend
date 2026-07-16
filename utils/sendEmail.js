const nodemailer = require('nodemailer');

// Reason: Centralized utility for sending emails, currently configured with a dummy transporter for development.
// How: Uses nodemailer. Logs the email contents to the console if real SMTP credentials aren't provided.
const sendEmail = async (options) => {
  // Create a transporter
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
    port: process.env.SMTP_PORT || 2525,
    auth: {
      user: process.env.SMTP_EMAIL || 'dummy_user',
      pass: process.env.SMTP_PASSWORD || 'dummy_password',
    },
  });

  // Define the email options
  const mailOptions = {
    from: `${process.env.FROM_NAME || 'GrowthOS'} <${process.env.FROM_EMAIL || 'noreply@growthos.com'}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  // Development fallback: If we are using dummy credentials, just log it.
  if (process.env.SMTP_EMAIL === 'dummy_user' || !process.env.SMTP_EMAIL) {
    console.log('===================================================');
    console.log(`[DEV MODE] Email intended for: ${options.email}`);
    console.log(`[DEV MODE] Subject: ${options.subject}`);
    console.log(`[DEV MODE] Message: \n${options.message}`);
    console.log('===================================================');
    return;
  }

  // Send the email
  const info = await transporter.sendMail(mailOptions);
  console.log('Message sent: %s', info.messageId);
};

module.exports = sendEmail;
