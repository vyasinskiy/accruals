import axios from 'axios';

const WATCHER_API_URL = process.env.WATCHER_API_URL || 'http://127.0.0.1:4500';

export const watcherClient = axios.create({
  baseURL: WATCHER_API_URL,
});
