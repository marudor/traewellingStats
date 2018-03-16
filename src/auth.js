// @flow
/* eslint no-console: 0 */
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs-extra';
import readline from 'readline';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_DIR = `${process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE || ''}/.credentials/`;
const TOKEN_PATH = `${TOKEN_DIR}sheets.googleapis.com-traewelling.json`;

function getNewToken(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Authorize this app by visiting this url: ', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question('Enter the code from that page here: ', code => {
      rl.close();
      oauth2Client.getToken(code, async (err, token) => {
        if (err) {
          console.log('Error while trying to retrieve access token', err);

          return;
        }
        oauth2Client.credentials = token;

        try {
          await fs.mkdir(TOKEN_DIR);
        } catch (e) {
          if (e.code !== 'EEXIST') {
            throw e;
          }
        }
        await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
        resolve(oauth2Client);
      });
    });
  });
}

export default async function authorize() {
  const credentials = JSON.parse(await fs.readFile('client_id.json'));
  const clientSecret = credentials.installed.client_secret;
  const clientId = credentials.installed.client_id;
  const redirectUrl = credentials.installed.redirect_uris[0];
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUrl);

  await fs
    .readFile(TOKEN_PATH)
    .then(token => (oauth2Client.credentials = JSON.parse(token)))
    .catch(() => getNewToken(oauth2Client));

  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      getNewToken(oauth2Client);
    } else {
      oauth2Client.credentials = JSON.parse(token);
    }
  });

  google.options({ auth: oauth2Client });

  return oauth2Client;
}
