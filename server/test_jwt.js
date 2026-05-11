const jwt = require('jsonwebtoken');
const secret = 'supersecretjwtkey';

const payload = { userId: 1, username: 'testuser', carType: 'sedan' };
const token = jwt.sign(payload, secret, { expiresIn: '30d' });

console.log('Generated token:', token);

try {
  const decoded = jwt.verify(token, secret);
  console.log('Decoded payload:', decoded);
  console.log('Verification successful!');
} catch (err) {
  console.error('Verification failed:', err.message);
}
