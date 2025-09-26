// lambda/index.js (simplified)
const Alexa = require('ask-sdk-core');
const axios = require('axios');

const SHOPIFY_API_VERSION = '2025-07'; // usa la versión que prefieras

async function getShopifyCredentials(alexaToken) {
  // llama a tu bridge para obtener shop + storefront token
  const resp = await axios.get(`https://tu-bridge.example.com/_get_shopify_token`, {
    headers: { Authorization: `Bearer ${alexaToken}` }
  });
  return resp.data; // { shop, shopToken }
}

const AddToCartIntentHandler = {
  canHandle(handlerInput) { return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddToCartIntent'; },
  async handle(handlerInput) {
    const alexaToken = handlerInput.requestEnvelope.context.System.user.accessToken;
    if(!alexaToken) return handlerInput.responseBuilder.speak('Necesitas vincular tu cuenta primero desde la app de Alexa.').withLinkAccountCard().getResponse();

    const { shop, shopToken } = await getShopifyCredentials(alexaToken);
    const productHandle = handlerInput.requestEnvelope.request.intent.slots.product.value;
    const qty = parseInt(handlerInput.requestEnvelope.request.intent.slots.quantity?.value || '1', 10);

    // 1) busca producto y extrae variantId (GraphQL productByHandle)
    const gqlProductQuery = `query productByHandle($handle:String!){ productByHandle(handle:$handle){ id title variants(first:10){ edges{ node{ id price { amount currencyCode } availableForSale quantityAvailable } } } } }`;
    const productResp = await axios.post(`https://${shop}/api/${SHOPIFY_API_VERSION}/graphql.json`, { query: gqlProductQuery, variables: { handle: productHandle }}, { headers: { 'X-Shopify-Storefront-Access-Token': shopToken, 'Content-Type':'application/json' }});
    const variant = productResp.data.data.productByHandle.variants.edges[0].node;
    if(!variant) return handlerInput.responseBuilder.speak('No encontré el producto.').getResponse();
    if(!variant.availableForSale) return handlerInput.responseBuilder.speak(`El producto ${productHandle} no está disponible.`).getResponse();

    // 2) crear cart (cartCreate)
    const cartMutation = `mutation cartCreate($input:CartInput){ cartCreate(input:$input){ cart{ id createdAt lines(first:10){ edges{ node{ id merchandise{ ... on ProductVariant{ id } } quantity } } } checkoutUrl } userErrors{ field message } } }`;
    const cartResp = await axios.post(`https://${shop}/api/${SHOPIFY_API_VERSION}/graphql.json`, { query: cartMutation, variables: { input: { lines: [{ merchandiseId: variant.id, quantity: qty }] } } }, { headers: { 'X-Shopify-Storefront-Access-Token': shopToken, 'Content-Type':'application/json' }});
    const cart = cartResp.data.data.cartCreate.cart;
    const url = cart.checkoutUrl || 'No se obtuvo URL de checkout';
    const speak = `Agregué ${qty} unidad(es) de ${productHandle} al carrito. Puedes completar la compra en: ${url}`;
    return handlerInput.responseBuilder.speak(speak).getResponse();
  }
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(AddToCartIntentHandler, /* otros handlers: Launch, QueryPriceIntent, AvailabilityIntent, etc */)
  .lambda();
