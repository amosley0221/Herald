import { strings } from '@herald/core';
import { FcmSender } from './fcm.js';
/** Notification channel ids the Android client registers at startup. */
export const CHANNELS = {
    instant: 'herald-instant',
    digest: 'herald-digest',
    attention: 'herald-attention',
};
/** Categories that map to the notification action buttons on the client. */
export const CATEGORIES = {
    /** Approve · View · Skip */
    match: 'HERALD_MATCH',
    /** Tap only. */
    digest: 'HERALD_DIGEST',
    attention: 'HERALD_ATTENTION',
};
/**
 * Sends the three notifications Herald has: an instant match push, the morning
 * digest, and "finish this one yourself" when a submission hits a wall.
 *
 * Push is optional. With no FCM service account configured the engine logs and
 * carries on — every notification also lands in the Matches feed, so a missing
 * push delays the user, it does not lose them a match.
 */
export class Notifier {
    config;
    repo;
    log;
    fcm;
    constructor(config, repo, log) {
        this.config = config;
        this.repo = repo;
        this.log = log;
        this.fcm = this.createSender();
    }
    get enabled() {
        return this.config.notifications.enabled && this.fcm !== null;
    }
    /** One push per match that cleared the threshold. */
    async notifyInstant(match, preferences) {
        if (!preferences.instant) {
            this.log.debug('instant notifications are off; skipping push', { matchId: match.id });
            return;
        }
        const posting = match.posting;
        await this.broadcast({
            title: `${match.score} · ${posting.title}`,
            body: `${posting.company} · ${posting.location || 'Location not stated'}\n${match.why[0] ?? strings.notification.body}`,
            channelId: CHANNELS.instant,
            actionCategory: CATEGORIES.match,
            collapseKey: `match-${match.id}`,
            data: {
                type: 'match',
                matchId: match.id,
                score: String(match.score),
                role: posting.title,
                company: posting.company,
                location: posting.location,
                // Deep link the Approve action opens straight into the Review screen.
                deepLink: `herald://match/${match.id}`,
            },
        });
        this.repo.markNotified(match.id, 'instant');
    }
    /** One push summarizing everything below the threshold. */
    async notifyDigest(matches, preferences) {
        if (!preferences.digest || matches.length === 0)
            return;
        await this.broadcast({
            title: strings.notification.digestTitle,
            body: strings.notification.digestBody(matches.length),
            channelId: CHANNELS.digest,
            actionCategory: CATEGORIES.digest,
            collapseKey: 'digest',
            data: {
                type: 'digest',
                count: String(matches.length),
                deepLink: 'herald://matches',
            },
        });
        for (const match of matches)
            this.repo.markNotified(match.id, 'digest');
    }
    /** A submission that Herald must not complete on the user's behalf. */
    async notifyNeedsYou(match, reason) {
        await this.broadcast({
            title: strings.notification.needsYou,
            body: strings.notification.needsYouBody(match.posting.company),
            channelId: CHANNELS.attention,
            actionCategory: CATEGORIES.attention,
            collapseKey: `needs-you-${match.id}`,
            data: {
                type: 'needs_you',
                matchId: match.id,
                reason,
                applyUrl: match.posting.applyUrl,
                deepLink: `herald://match/${match.id}`,
            },
        });
    }
    async broadcast(message) {
        if (!this.enabled || !this.fcm) {
            this.log.debug('push disabled; notification not sent', { title: message.title });
            return;
        }
        const devices = this.repo.listDevices().filter((d) => d.platform !== 'desktop');
        if (devices.length === 0) {
            this.log.debug('no registered devices; notification not sent');
            return;
        }
        const results = await this.fcm.sendAll(devices.map((device) => ({ ...message, token: device.token })));
        for (const result of results) {
            // A token FCM has declared dead will never work again; drop it so the
            // device list does not accumulate garbage from reinstalls.
            if (result.unregistered) {
                this.log.info('dropping unregistered device token');
                this.repo.removeDevice(result.token);
            }
        }
    }
    createSender() {
        const { enabled, provider, fcmServiceAccountFile, fcmProjectId } = this.config.notifications;
        if (!enabled || provider !== 'fcm')
            return null;
        if (!fcmServiceAccountFile) {
            this.log.warn('notifications are enabled but no FCM service account is configured');
            return null;
        }
        try {
            return new FcmSender(fcmServiceAccountFile, fcmProjectId, this.log);
        }
        catch (cause) {
            this.log.error('could not initialise FCM; push is disabled', { err: String(cause) });
            return null;
        }
    }
}
//# sourceMappingURL=index.js.map