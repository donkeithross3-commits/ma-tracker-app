/**
 * Gmail Apps Script - Auto-forward M&A Research Emails to Webhook
 *
 * Setup Instructions:
 * 1. Open https://script.google.com
 * 2. Create a new project
 * 3. Paste this code
 * 4. Update WEBHOOK_URL with your ngrok URL (from start_with_ngrok.sh)
 * 5. Set up a time-driven trigger to run processInbox() every 5-10 minutes
 * 6. Grant permissions when prompted
 */

// ============================================
// CONFIGURATION
// ============================================

// Your webhook URL (update this with your ngrok URL)
const WEBHOOK_URL = 'https://YOUR-NGROK-URL.ngrok.io/webhooks/email/inbound';

// Trusted sender domains - emails from these will be auto-forwarded
const TRUSTED_DOMAINS = [
  'yetanothervalueblog.com',
  'pitchbook.com',
  'bloomberg.com',
  'reuters.com',
  'wsj.com',
  'ft.com'
];

// Gmail label to apply to processed emails
const PROCESSED_LABEL = 'MA-Tracker/Processed';
const ERROR_LABEL = 'MA-Tracker/Error';

// ============================================
// MAIN FUNCTION
// ============================================

/**
 * Process unread emails from trusted senders and forward to webhook
 * Set this to run every 5-10 minutes via time-driven trigger
 */
function processInbox() {
  // Get or create labels
  const processedLabel = getOrCreateLabel(PROCESSED_LABEL);
  const errorLabel = getOrCreateLabel(ERROR_LABEL);

  // Search for unread emails from trusted domains
  let searchQuery = 'is:unread (';
  searchQuery += TRUSTED_DOMAINS.map(d => `from:@${d}`).join(' OR ');
  searchQuery += ')';

  const threads = GmailApp.search(searchQuery, 0, 50); // Process up to 50 emails

  Logger.log(`Found ${threads.length} emails to process`);

  threads.forEach(thread => {
    const messages = thread.getMessages();

    messages.forEach(message => {
      // Skip if already processed
      const labels = message.getThread().getLabels();
      if (labels.some(l => l.getName() === PROCESSED_LABEL)) {
        return;
      }

      try {
        // Extract email data
        const from = message.getFrom();
        const subject = message.getSubject();
        const body = message.getPlainBody();

        Logger.log(`Processing: ${subject} from ${from}`);

        // Forward to webhook
        const success = forwardToWebhook(from, subject, body);

        if (success) {
          // Mark as processed
          message.getThread().addLabel(processedLabel);
          message.markRead();
          Logger.log('✅ Successfully forwarded to webhook');
        } else {
          // Mark as error
          message.getThread().addLabel(errorLabel);
          Logger.log('❌ Failed to forward to webhook');
        }

      } catch (error) {
        Logger.log(`Error processing message: ${error}`);
        message.getThread().addLabel(errorLabel);
      }
    });
  });
}

/**
 * Forward email to webhook endpoint
 */
function forwardToWebhook(from, subject, body) {
  try {
    const payload = {
      'from': from,
      'subject': subject,
      'text': body
    };

    const options = {
      'method': 'post',
      'payload': payload,
      'muteHttpExceptions': true
    };

    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    const statusCode = response.getResponseCode();

    Logger.log(`Webhook response: ${statusCode}`);
    Logger.log(`Response body: ${response.getContentText()}`);

    return statusCode === 200;

  } catch (error) {
    Logger.log(`Webhook error: ${error}`);
    return false;
  }
}

/**
 * Get or create a Gmail label
 */
function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    // Create nested labels if needed
    const parts = labelName.split('/');
    let currentLabel = '';

    parts.forEach((part, index) => {
      currentLabel += (index > 0 ? '/' : '') + part;
      if (!GmailApp.getUserLabelByName(currentLabel)) {
        GmailApp.createLabel(currentLabel);
      }
    });

    label = GmailApp.getUserLabelByName(labelName);
  }

  return label;
}

/**
 * Test function - run this manually to test the setup
 */
function testWebhook() {
  const testFrom = 'test@yetanothervalueblog.com';
  const testSubject = 'TEST: FRGE ($FRGE) - Merger Announced';
  const testBody = 'This is a test email to verify webhook connection.\n\nDeal value: $5.5 billion\nExpected close: Q2 2025';

  Logger.log('Sending test email to webhook...');
  const success = forwardToWebhook(testFrom, testSubject, testBody);

  if (success) {
    Logger.log('✅ Test successful!');
  } else {
    Logger.log('❌ Test failed - check webhook URL and logs');
  }
}

/**
 * Manual test - process a specific email
 */
function testProcessSingleEmail() {
  // Get the most recent email
  const threads = GmailApp.getInboxThreads(0, 1);

  if (threads.length === 0) {
    Logger.log('No emails found');
    return;
  }

  const messages = threads[0].getMessages();
  const message = messages[messages.length - 1];

  const from = message.getFrom();
  const subject = message.getSubject();
  const body = message.getPlainBody();

  Logger.log(`Testing with email:`);
  Logger.log(`From: ${from}`);
  Logger.log(`Subject: ${subject}`);
  Logger.log(`Body preview: ${body.substring(0, 200)}...`);

  const success = forwardToWebhook(from, subject, body);

  if (success) {
    Logger.log('✅ Email forwarded successfully!');
  } else {
    Logger.log('❌ Failed to forward email');
  }
}
