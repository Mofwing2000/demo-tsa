import axios from 'axios';

const pluginAxios = axios.create({
  baseURL: import.meta.env.VITE_APP_ESIGN_PLUGIN_URL || 'http://localhost:54321/usb',
});

async function getUSBAliases(): Promise<string[]> {
  const response = await pluginAxios.get('/usb-aliases');
  return response.data;
}

// async function getCertificates(alias: string ) {
//   const formData = new Form
//     const response = await pluginAxios.get(`/get-certificates&alias=${encodeURIComponent(alias)}`);
//   return response.data;
// }


export async function signMessage(alias: string, message: string): Promise<string> {
  const credentials = JSON.stringify({ alias });
  const form = new FormData();
  form.append('credentials', credentials);
  form.append('messageBase64', message);
  const response = await pluginAxios.post('/sign-message', form)
  return response.data;
}

export default function useSign() {
  return ({
    getUSBAliases,
    // getCertificates,
    signMessage
  })
}