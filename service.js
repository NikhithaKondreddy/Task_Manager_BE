const { google } = require('googleapis');

const auth = new google.auth.GoogleAuth({
  keyFile: './taskmanager-452805-569f42b7ea17.json',  // Replace with your JSON key file path
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

async function getAuthClient() {
  return await auth.getClient();
}
