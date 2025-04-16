// src/services/apiClient.js
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const BASE_URL = process.env.REACT_APP_API_BASE_URL;

const apiClient = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

export const setupInterceptors = (navigate) => {
    apiClient.interceptors.response.use(
        response => response,
        error => {
            if (error.response && error.response.status === 401) {
                localStorage.clear();
                sessionStorage.clear();
                navigate('/');
            }
            return Promise.reject(error);
        }
    );
};

export default apiClient;