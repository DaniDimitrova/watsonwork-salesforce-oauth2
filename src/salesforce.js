/* eslint-env es_modules */
import querystring from 'querystring';
import url from 'url';
import debug from 'debug';
import nforce from 'nforce';
import * as events from './events';
import * as state from './state';
import * as messages from './messages';

// Setup debug log
const log = debug('watsonwork-messages-salesforce');

class SalesforceClient {
  constructor() {
  	this.oAuth2Client = nforce.createConnection({
      clientId: process.env.SAPI_CLIENT_ID,
      clientSecret: process.env.SAPI_CLIENT_SECRET,
      redirectUri: process.env.SAPI_CLIENT_REDIRECT_URI
    });
    this.handleCallback = this.handleCallback.bind(this);
    this.checkToken = this.checkToken.bind(this);
  }

  handleCallback(store) {
    return (req, res, next) => {
      const qs = querystring.parse(url.parse(req.url).query);
      return this.oAuth2Client.authenticate(
        { code: qs.code },
        this.loopTokenRequest(qs.state, store, next)
      );
    };
  }

  reauth(action, userId) {
    if (!this.wwToken) {
      log('cannot send authorization request');
      return;
    }
    const scope = ['api', 'refresh_token'];
    const authorizeUrl = this.oAuth2Client.getAuthUri({
      scope,
      state: userId
    });
    messages.sendTargeted(
      action.conversationId,
      userId,
      action.targetDialogId,
      'Please log in to Salesforce',
      authorizeUrl,
      this.wwToken()
    );
  };

  // Refresh tokens 1m before they expire
  getTTL(expiryDate) {
    let ttl = expiryDate - Date.now() - 60 * 1000;
    if (process.env.SAPI_REFRESH_INTERVAL) {
      ttl = parseInt(process.env.SAPI_REFRESH_INTERVAL, 10);
    }
    return Math.max(0, ttl);
  }

  loopTokenRequest(userId, store, cb) {
    return (err, body) => {
      if (err) {
        log('Error authenticating: %o', err);
        return;
      }
      log('got tokens for %s, body: %o', userId, body);
      state.run(userId, store, (err, ostate, put) => {
        if (err) {
          // request may have originated from a different user
          put(err);
          return;
        }
        // keep the refresh token if we had one, assuming we didn't just get a new one.
        let newState = Object.assign({}, ostate, { tokens: body });
        if (ostate.tokens && !body.tokens.refresh_token) {
          newState.tokens.refresh_token = ostate.tokens.refresh_token;
        }
        put(null, newState, () => {
          setTimeout(
            () => {
              const tokens = newState.tokens;
              log('Requesting refresh token %o', tokens);
              this.oAuth2Client.refreshToken(
                { oauth: tokens },
                this.loopTokenRequest(userId, store)
              );
            },
            this.getTTL(body.tokens.expiry_date)
          );
          if (cb) {
            cb();
          }
        });
      });
    };
  }

  /**
   * Returns an express middleware function to handle unauthenticated users.
   * @param {string} appId - to ensure the action originated from this app
   * @param {PouchDB} store
   */
  checkToken(appId, store) {
    return (req, res, next) => {

      // Respond to the Webhook right away, as any response messages will
      // be sent asynchronously
      res.status(200).end();

      const { userId } = req.body;

      state.run(userId, store, (e, userState, put) => {
        log('get existing state for user: %o, err: %o', userState, e);
        if (e || !userState.tokens || !userState.tokens.access_token) {
          // if the user is not authenticated, store what they were trying to do
          // in pouch so they can pick it back up when they finish authenticating.
          events.onActionSelected(req.body, appId, (actionId, action) => {
            const args = actionId.split(' ');
              // May need to handle conflicts; user authenticating on multiple clients?
              put(
                null,
                Object.assign({}, userState, {
                  actionType: args[0],
                  action,
                  tokens: null
                }),
                () => this.reauth(action, userId)
              );
          });
          return;
        }
        next();
      });
    };
  }
}

export default new SalesforceClient();
