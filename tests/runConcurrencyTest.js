#!/usr/bin/env node
import readline from 'readline';
import { HttpClient, extractAccessToken } from './httpClient.js';
import { waitForHealth } from './waitFor.js';
import {
    BASE_URL,
    CONCURRENCY,
    SEATS_PER_BOOKING,
    EVENT_CAPACITY,
    EVENT_PRICE,
} from './config.js';

function ask(question, { silent = false } = {}) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    if (silent) {
        // hide input by muting output
        rl.output.write('\x1B[2K\x1B[200D');
        rl.output.mute = true;
        rl._writeToOutput = (stringToWrite) => {
            if (rl.output.mute) return;
            rl.output.write(stringToWrite);
        };
    }
    return new Promise((resolve) =>
        rl.question(question, (ans) => {
            rl.close();
            resolve(ans);
        })
    );
}

async function main() {
    console.log('Waiting for app to be healthy...');
    await waitForHealth();
    console.log(`Target: ${BASE_URL}`);

    const email = await ask('Enter registered email: ');
    const password = await ask('Enter password: ');

    const client = new HttpClient(BASE_URL);

    // Login
    const loginRes = await client.post('/api/user/login', { email, password });
    if (loginRes.status !== 200) {
        console.error('Login failed:', loginRes.data);
        process.exit(1);
    }
    const token = extractAccessToken(loginRes);
    console.log('Login OK. Access token acquired.');

    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

    // Create an event
    const now = Date.now();
    const startsAt = new Date(now + 5 * 60 * 1000).toISOString();
    const endsAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    const createRes = await client.post(
        '/api/events/create',
        {
            name: `Concurrency Test Event ${new Date().toISOString()}`,
            description: 'Auto-created for concurrency test',
            startsAt,
            endsAt,
            venue: 'Test Venue',
            capacity: EVENT_CAPACITY,
            price: EVENT_PRICE,
        },
        { headers: authHeaders }
    );
    if (createRes.status !== 201) {
        console.error('Create event failed:', createRes.data);
        process.exit(1);
    }
    const newEvent =
        createRes.data?.message;
    const eventId = newEvent?.event_id;

    if (!eventId) {
        console.error(
            'Could not determine new event id from response:',
            createRes.data
        );
        process.exit(1);
    }
    console.log(
        `Event created. ID=${eventId}, capacity=${EVENT_CAPACITY}, price=${EVENT_PRICE}`
    );

    // Fire concurrent bookings
    console.log(
        `Running concurrency test with ${CONCURRENCY} parallel bookings, ${SEATS_PER_BOOKING} seats each...`
    );
    const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, async (_, i) => {
            const r = await client.post(
                '/api/events/book',
                { eventId: Number(eventId), numberOfSeats: SEATS_PER_BOOKING },
                { headers: authHeaders }
            );
            return { idx: i, status: r.status, body: r.data };
        })
    );

    // Summarize
    const fulfilled = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);
    const rejected = results.filter((r) => r.status === 'rejected');
    const ok = fulfilled.filter((r) => r.status >= 200 && r.status < 300);
    const bad = fulfilled.filter((r) => r.status >= 400);

    console.log('\n=== Concurrency Test Summary ===');
    console.log(`Requests attempted: ${results.length}`);
    console.log(`Success responses: ${ok.length}`);
    console.log(`Error responses:   ${bad.length}`);
    console.log(`Rejected requests: ${rejected.length}`);

    if (bad.length) {
        const samples = bad.slice(0, 3);
        console.log('\nSample error responses:');
        for (const s of samples)
            console.log(`- [${s.status}]`, s.body?.message || s.body);
    }

    console.log(
        '\nNote: Bookings are queued to Kafka and processed asynchronously; check the worker logs for final seat allocations.'
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
