/// Email forwarding service for Imago level accounts
/// Forwards emails to external addresses while maintaining local storage

export interface ForwardingConfig {
  enabled: boolean;
  targetEmail: string;
  level: 'imago' | 'ghost';
  filters?: {
    sendOtpOnly?: boolean;
    excludeNewsletters?: boolean;
    minimumTrustScore?: number;
  };
}

export async function checkForwardingConfig(
  env: any,
  agentName: string
): Promise<ForwardingConfig | null> {
  try {
    const configKey = `forwarding:${agentName}`;
    const configData = await env.INBOX_KV.get(configKey);
    
    if (!configData) {
      // Check if agent is Imago level and has default forwarding
      const acctTierKey = `acct-tier:${agentName}`;
      const acctTierData = await env.INBOX_KV.get(acctTierKey);
      
      if (acctTierData) {
        const acctTier = JSON.parse(acctTierData);
        if (acctTier.tier === 'imago' && acctTier.forwardingEmail) {
          return {
            enabled: true,
            targetEmail: acctTier.forwardingEmail,
            level: 'imago'
          };
        }
      }
      
      return null;
    }
    
    return JSON.parse(configData);
  } catch (error) {
    console.error('Error checking forwarding config:', error);
    return null;
  }
}

export async function forwardEmail(
  env: any,
  agentName: string,
  email: {
    from: string;
    to: string;
    subject: string;
    content: string;
    timestamp: number;
  },
  parsedData?: any
): Promise<boolean> {
  console.log(`[forwardEmail] Starting for agent=${agentName}`);
  const config = await checkForwardingConfig(env, agentName);

  console.log(`[forwardEmail] Config:`, config);

  if (!config || !config.enabled) {
    console.log(`[forwardEmail] Config not found or disabled`);
    throw new Error('Config not found or disabled');
  }

  try {
    // Apply filters if configured
    if (config.filters) {
      if (config.filters.sendOtpOnly && !parsedData?.isOtp) {
        throw new Error('Filter: sendOtpOnly enabled but email is not OTP');
      }

      if (config.filters.excludeNewsletters) {
        const subject = email.subject.toLowerCase();
        const from = email.from.toLowerCase();
        const newsletterKeywords = ['unsubscribe', 'newsletter', 'digest', 'update', 'announcement'];

        if (newsletterKeywords.some(keyword =>
          subject.includes(keyword) || from.includes(keyword)
        )) {
          throw new Error('Filter: newsletter excluded');
        }
      }

      if (config.filters.minimumTrustScore && parsedData) {
        // Extract numeric score from trust score impact (e.g., "+1.0" -> 1.0)
        const trustMatch = parsedData.trustScoreImpact?.match(/([+-]?\d+\.?\d*)/);
        if (trustMatch) {
          const score = parseFloat(trustMatch[1]);
          if (score < config.filters.minimumTrustScore) {
            throw new Error(`Filter: trust score ${score} below minimum ${config.filters.minimumTrustScore}`);
          }
        }
      }
    }
    
    // Build forwarded email
    const forwardedContent = buildForwardedEmail(email, agentName, parsedData);
    
    // Send via external email service (using Mailgun, SendGrid, or similar)
    const success = await sendExternalEmail(env, config.targetEmail, forwardedContent);
    
    if (success) {
      // Log forwarding activity
      await logForwardingActivity(env, agentName, {
        originalFrom: email.from,
        originalTo: email.to,
        targetEmail: config.targetEmail,
        subject: email.subject,
        timestamp: Date.now(),
        level: config.level
      });
    }
    
    return success;
  } catch (error) {
    console.error('Error forwarding email:', error);
    throw error; // Re-throw to get detailed error in testForwarding
  }
}

