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
import salesforceClient from './salesforce';

// Debug log
const log = debug('watsonwork-messages-app');

const handleCommand = (actionType, action, userId, wwToken, store) => {
  state.run(userId, store, (err, ostate, put) => {
    const { tokens } = ostate;
    salesforceClient.oAuth2Client.getSObjects({ oauth: tokens }, (err, data) => {
      if (err) {
        log('Error getting SOBjects: %o', err);
        return;
      }
      messages.sendTargeted(
        action.conversationId,
        userId,
        action.targetDialogId,
        'Your first 15 Salesforce objects',
        _.unescape(data.sobjects.slice(0, 15).map((message) => `- ${message.name}`).join('\\n')),
        wwToken()
      );
      // remove any stored actions if action was successful.
      put(null, { _rev: ostate._rev, tokens });
    }).catch((e) => {
      log('error getting messages: %o', e.response);
      if (e && e.response && e.response.status === 401) {
        put(
          null,
          {
            _rev: ostate._rev,
            actionType: actionType || ostate.actionType,
            action: action || ostate.action,
            tokens: null
          },
          () => salesforceClient.reauth(action || ostate.action, userId)
        );
      }
    });
  });
};

/**
 * Creates a function that is called when the app receives a `/messages` webhook.
 * @param {String} appId - to ensure the app doesn't respond to other apps' messages
 * @param {PouchDB} store
 * @param {Function<String>} wwToken - returns a valid WW token to post as the app to WW
 */
export const messagesCallback = (appId, store, wwToken) =>
  (req, res) => {
    log('Received body %o', req.body);

    events.onActionSelected(req.body, appId,
      (actionId, action, userId) => {

        // handles action fulfillment annotations
        const args = actionId.split(' ');
        switch(args[0]) {
          case '/objects':
            handleCommand(args[0], action, userId, wwToken, store);
            break;
        }
    });
  };

export const oauthCompleteCallback = (store, wwToken) => (req, res) => {
  log('completed oauth flow, resuming user action...');
  res.end('Login successful, you may close this window and retry the `/messages` action');

  // This won't work as-written; your app can use the new access token from
  // pouchDB state to do anything in salesforce, but sending a targeted message back to
  // Watson Workspace won't work because we already sent a targeted message to this dialog.
  const userId = querystring.parse(url.parse(req.url).query).state;
  state.get(userId, store, (err, ostate) => {
    log('completing user action with state %o error %o', ostate, err);
    if (err) {
      return;
    }
    const { actionType, action } = ostate;
    switch(actionType) {
      case '/objects':
        handleCommand(actionType, action, userId, wwToken, store);
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

      salesforceClient.wwToken = wwToken;
      
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

        salesforceClient.checkToken(appId, store),

        // Handle Watson Work Webhook events
        messagesCallback(appId, store, wwToken)
      );

      // salesforce will call this endpoint after a user completes their authentication,
      // then this app will complete the OAuth2 handshake by getting an access token from salesforce
      app.get('/oauth2callback',
        salesforceClient.handleCallback(store),
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
