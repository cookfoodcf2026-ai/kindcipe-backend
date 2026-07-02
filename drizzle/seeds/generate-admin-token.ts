import 'dotenv/config';
import * as jose from 'jose';

const JWT_SECRET = process.env.JWT_SECRET!;
const APP_ID = 'kindcipe';
const ADMIN_OPEN_ID = 'email_aaa2604e269063952d78e7cb070e2552'; // mavis2@gmail.com

const secretKey = new TextEncoder().encode(JWT_SECRET);

const token = await new jose.SignJWT({
  openId: ADMIN_OPEN_ID,
  appId: APP_ID,
  name: 'Admin',
})
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setExpirationTime(Math.floor((Date.now() + 86400000) / 1000)) // 24h
  .setIssuedAt()
  .sign(secretKey);

console.log(token);
