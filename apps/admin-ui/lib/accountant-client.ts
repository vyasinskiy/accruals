import axios from 'axios';

const ACCOUNTANT_API_URL = process.env.ACCOUNTANT_API_URL || 'http://localhost:3005';

export const accountantClient = axios.create({
  baseURL: `${ACCOUNTANT_API_URL}/accountant`,
});
