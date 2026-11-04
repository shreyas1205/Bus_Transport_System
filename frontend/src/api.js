import axios from 'axios';
import { readAuthToken } from './authStorage';

export const API_URL =
  import.meta.env.VITE_API_URL ||
  '/api';

export const api = axios.create({
  baseURL: API_URL
});

api.interceptors.request.use(
  config => {
    const token =
      readAuthToken();

    if (token) {
      config.headers.Authorization =
        `Bearer ${token}`;
    }

    return config;
  },
  error => Promise.reject(error)
);
