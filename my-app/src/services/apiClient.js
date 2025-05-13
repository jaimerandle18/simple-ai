// src/services/apiClient.js
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

//fake api https://lzqogg674ftg74ippdjunnhvdy0nbjyr.lambda-url.us-east-1.on.aws/
//real api https://6wqwjnilkygbweybic5ywpqmse0akwlt.lambda-url.us-east-1.on.aws/

const BASE_URL = 'https://lzqogg674ftg74ippdjunnhvdy0nbjyr.lambda-url.us-east-1.on.aws/';

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
                // Si la respuesta es un 401, limpia los storage y redirige al login
                localStorage.clear();
                sessionStorage.clear();
                navigate('/'); // Redirige al login
            }
            return Promise.reject(error);
        }
    );
};

export default apiClient;
