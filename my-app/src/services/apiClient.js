// src/services/apiClient.js
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../constants';

const apiClient = axios.create({
    baseURL: API_BASE_URL,
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