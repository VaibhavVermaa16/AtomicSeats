import http from 'http';
import https from 'https';
import { URL } from 'url';

// Minimal fetch-like function with cookie jar support for Node 18
export class HttpClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.cookieJar = new Map();
    }

    setCookieFromHeader(setCookie) {
        if (!setCookie) return;
        const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (const raw of cookies) {
            const [pair] = raw.split(';');
            const [k, v] = pair.split('=');
            if (k && v) this.cookieJar.set(k.trim(), v.trim());
        }
    }

    getCookieHeader() {
        if (this.cookieJar.size === 0) return undefined;
        return Array.from(this.cookieJar.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    async request(path, { method = 'GET', headers = {}, body } = {}) {
        const url = new URL(
            path.startsWith('http') ? path : `${this.baseUrl}${path}`
        );
        const isHttps = url.protocol === 'https:';
        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
        };
        const cookieHeader = this.getCookieHeader();
        if (cookieHeader) opts.headers['Cookie'] = cookieHeader;

        const agent = isHttps ? https : http;

        const payload = body ? JSON.stringify(body) : undefined;

        const resBody = await new Promise((resolve, reject) => {
            const req = agent.request(url, opts, (res) => {
                this.setCookieFromHeader(res.headers['set-cookie']);
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        text: buf,
                    });
                });
            });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });

        let data;
        try {
            data = resBody.text ? JSON.parse(resBody.text) : undefined;
        } catch {
            data = resBody.text;
        }

        return { status: resBody.status, headers: resBody.headers, data };
    }

    get(path, opts) {
        return this.request(path, { method: 'GET', ...(opts || {}) });
    }
    post(path, body, opts) {
        return this.request(path, { method: 'POST', body, ...(opts || {}) });
    }
}

export function extractAccessToken(apiResponse) {
    // loginUser returns ApiResponse with data: { user, accessToken, refreshToken }
    if (!apiResponse) return undefined;
    const d = apiResponse.data || apiResponse;
    // Some controllers incorrectly place payload in `message`
    if (d && d.data && d.data.accessToken) return d.data.accessToken;
    if (d && d.message && d.message.accessToken) return d.message.accessToken;
    if (d && d.accessToken) return d.accessToken;
    return undefined;
}
