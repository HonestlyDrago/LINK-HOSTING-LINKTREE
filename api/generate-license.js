const crypto = require('crypto');

module.exports = async (req, res) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, pump } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Hardware ID is required' });
  }

  if (!pump) {
    return res.status(400).json({ error: 'Pump name is required' });
  }

  // Retrieve your RSA private key from Vercel Environment Variables
  // (This should be the exact contents of your tools/private_key.pem)
  const privateKey = process.env.LICENSE_SECRET_KEY;
  if (!privateKey) {
    return res.status(500).json({ error: 'Server configuration error: Missing private key' });
  }

  try {
    // Generate the license payload exactly like tools/generate_license.js does
    const exp = '2099-12-31'; // Default lifetime expiry
    const payloadObject = {
        hwid: id,
        pump: pump,
        exp: exp,
        features: ['pos', 'shifts', 'tanks', 'forwarding'],
        issued: new Date().toISOString(),
    };
    
    const payloadString = JSON.stringify(payloadObject);

    // Sign the payload using RSA and the private key
    const signature = crypto.sign('sha256', Buffer.from(payloadString), privateKey);

    // Build the final license format
    const licenseData = {
        payload: Buffer.from(payloadString).toString('base64'),
        signature: signature.toString('base64'),
    };
    
    // We send back the JSON string representation of the license, 
    // formatted exactly like the file content it would generate locally.
    const licenseKey = JSON.stringify(licenseData, null, 2);
    
    return res.status(200).json({ licenseKey });
  } catch (error) {
    console.error('License generation error:', error);
    return res.status(500).json({ error: 'Failed to generate license (Invalid Private Key format?)' });
  }
};
