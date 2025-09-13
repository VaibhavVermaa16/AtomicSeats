#!/usr/bin/env node
import { HttpClient, extractAccessToken } from './httpClient.js';
import { waitForHealth } from './waitFor.js';
import { BASE_URL } from './config.js';

async function main() {
    await waitForHealth();
    const client = new HttpClient(BASE_URL);
    // Expect env-provided credentials for quick smoke run
    const email = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;
    if (!email || !password) {
        console.error('Set TEST_EMAIL and TEST_PASSWORD to run this example.');
        process.exit(1);
    }
    const login = await client.post('/api/user/login', { email, password });
    if (login.status !== 200) {
        console.error('Login failed:', login.data);
        process.exit(1);
    }
    const token = extractAccessToken(login);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const hist = await client.get('/api/user/bookings?limit=10&view=tickets', {
        headers,
    });
    console.log('Status:', hist.status);
    console.log(JSON.stringify(hist.data, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
