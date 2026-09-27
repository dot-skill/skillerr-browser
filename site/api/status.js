// What's switched on server-side, so the app can show "coming soon" instead of a dead button.
export default function handler(req, res) {
  res.setHeader('cache-control', 'public, max-age=300');
  res.status(200).json({
    signIn: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SESSION_SECRET),
    pro: !!(process.env.AI_GATEWAY_API_KEY && process.env.LS_STORE_ID),
    price: { monthly: 20, yearly: 192, currency: 'USD' },
  });
}
