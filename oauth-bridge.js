// server.js (Express, very simplified)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const app = express();
app.use(express.urlencoded({ extended:true }));

// In-memory stores (replace with real DB)
const authCodes = {};        // authCode -> { shop, shopToken, alexaState, alexaClientId }
const alexaTokens = {};      // alexaAccessToken -> { shop, shopToken }

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const OAUTH_BRIDGE_BASE = process.env.OAUTH_BRIDGE_BASE; // https://mi-bridge.example.com

// 1) /authorize  (Alexa opens this)
app.get('/authorize', (req, res) => {
  // params from Alexa: client_id, redirect_uri, state, scope, response_type=code
  // Show simple HTML that asks the merchant for their shop domain
  const { redirect_uri, state, client_id } = req.query;
  res.send(`
    <h3>Link your Shopify store</h3>
    <form method="GET" action="/start_shopify_oauth">
      <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}" />
      <input type="hidden" name="state" value="${state}" />
      <input type="hidden" name="client_id" value="${client_id}" />
      Shop domain: <input name="shop" placeholder="example.myshopify.com"/>
      <button>Authorize in Shopify</button>
    </form>
  `);
});

app.get('/start_shopify_oauth', (req, res) => {
  const { shop, redirect_uri, state, client_id } = req.query;
  const shopifyAuthUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=unauthenticated_read_product_listings,unauthenticated_write_checkouts&redirect_uri=${encodeURIComponent(OAUTH_BRIDGE_BASE + '/shopify/callback')}&state=${encodeURIComponent(JSON.stringify({ alexa_redirect: redirect_uri, state, client_id }))}`;
  res.redirect(shopifyAuthUrl);
});

// 2) Shopify redirects here with ?code=...&shop=...
app.get('/shopify/callback', async (req, res) => {
  try {
    const { code, shop } = req.query;
    const meta = JSON.parse(req.query.state || '{}');
    // Exchange code for shop token
    const tokenResp = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code
    });
    const shopToken = tokenResp.data.access_token;
    // generate temporary auth code for Alexa
    const authCode = uuidv4();
    authCodes[authCode] = { shop, shopToken, alexaState: meta.state, alexaRedirect: meta.alexa_redirect, alexaClientId: meta.client_id };
    // redirect back to Alexa redirect_uri with code
    const redirectToAlexa = `${meta.alexa_redirect}?code=${authCode}&state=${meta.state}`;
    res.redirect(redirectToAlexa);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error exchanging code with Shopify');
  }
});

// 3) /token - Alexa exchanges the authCode for an access_token
app.post('/token', express.json(), (req, res) => {
  // Alexa sends form-encoded normally; handle both for simplicity
  const body = req.body || req.query || req;
  const { grant_type, code, client_id, client_secret } = body;
  if (grant_type !== 'authorization_code' || !authCodes[code]) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  // Create alexa access token (opaque)
  const alexaToken = 'alexa-at-' + uuidv4();
  const meta = authCodes[code];
  alexaTokens[alexaToken] = { shop: meta.shop, shopToken: meta.shopToken, createdAt: Date.now() };
  // respond to Alexa
  res.json({
    access_token: alexaToken,
    token_type: 'Bearer',
    expires_in: 3600
  });
});

// Useful: endpoint for skill to ask "dame el token de Shopify"
app.get('/_get_shopify_token', (req,res) => {
  const alexaAt = req.header('authorization')?.replace('Bearer ','') || req.query.token;
  if (!alexaAt || !alexaTokens[alexaAt]) return res.status(401).json({error:'unauth'});
  return res.json({ shop: alexaTokens[alexaAt].shop, shopToken: alexaTokens[alexaAt].shopToken });
});

app.listen(process.env.PORT||3000);
