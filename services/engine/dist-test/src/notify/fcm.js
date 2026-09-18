import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/**
 * Firebase Cloud Messaging over the HTTP v1 API.
 *
 * Implemented directly against the REST endpoint rather than pulling in
 * firebase-admin: the engine needs exactly one call, and a self-signed JWT
 * exchanged for an access token is the whole of the auth flow.
 */
export class FcmSender {
    log;
    account;
    projectId;
    accessToken = null;
    constructor(serviceAccountFile, projectIdOverride, log) {
        this.log = log;
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(serviceAccountFile, 'utf8'));
        }
        catch (cause) {
            throw new Error(`Could not read the FCM service account at ${serviceAccountFile}`, { cause });
        }
        for (const key of ['project_id', 'client_email', 'private_key']) {
            if (!parsed[key])
                throw new Error(`FCM service account is missing "${key}"`);
        }
        this.account = parsed;
        this.projectId = projectIdOverride ?? parsed.project_id;
    }
    async send(message) {
        const accessToken = await this.getAccessToken();
        const endpoint = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
        const payload = {
            message: {
                token: message.token,
                notification: { title: message.title, body: message.body },
                data: message.data ?? {},
                android: {
                    priority: 'HIGH',
                    ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}),
                    notification: {
                        ...(message.channelId ? { channel_id: message.channelId } : {}),
                        ...(message.actionCategory ? { click_action: message.actionCategory } : {}),
                        // Herald's palette, so the status-bar icon tints gold.
                        color: '#C6A75E',
                    },
                },
            },
        };
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (res.ok)
            return { token: message.token, ok: true, unregistered: false };
        const text = await res.text();
        // 404 UNREGISTERED and 400 INVALID_ARGUMENT on the token mean the install is
        // gone; the caller drops it rather than retrying forever.
        const unregistered = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text);
        this.log.warn('FCM send failed', { status: res.status, unregistered, body: text.slice(0, 300) });
        return { token: message.token, ok: false, unregistered, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    async sendAll(messages) {
        return Promise.all(messages.map((message) => this.send(message)));
    }
    /** Exchanges a self-signed JWT for an OAuth access token, cached until expiry. */
    async getAccessToken() {
        const now = Math.floor(Date.now() / 1000);
        if (this.accessToken && this.accessToken.expiresAt > now + 60)
            return this.accessToken.value;
        const tokenUri = this.account.token_uri ?? DEFAULT_TOKEN_URI;
        const claims = {
            iss: this.account.client_email,
            scope: SCOPE,
            aud: tokenUri,
            iat: now,
            exp: now + 3600,
        };
        const jwt = signJwt(claims, this.account.private_key);
        const res = await fetch(tokenUri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt,
            }),
        });
        if (!res.ok) {
            throw new Error(`FCM token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
        const body = (await res.json());
        this.accessToken = { value: body.access_token, expiresAt: now + body.expires_in };
        return body.access_token;
    }
}
function signJwt(claims, privateKey) {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify(claims));
    const signingInput = `${header}.${payload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    // Service-account keys arrive with literal "\n" when they come from an env
    // var rather than a file, so normalize before handing them to crypto.
    const signature = signer.sign(privateKey.replace(/\\n/g, '\n'));
    return `${signingInput}.${base64urlBuffer(signature)}`;
}
function base64url(input) {
    return base64urlBuffer(Buffer.from(input, 'utf8'));
}
function base64urlBuffer(buffer) {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
//# sourceMappingURL=fcm.js.map