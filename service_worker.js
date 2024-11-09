// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
   if (message.action === 'authenticationCompleted') {
      console.log('Authentication completed, starting email polling');

      // Polling every minute
      setInterval(async () => {
         try {
            const authResult = await chrome.identity.getAuthToken({ interactive: false });
            await checkEmailHistory(authResult.token);
         } catch (error) {
            console.log("Error from chrome.identity.getAuthToken: ", error);
            await chrome.notifications.create('auth-error', {
               type: 'basic',
               iconUrl: 'icons/Mail-Summarizer-AI-logo.webp',
               title: 'Gmail AI Assistant - Authentication Error',
               message: 'Gmail access has been revoked. Please open the extension and reconnect.',
               priority: 2,
               requireInteraction: true
            });
            return;
         }
      }, 10000);
   }
});

// NOT_IMPORTANT_EMAILS = ["CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS"]
NOT_IMPORTANT_EMAILS = []

async function checkEmailHistory(token) {
   console.log("token = ", token)
   let init = {
      method: 'GET',
      async: true,
      headers: {
         Authorization: 'Bearer ' + token,
         'Content-Type': 'application/json'
      },
      'contentType': 'json'
   };
   const { historyId } = await chrome.storage.local.get('historyId');
   const startHistoryId = historyId || await getStartHistoryId(token);
   const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}`,
      init
   );
   // If startHistoryId is too old
   if (response.status === 404) {
      console.log('History ID too old, retrieving latest historyId...');
      await chrome.storage.local.set({ historyId: await getStartHistoryId(token) });
   }
   else {
      const data = await response.json();
      if (data.historyId)
         await chrome.storage.local.set({ historyId: data.historyId });

      return processHistoryChanges(data.history || [], token);
   }
}

async function getStartHistoryId(token) {
   try {
      let init = {
         method: 'GET',
         async: true,
         headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
         },
         'contentType': 'json'
      };
      // Get a recent message from inbox
      const response = await fetch(
         'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1',
         init
      );
      const data = await response.json();
      if (!data.messages || data.messages.length === 0)
         throw new Error('No messages found');

      // Get message details to obtain historyId
      const messageId = data.messages[0].id;
      const messageResponse = await fetch(
         `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
         init
      );
      const messageData = await messageResponse.json();
      return messageData.historyId;
   } catch (error) {
      console.log("Error in function getStartHistoryId: ", error);
      return -1
   }
}

async function processHistoryChanges(history, token) {
   for (const record of history)
      if (record.messagesAdded) // check if it's a new message
         for (const message of record.messagesAdded)
            await processNewEmail(message.message.id, token);
}

async function processNewEmail(messageId, token) {
   try {
      const response = await fetch(
         `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
         {
            headers: {
               Authorization: 'Bearer ' + token,
               'Content-Type': 'application/json'
            }
         }
      );

      const emailData = await response.json();
      if (NOT_IMPORTANT_EMAILS.some(str => emailData.labelIds.includes(str))) {
         console.log(`Email ${messageId} is not important, no notification for it`)
         return;
      }

      const headers = emailData.payload.headers;
      const from = headers.find(h => h.name === 'From').value;
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';

      // Extract email body
      let body = '';
      if (emailData.payload.parts) {
         const textPart = emailData.payload.parts.find(part => part.mimeType === 'text/plain');
         if (textPart && textPart.body.data)
            body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      } else if (emailData.payload.body.data) {
         body = atob(emailData.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
      const summary = await summarizeWithGPT(body);
      const senderName = from.split('<')[0].trim();
      await chrome.notifications.create(messageId, {
         type: 'basic',
         iconUrl: 'icons/Mail-Summarizer-AI-logo.webp',
         title: `${senderName}: ${subject}`,
         message: summary,
         contextMessage: from,
         requireInteraction: true,
         isClickable: true
      });

   } catch (error) {
      console.error('Error in function processNewEmail:', error);
   }
}

const OPENAI_API_KEY = 'your_openai_api_key';

async function summarizeWithGPT(emailBody) {
   try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
         method: 'POST',
         headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
         },
         body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [
               {
                  role: "system",
                  content: "Sei un assistente che riassume email. Riassumi il contenuto in massimo 150 caratteri."
               },
               {
                  role: "user",
                  content: emailBody
               }
            ],
            max_tokens: 60  // Circa 150 caratteri
         })
      });

      const data = await response.json();
      return data.choices[0].message.content;
   } catch (error) {
      console.error('Error calling GPT:', error);
      return "404"
   }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
   // The notificationId is the message ID
   const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${notificationId}`;
   await chrome.tabs.create({ url: gmailUrl });
   await chrome.notifications.clear(notificationId);
});

async function testNotifications() {
   chrome.identity.getAuthToken({ interactive: false }, async function (token) {
      try {
         let init = {
            method: 'GET',
            async: true,
            headers: {
               Authorization: 'Bearer ' + token,
               'Content-Type': 'application/json'
            },
            'contentType': 'json'
         };
         const response = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=3',
            init
         );
         const data = await response.json();

         if (!data.messages || data.messages.length === 0) {
            throw new Error('No messages found');
         }
         for (const message of data.messages)
            await processNewEmail(message.id);

      } catch (error) {
         console.error('Error in testNot:', error);
      }
   });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
   if (message.action === 'testNotifications') {
      testNotifications();
   }
});
