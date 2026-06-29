#!/usr/bin/env node
// tools/generate_license.js
// ──────────────────────────────────────────────────────────────────────────────
// YOUR PRIVATE TOOL — Never distribute this file.
//
// Generates a LICENSE.key file for a specific pump computer.
//
// Usage:
//   node tools/generate_license.js --hwid <HARDWARE_ID> --pump PUMP-001 --exp 2027-12-31
//
// Example:
//   node tools/generate_license.js --hwid abc123def456... --pump PUMP-001 --exp 2027-12-31
//
// Output: LICENSE.key (in current directory)
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const hwid = getArg('hwid');
const pump = getArg('pump') || 'PUMP-001';
const exp = getArg('exp') || getDefaultExpiry();
const outputPath = getArg('output') || path.join(process.cwd(), 'LICENSE.key');

function getDefaultExpiry() {
    return '2099-12-31'; // Lifetime license
}

if (!hwid) {
    console.error('Usage: node generate_license.js --hwid <HARDWARE_ID> [--pump PUMP-001] [--exp 2027-12-31]');
    console.error('');
    console.error('  --hwid   Required. The hardware fingerprint from the target machine.');
    console.error('  --pump   Optional. Pump station identifier (default: PUMP-001).');
    console.error('  --exp    Optional. Expiry date YYYY-MM-DD (default: 1 year from now).');
    console.error('  --output Optional. Output file path (default: ./LICENSE.key).');
    process.exit(1);
}

// Load private key
const privateKeyPath = path.join(__dirname, 'private_key.pem');
if (!fs.existsSync(privateKeyPath)) {
    console.error('❌ private_key.pem not found in tools/ directory.');
    console.error('   Run "node tools/generate_keys.js" first to create your key pair.');
    process.exit(1);
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

// Build license payload
const payload = JSON.stringify({
    hwid,
    pump,
    exp,
    features: ['pos', 'shifts', 'tanks', 'forwarding'],
    issued: new Date().toISOString(),
});

// Sign the payload
const signature = crypto.sign('sha256', Buffer.from(payload), privateKey);

// Build the license file
const license = JSON.stringify({
    payload: Buffer.from(payload).toString('base64'),
    signature: signature.toString('base64'),
}, null, 2);

// Write to file
fs.writeFileSync(outputPath, license);

console.log('');
console.log('✅ License generated successfully!');
console.log('');
console.log('📋 License Details:');
console.log(`   Pump:     ${pump}`);
console.log(`   HWID:     ${hwid.substring(0, 16)}...`);
console.log(`   Expires:  ${exp}`);
console.log(`   Features: pos, shifts, tanks, forwarding`);
console.log(`   Issued:   ${new Date().toISOString()}`);
console.log('');
console.log(`📁 File: ${outputPath}`);
console.log('');
console.log('📦 Send this LICENSE.key file to the pump technician.');
console.log('   They should place it in C:\\FuelPOS\\ on the pump computer.');
