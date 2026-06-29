#!/usr/bin/env node
// tools/generate_keys.js
// ──────────────────────────────────────────────────────────────────────────────
// ONE-TIME SETUP: Generates an RSA key pair for the licensing system.
//
// Usage:   node tools/generate_keys.js
// Output:  tools/private_key.pem  (KEEP SECRET — never distribute)
//          tools/public_key.pem   (embed in licenseValidator.js)
//
// ⚠️  Run this ONCE. If you regenerate keys, all existing licenses become invalid.
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const privateKeyPath = path.join(__dirname, 'private_key.pem');
const publicKeyPath = path.join(__dirname, 'public_key.pem');

// Check if keys already exist
if (fs.existsSync(privateKeyPath)) {
    console.error('⚠️  private_key.pem already exists!');
    console.error('   Delete it first if you want to regenerate (this will invalidate ALL existing licenses).');
    process.exit(1);
}

console.log('🔐 Generating RSA-2048 key pair...');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(privateKeyPath, privateKey);
fs.writeFileSync(publicKeyPath, publicKey);

console.log('');
console.log('✅ Keys generated successfully!');
console.log('');
console.log('📁 Files created:');
console.log(`   Private key: ${privateKeyPath}`);
console.log(`   Public key:  ${publicKeyPath}`);
console.log('');
console.log('🔒 IMPORTANT:');
console.log('   1. NEVER share or distribute private_key.pem');
console.log('   2. Copy the contents of public_key.pem into lib/licenseValidator.js');
console.log('      (replace the REPLACE_WITH_YOUR_PUBLIC_KEY placeholder)');
console.log('   3. Or set the LICENSE_PUBLIC_KEY environment variable');
console.log('');
console.log('📋 Your public key (copy this into licenseValidator.js):');
console.log('─'.repeat(60));
console.log(publicKey.trim());
console.log('─'.repeat(60));
