// axiosInstance.ts
import axios from "axios";

export const BASE_URL = "http://192.168.1.25:8000"; // Replace with your base URL
// const BASE_URL = 'http://localhost:5000'; // Replace with your base URL

const axiosInstance = axios.create({
    baseURL: BASE_URL,
    headers: {
        "Content-Type": "multipart/form-data",
        // Add any other default headers here if needed
    },
});

axiosInstance.interceptors.response.use(
    function (response) {
        return response;
    },
    async function (err) {
        if (err.response && err.response.data) {
            return Promise.reject(err.response.data);
        }
        return Promise.reject(err);
    }
);

export default axiosInstance;
