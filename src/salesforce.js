/* eslint-env es_modules */
import querystring from 'querystring';
import url from 'url';
import debug from 'debug';
import * as events from './events';
import * as state from './state';
import * as messages from './messages';

// Setup debug log
const log = debug('watsonwork-messages-salesforce');

class SalesforceClient {
  constructor() {
  	// this.oAuth2Client = new salesforce.auth.OAuth2(
    //   process.env.SAPI_CLIENT_ID,
    //   process.env.SAPI_CLIENT_SECRET,
    //   process.env.SAPI_CLIENT_REDIRECT_URI
    // );
    this.handleCallback = this.handleCallback.bind(this);
    this.checkToken = this.checkToken.bind(this);
  }

  /**
   * Our app handles tokens for multiple users, so we can create an 'oauth' client
   * as needed for each user.
   * This method isn't needed if you want to just use `request` and pass tokens directly
   * @param {Object} tokens 
   */
  makeSalesforceInstance(tokens) {
    // we likely don't need to pass all of the env variables again,
    // but doing so allows the oauthClient to eagerly refresh the tokens if needed.
    // const newOauthClient = new salesforce.auth.OAuth2(
    //   process.env.SAPI_CLIENT_ID,
    //   process.env.SAPI_CLIENT_SECRET,
    //   process.env.SAPI_CLIENT_REDIRECT_URI
    // );
    // newOauthClient.credentials = tokens;
    // return salesforce.salesforce({
    //   version: 'v1',
    //   auth: newOauthClient
    // });
  }

  handleCallback(store) {
    return (req, res, next) => {
      const qs = querystring.parse(url.parse(req.url).query);
      return this.oAuth2Client.getToken(qs.code).then(
        this.loopTokenRequest(qs.state, store, next)
      );
    };
  }

  reauth(action, userId) {
    if (!this.wwToken) {
      log('cannot send authorization request');
      return;
    }
    // const scopes = ['https://www.salesforceapis.com/auth/salesforce.readonly'];
    // const authorizeUrl = this.oAuth2Client.generateAuthUrl({
    //   access_type: 'offline',
    //   scope: scopes.join(' '),
    //   state: userId
    // });
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
    return (body) => {
      log('got tokens for %s, body: %o', userId, body);
      state.run(userId, store, (err, ostate, put) => {
        if (err) {
          // request may have originated from a different user
          put(err);
          return;
        }
        // keep the refresh token if we had one, assuming we didn't just get a new one.
        let newState = Object.assign({}, ostate, { tokens: body.tokens });
        if (ostate.tokens && !body.tokens.refresh_token) {
          newState.tokens.refresh_token = ostate.tokens.refresh_token;
        }
        put(null, newState, () => {
          setTimeout(
            () => {
              const token = body.tokens.refresh_token || ostate.tokens.refresh_token;
              log('Requesting refresh token %s', token);
              this.oAuth2Client.refreshToken(token).then(
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
