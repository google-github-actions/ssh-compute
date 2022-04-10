const sshpk = require('sshpk');
const crypto = require('crypto');

const sshPrivateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAaAAAABNlY2RzYS
1zaGEyLW5pc3RwMjU2AAAACG5pc3RwMjU2AAAAQQR9WZPeBSvixkhjQOh9yCXXlEx5CN9M
yh94CJJ1rigf8693gc90HmahIR5oMGHwlqMoS7kKrRw+4KpxqsF7LGvxAAAAqJZtgRuWbY
EbAAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBH1Zk94FK+LGSGNA
6H3IJdeUTHkI30zKH3gIknWuKB/zr3eBz3QeZqEhHmgwYfCWoyhLuQqtHD7gqnGqwXssa/
EAAAAgBzKpRmMyXZ4jnSt3ARz0ul6R79AXAr5gQqDAmoFeEKwAAAAOYWpAYm93aWUubG9j
YWwBAg==
-----END OPENSSH PRIVATE KEY-----`;

let correctPrivateKeyData = '';
for (const key of sshPrivateKey.split(/(?=-----BEGIN)/)) {
  correctPrivateKeyData += `${key.trim()}\n`;
}

// Get public key from the private key
const pubKeyObject = crypto.createPublicKey({
  key: sshpk.parsePrivateKey(correctPrivateKeyData, 'ssh').toBuffer('pkcs8').toString(),
  format: 'pem',
});

const publicKey = pubKeyObject.export({
  format: 'pem',
  type: 'spki',
});

console.log(publicKey);