function buildForwardedEmail(
  originalEmail: {
    from: string;
    to: string;
    subject: string;
    content: string;
    timestamp: number;
  },
  agentName: string,
  parsedData?: any
): {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
} {
  const timestamp = new Date(originalEmail.timestamp).toLocaleString();
  
  // Build HTML version
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .forwarded-info { background: #e3f2fd; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .agent-data { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; font-family: monospace; font-size: 12px; }
        .content { border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
        .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>📧 Forwarded from GhostAgent</h2>
        <p><strong>Agent:</strong> ${agentName}@nftmail.box</p>
        <p><strong>Original Time:</strong> ${timestamp}</p>
      </div>
      
      <div class="forwarded-info">
        <h3>📋 Email Details</h3>
        <p><strong>From:</strong> ${originalEmail.from}</p>
        <p><strong>Subject:</strong> ${originalEmail.subject}</p>
        <p><strong>To:</strong> ${originalEmail.to}</p>
      </div>
      
      ${parsedData ? `
      <div class="agent-data">
        <h3>🤖 Agent Intelligence</h3>
        <p><strong>Intent:</strong> ${parsedData.intent}</p>
        <p><strong>Trust Impact:</strong> ${parsedData.trustScoreImpact}</p>
        ${parsedData.isOtp ? `<p><strong>OTP Code:</strong> <span style="color: #ff6b6b; font-weight: bold;">${parsedData.otpCode}</span></p>` : ''}
        <p><strong>Summary:</strong> ${parsedData.summary}</p>
      </div>
      ` : ''}
      
      <div class="content">
        <h3>📄 Original Content</h3>
        <div style="white-space: pre-wrap;">${originalEmail.content}</div>
      </div>
      
      <div class="footer">
        <p>Forwarded by GhostAgent Imago Service</p>
        <p>Manage forwarding: <a href="https://ghostagent.ninja/agent/${agentName}">ghostagent.ninja/agent/${agentName}</a></p>
      </div>
    </body>
    </html>
  `;
  
  // Build text version
  const text = `
Forwarded from GhostAgent
==========================

Agent: ${agentName}@nftmail.box
Original Time: ${timestamp}

Email Details:
From: ${originalEmail.from}
Subject: ${originalEmail.subject}
To: ${originalEmail.to}

${parsedData ? `
Agent Intelligence:
-----------------
Intent: ${parsedData.intent}
Trust Impact: ${parsedData.trustScoreImpact}
${parsedData.isOtp ? `OTP Code: ${parsedData.otpCode}` : ''}
Summary: ${parsedData.summary}

` : ''}Original Content:
-----------------
${originalEmail.content}

---
Forwarded by GhostAgent Imago Service
Manage forwarding: https://ghostagent.ninja/agent/${agentName}
  `;
  
  return {
    from: `${agentName}@mg.nftmail.box`,
    to: originalEmail.to,
    subject: `[Forwarded] ${originalEmail.subject}`,
    html,
    text
  };
}

async function sendExternalEmail(
  env: any,
  toEmail: string,
  emailData: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }
): Promise<boolean> {
  // Determine if sending to ghostmail.box address - use appropriate Mailgun domain
  const targetDomain = toEmail.split('@')[1]?.toLowerCase() || '';
  const isGhostmailTarget = targetDomain === 'ghostmail.box' || targetDomain.endsWith('.ghostmail.box');
  
  // Use appropriate Mailgun domain and API key based on target
  const mailgunDomain = isGhostmailTarget ? 'mg.ghostmail.box' : (env.MAILGUN_DOMAIN || 'mg.nftmail.box');
  const mailgunApiKey = isGhostmailTarget 
    ? env.GM_MAILGUN_API_KEY 
    : (env.MG_SENDING_MAILGUN_API_KEY || env.SEND_MAILGUN_API_KEY || env.MAILGUN_API_KEY);

  if (!mailgunDomain || !mailgunApiKey) {
    console.warn(`Mailgun credentials not configured for ${isGhostmailTarget ? 'ghostmail' : 'nftmail'}, skipping email send`);
    throw new Error(`Mailgun credentials not configured for ${isGhostmailTarget ? 'ghostmail' : 'nftmail'}`);
  }

  try {
    const formData = new FormData();
    formData.append('from', emailData.from);
    formData.append('to', toEmail);
    formData.append('subject', emailData.subject);
    formData.append('html', emailData.html);
    formData.append('text', emailData.text);

    const response = await fetch(
      `https://api.eu.mailgun.net/v3/${mailgunDomain}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`api:${mailgunApiKey}`)}`,
        },
        body: formData
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`Mailgun API error for domain ${mailgunDomain}:`, error);
      throw new Error(`Mailgun API error for domain ${mailgunDomain}: ${error}`);
    }

    console.log(`Successfully forwarded email via ${mailgunDomain} to ${toEmail}`);

    return true;
  } catch (error) {
    console.error('Error sending email via Mailgun:', error);
    throw error;
  }
}

async function logForwardingActivity(
  env: any,
  agentName: string,
  activity: {
    originalFrom: string;
    originalTo: string;
    targetEmail: string;
    subject: string;
    timestamp: number;
    level: string;
  }
): Promise<void> {
  try {
    const logKey = `forwarding-log:${agentName}`;
    const existingLog = await env.INBOX_KV.get(logKey);
    const log = existingLog ? JSON.parse(existingLog) : [];
    
    log.unshift(activity);
    
    // Keep only last 100 forwarding activities
    if (log.length > 100) {
      log.splice(100);
    }
    
    await env.INBOX_KV.put(logKey, JSON.stringify(log), {
      expirationTtl: 30 * 24 * 60 * 60 // 30 days
    });
  } catch (error) {
    console.error('Error logging forwarding activity:', error);
  }
}
