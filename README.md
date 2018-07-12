# watsonwork-salesforce-oauth2

A sample Watson Work app that presents a user with their messages from Salesforce,
handling Salesforce's OAuth2.0 flow and storing multiple users' tokens in a PouchDB
instance.

## Try it out

To try the sample app do the following:

### Deploying the app to IBM Bluemix

If you want to give the sample app a quick try using [Bluemix](https://bluemix.net), you can simply get it deployed to Bluemix straight
from Github without even having to download it to your local development
environment and build it yourself. Just click the button below:

[![Deploy to Bluemix](https://bluemix.net/deploy/button.png)](https://bluemix.net/deploy?repository=https://github.com/ZacharyStair/watsonwork-salesforce-oauth2&branch=master)

> Note: it is likely that the pipeline step failed to automatically configure,
> you can create your own by adding two different pipeline stages with one job each:
> Build and Deploy.
> 
> For the build step, choose 'npm' as the 'builder type' and replace
> the build script with the following (obtained from .bluemix/pipeline.yml):
> ```
> #!/bin/bash
> export PATH=/opt/IBM/node-v6.2.2/bin:$PATH
> export NODE_ENV=development
> npm install
> npm run babel
> ```
> The defaults are fine for the other steps, though you can decrease the amount of memory
> the app uses (it is very lightweight) by changing the deploy command to
> `cf push -m 256M "${CF_APP}"`

Once that's done, go to your
[Bluemix Dashboard](https://console.ng.bluemix.net/dashboard/cf-apps). The
app you've just deployed should be listed on that page. Write down its
**route** public URL (usually `https://<bluemix app name>.mybluemix.net`)
as you will need it later to register the app's Webhook endpoint with
the Watson Work platform.

### Building the app locally

You can skip this if you've just deployed the app directly to Bluemix.

To build the app in your local development environment, follow these steps:

Install Node.js 6+.

In a terminal window, do the following:
```sh
# For more verbose output
export DEBUG=watsonwork-*

# Get the code
git clone https://github.com/ZacharyStair/watsonwork-salesforce-oauth2

# Build the app
cd watsonwork-salesforce-oauth2
npm run build
```

### Configuring the Salesforce API service

You must create an app on the [Salesforce Cloud Platform](https://console.cloud.salesforce.com/),
include the Salesforce API under the 'APIs' section, and create 'credentials' for
this app, providing your **route** public URL (from above), followed by
`/oauth2Callback` (i.e. `https://<bluemix app name>.mybluemix.net/oauth2Callback`)

This callback url will become our 'redirect uri' for the OAuth2.0 flow.

### Registering the app with Watson Work

In your Web browser, go to [Watson Work Services / Apps](https://workspace.ibm.com/developer/apps) and add a new app named
**Messages** (be sure to save the app's secret) with a Webhook configured **message-annotation-added** events (saving the webhook's secret).

Set the Webhook **Callback URL** to a public URL targeting the server where
you're planning to run the sample app,
`https://<your server hostname>/messages` for example, or
`https://<bluemix app name>.mybluemix.net/messages` if you've deployed it
to Bluemix.

Configure the **Add an Action** section of the app to use your /messages endpoint when invoked (i.e. make your command `/messages` and choose the webhook you just configured).

Save the app and write down its app id, app secret and Webhook secret.

### Starting the app on Bluemix

Go to your
[Bluemix Dashboard](https://console.ng.bluemix.net/dashboard/cf-apps),
select your app and under **Runtime** / **Environment Variables** /
**User Defined**, add the following variables:

```
WW_APP_ID: <this app's id>                                      
WW_APP_SECRET: <this app's secret>                              
WW_WEBHOOK_SECRET: <this app's secret>
SAPI_CLIENT_ID: <obtained from Salesforce app dashboard>
SAPI_CLIENT_SECRET: <obtained from Salesforce app dashboard>
SAPI_CLIENT_REDIRECT_URI: <obtained from Salesforce app dashboard>
DEBUG: watsonwork-*
```

(you can use `SAPI_REFRESH_INTERVAL: 12345` to set the interval that token refresh 
requests are sent out)

Click the **> Start** button to start the app.

### Launching the app from the Bluemix DevOps Services IDE

If you've followed the above steps to deploy the app to Bluemix, it is now
also set up as a project in the [Bluemix DevOps Services](https://hub.jazz.net)
Web IDE, allowing you to edit and manage the app directly from within the IDE.

Pushing whatever changes you make to the github repo for your bluemix app will automatically trigger your app server to redeploy.

### Starting the app locally

You can skip this if you've just started the app on Bluemix.

In the terminal window, do the following:
```
# Configure the app id and app secret
export WW_APP_ID <this app's id>
export WW_APP_SECRET <this app's secret>
export WW_WEBHOOK_SECRET <this app's secret>
export SAPI_CLIENT_ID <obtained from Salesforce app dashboard>
export SAPI_CLIENT_SECRET <obtained from Salesforce app dashboard>
export SAPI_CLIENT_REDIRECT_URI <obtained from Salesforce app dashboard>
```

The Watson Work platform requires Webhook endpoints to use HTTPS. The
sample app listens on HTTPS port 443 and can be configured to use an SSL
certificate like follows:
```
# Configure the SSL certificate
export SSLCERT=<path to your SSL certificate in PEM format>
export SSLKEY=<path to your SSL certificate key in PEM format>

# Start the app
npm start
```

You can also use a different HTTPS port number and a self-signed certificate,
like follows:
```
# Configure the HTTPS port number
export SSLPORT=8443

# Generate a self-signed SSL certificate with /CN set to your server's
# FQDN (fully qualified domain name), www.yourcompany.com for example
openssl req -nodes -new -x509 -keyout server.key -out server.crt -subj "/CN=your server's FQDN"
export SSLCERT=server.crt
export SSLKEY=server.key

# Start the app
npm start
```

If you're running behind a HTTPS proxy, you may want to have the app listen
on HTTP instead to let the proxy handle the HTTPS to HTTP conversion, like
follows:
```
# Configure the HTTP port
export PORT=8080

# Start the app
npm start
```

Finally, if the app is running on your development machine and you don't
want to set up a public IP and domain name for it yourself, you can also
use one the tunnel tools popular for Webhook development like
[localtunnel](https://localtunnel.github.io/www/) or
[ngrok](https://ngrok.com) for example.

Here's how to use a tunnel with localtunnel:

```
# Install the localtunnel module
npm install -g localtunnel

# Set up a tunnel from https://<subdomain name>.localtunnel.me
# to localhost:8080
lt --subdomain <pick a subdomain name> --port 8080

# Configure the app HTTP port
# No need for HTTPS here as localtunnel handles it
export PORT=8080

# Start the app
npm start
```

You can now go back to
[Watson Work Services / Apps](https://workspace.ibm.com/developer/apps),  
edit the **Messages** app and set its Webhook **Callback URL** to
`https://<subdomain name>.localtunnel.me/messages`, and set the authorization
callback of your Salesforce Cloud app to the same.

### Enabling the app Webhook

Once the app is running and listening for HTTPS requests at a public URL,
you're ready to **enable** its Webhook on the Watson Work platform.

Go back to
[Watson Work Services / Apps](https://workspace.ibm.com/developer/apps),
edit the **Messages** app and set its Webhook to **Enabled**. Watson Work will
ping the app Webhook callback URL with a verification challenge request to
check that it's up and responding correctly.

The sample app will respond to that challenge request and output the
following log:
```
watsonwork-messages-app Got Webhook verification challenge
```

### Using the app

Once the webhook is enabled, that's it! Add the app to a space and invoke it using the `/messages` command (or whatever command you configured in WWS).

The app will output a salesforce link to prompt the user to authorize, allowing the
app access to read their mail. If the user accepts and logs in, the app will
receive and store an `access_token` for them that will allow the app to perform
certain salesforce requests as that user.

If the app then receives another `/messages` request from that user, it will
show them snippets of their first 5 salesforce threads.

Tokens will be refreshed automatically 1 minute before they expire, but note that
Salesforce does not return refresh tokens if the user has already authorized an app.
This means if you redeploy the app, the pouchDB (in-memory) store will be emptied
and users' refresh tokens will be lost. For users to have their tokens refreshed
after pushing new changes to the app, they will have to go revoke permissions from
salesforce.

If you replace the pouchDB database with a separate standalone service, that can
mitigate this issue.

## Project layout

The sample project source tree is organized as follows:

```sh
README.md     - this README
package.json  - Node.js package definition

src/          - Javascript sources

  app.js      - main app conversation handling script
  events.js   - parses Webhook events to be routed to app logic
  messages.js - reads and sends messages
  salesforce.js   - handles webhook events that require requests to be sent to salesforce
  graphql.js  - runs GraphQL queries
  oauth.js    - obtains OAuth tokens for the app
  sign.js     - signs and verifies Webhook requests and responses
  state.js    - stores user authorization state in a database
  ssl.js      - configures the app to use an SSL certificate

  test/       - unit tests
```

## How can I contribute?

Pull requests welcome!
