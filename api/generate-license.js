const crypto = require('crypto');
const { Pool } = require('pg');

// Setup DB connection
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool = null;
if (DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      ssl: { rejectUnauthorized: false }
    });
  } catch (error) {
    console.error('Failed to initialize PostgreSQL pool:', error);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, pump } = req.body;

  if (!id || !pump) {
    return res.status(400).json({ error: 'Hardware ID and Pump name are required' });
  }

  const privateKey = process.env.LICENSE_SECRET_KEY;
  if (!privateKey) {
    return res.status(500).json({ error: 'Server configuration error: Missing private key' });
  }

  let licenseKeyStr = '';

  try {
    const exp = '2099-12-31';
    const payloadObject = {
        hwid: id,
        pump: pump,
        exp: exp,
        features: ['pos', 'shifts', 'tanks', 'forwarding'],
        issued: new Date().toISOString(),
    };
    
    const payloadString = JSON.stringify(payloadObject);
    const signature = crypto.sign('sha256', Buffer.from(payloadString), privateKey);

    const licenseData = {
        payload: Buffer.from(payloadString).toString('base64'),
        signature: signature.toString('base64'),
    };
    
    licenseKeyStr = JSON.stringify(licenseData, null, 2);
  } catch (error) {
    console.error('License generation error:', error);
    return res.status(500).json({ error: 'Failed to generate license (Invalid Private Key format?)' });
  }

  // Store in database
  if (pool) {
    let client;
    try {
      client = await pool.connect();
      
      // Ensure table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS generated_licenses (
          id SERIAL PRIMARY KEY,
          pump_name VARCHAR(255) NOT NULL,
          hardware_id VARCHAR(255) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Insert record
      await client.query(
        'INSERT INTO generated_licenses (pump_name, hardware_id) VALUES ($1, $2)',
        [pump, id]
      );
    } catch (dbError) {
      console.error('Database insertion error:', dbError);
      // We don't fail the license generation if DB logging fails, just log it.
    } finally {
      if (client) client.release();
    }
  }

  return res.status(200).json({ licenseKey: licenseKeyStr });
};
