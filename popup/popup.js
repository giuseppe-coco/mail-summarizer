document.addEventListener('DOMContentLoaded', () => {
   const syncButton = document.getElementById('syncButton');
   const statusMessage = document.getElementById('statusMessage');
   const loader = document.getElementById('loader');
   const successIcon = document.getElementById('successIcon');

   // Check initial auth state
   chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (token) {
         console.log("Sono qui")
         runAuthenticationState();
      }
   });

   syncButton.addEventListener('click', async () => {
      // Show loading state
      syncButton.style.display = 'none';
      loader.style.display = 'block';
      statusMessage.textContent = 'Connecting to Gmail...';
      chrome.identity.getAuthToken({ interactive: true })
      .then(runAuthenticationState)
      .catch(authFailed);
   });

   function authFailed(error) {
      console.error('Authentication error:', error);
      // Show error state
      loader.style.display = 'none';
      syncButton.style.display = 'block';
      statusMessage.textContent = 'Authentication failed. Please try again.';
      statusMessage.style.color = 'var(--light-red)';
   }

   function runAuthenticationState() {
      loader.style.display = 'none';
      syncButton.style.display = 'none';
      successIcon.style.display = 'block';
      statusMessage.textContent = 'Successfully connected! You will receive AI-powered notifications for new emails.';
      
      // After 2 seconds, show monitoring message
      setTimeout(() => {
         statusMessage.textContent = 'Actively monitoring your inbox for new messages...';
      }, 2000);
      // Notify service worker
      console.log("Invio messaggio a servixe worker...")
      chrome.runtime.sendMessage({ 
         action: 'authenticationCompleted'
      });
   }
});
   