import { HttpClient } from './httpClient.js';
import { BASE_URL, WAIT_INTERVAL_MS, WAIT_TIMEOUT_MS } from './config.js';

export async function waitForHealth() {
    const start = Date.now();
    const client = new HttpClient(BASE_URL);
    while (Date.now() - start < WAIT_TIMEOUT_MS) {
        try {
            const res = await client.get('/health');
            if (res.status === 200) return true;
        } catch {}
        await new Promise((r) => setTimeout(r, WAIT_INTERVAL_MS));
    }
    throw new Error(`Timed out waiting for ${BASE_URL}/health`);
}
