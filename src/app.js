// A sample app that listens to messages posted to a space in IBM
// Watson Workspace and implements actions that return the user's messages.

import debug from 'debug';
import express from 'express';
import querystring from 'querystring';
import url from 'url';
import _ from 'lodash';
import * as bparser from 'body-parser';
import * as http from 'http';
import * as https from 'https';
import * as oauth from './oauth';
import * as ssl from './ssl';
import * as sign from './sign';
import * as messages from './messages';
import * as events from './events';
import * as state from './state';
import googleClient from './google';

// Debug log
const log = debug('watsonwork-messages-app');

const handleCommand = (action, userId, wwToken, gmailTokens) => {
  const gmail = googleClient.makeGmailInstance(gmailTokens);
  gmail.users.threads.list({ userId: 'me', maxResults: 5 }).then(({ data }) => {
    messages.sendTargeted(
      action.conversationId,
      userId,
      action.targetDialogId,
      'Your Messages',
      _.unescape(data.threads.map((message) => `1. ${message.snippet}`).join('\\n')),
      wwToken()
    );
  });
};

// Handle events sent to the Weather action Webhook at /messages
export const messagesCallback = (appId, store, wwToken) =>
  (req, res) => {
    log('Received body %o', req.body);

    // Respond to the Webhook right away, as any response messages will
    // be sent asynchronously
    res.status(201).end();
    events.onActionSelected(req.body, appId,
      (actionId, action, userId) => {

        state.get(userId, store, (err, userState) => {
            // handles action fulfillment annotations
          const args = actionId.split(' ');
          switch(args[0]) {
            case '/messages':
              handleCommand(action, userId, wwToken, userState.tokens);
              break;
          }
        });
    });
  };

export const oauthCompleteCallback = (store, wwToken) => (req, res) => {
  log('completed oauth flow, resuming user action...');
  res.end('Login successful, you may close this window and retry the `/messages` action');

  // This won't work as-written; your app can use the new access token from
  // pouchDB state to do anything in gmail, but sending a targeted message back to
  // Watson Workspace won't work because we already sent a targeted message to this dialog.
  const userId = querystring.parse(url.parse(req.url).query).state;
  state.run(userId, store, (err, ostate, put) => {
    log('completing user action with state %o error %o', ostate, err);
    if (err) {
      return;
    }
    const { actionType, action, tokens } = ostate;
    switch(actionType) {
      case '/messages':
        handleCommand(action, userId, wwToken, tokens);
        // once complete, remove state for user except for tokens
        put(null, { _rev: ostate._rev, tokens });
        break;
    }
  });
};

// Create Express Web app
export const webapp =
  (appId, secret, whsecret, initialStore, cb) => {
    // Authenticate the app and get an OAuth token
    oauth.run(appId, secret, (err, wwToken) => {
      if(err) {
        cb(err);
        return;
      }

      const store = state.store(initialStore);

      googleClient.wwToken = wwToken;
      
      const app = express();
      // Configure Express route for the app Webhook
      app.post('/messages',

        // Verify Watson Work request signature and parse request body
        bparser.json({
          type: '*/*',
          verify: sign.verify(whsecret)
        }),

        // Handle Watson Work Webhook challenge requests
        sign.challenge(whsecret),

        googleClient.checkToken(appId, store),

        // Handle Watson Work Webhook events
        messagesCallback(appId, store, wwToken)
      );

      // google will call this endpoint after a user completes their authentication,
      // then this app will complete the OAuth2 handshake by getting an access token from google
      app.get('/oauth2callback',
        googleClient.handleCallback(store),
        oauthCompleteCallback(store, wwToken)
      );

      // Return the Express Web app
      cb(null, app);

        
    });
  };

// App main entry point
const main = (argv, env, cb) => {
  // Create Express Web app
  webapp(
    env.WW_APP_ID,
    env.WW_APP_SECRET,
    env.WW_WEBHOOK_SECRET,
    env.WW_STORE,
    (err, app) => {
      if (err) {
        cb(err);
        return;
      }

      if (env.PORT) {
        // In a hosting environment like Bluemix for example, HTTPS is
        // handled by a reverse proxy in front of the app, just listen
        // on the configured HTTP port
        log('HTTP server listening on port %d', env.PORT);
        http.createServer(app).listen(env.PORT, cb);
      } else {
        // Listen on the configured HTTPS port, default to 443
        ssl.conf(env, (err, conf) => {
          if(err) {
            cb(err);
            return;
          }
          const port = env.SSLPORT || 443;
          log('HTTPS server listening on port %d', port);
          https.createServer(conf, app).listen(port, cb);
        });
      }
    });
};

if (require.main === module) {
  main(process.argv, process.env, (err) => {
    if (err) {
      console.log('Error starting app:', err);
      return;
    }
    log('App started');
  });
}
