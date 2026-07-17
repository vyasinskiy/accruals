import jwt from 'jsonwebtoken';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ADMIN_USER, ADMIN_PASSWORD, JWT_SECRET } from '../../.env'; // values will be read via process.env

export function signToken(payload: object) {
  return jwt.sign(payload, process.env.JWT_SECRET || JWT_SECRET, { expiresIn: '1h' });
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
    const token = signToken({ username });
    res.setHeader('Set-Cookie', `auth=${token}; HttpOnly; Path=/; Max-Age=3600`);
    return res.status(200).json({ message: 'Logged in' });
  }
  return res.status(401).json({ message: 'Invalid credentials' });
}
