import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { canTransition } from '@herald/core';
import { errorFields } from '../log.js';
import { FormBrowser, ManualInterventionRequired } from './browser.js';
import { fallbackFields, loadFieldRules, mapFields } from './form.js';
export class ApplyError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'ApplyError';
    }
}
/** Cover letters are capped so they stay readable on the Review screen. */
const COVER_LETTER_MAX_WORDS = 180;
/**
 * Approve and Submit.
 *
 * These are two deliberately separate steps. Approve only *prepares* — it reads
 * the form, fills what it can, and writes a cover letter. Nothing is sent.
 * Submit is the only method that touches the target site's submit button, and
 * it runs solely in response to an explicit tap on the Review screen.
 */
export class ApplyService {
    config;
    repo;
    llm;
    prompts;
    notifier;
    log;
    rules;
    browser;
    constructor(config, repo, llm, prompts, notifier, log) {
        this.config = config;
        this.repo = repo;
        this.llm = llm;
        this.prompts = prompts;
        this.notifier = notifier;
        this.log = log;
        this.rules = loadFieldRules(config.paths.fieldRules);
        this.browser = new FormBrowser(config, log);
        mkdirSync(config.paths.screenshots, { recursive: true });
    }
    async close() {
        await this.browser.close();
    }
    /**
     * Prepares an approved application and returns it for review.
     *
     * Idempotent: approving twice returns the stored preparation rather than
     * paying for a second cover letter.
     */
    async approve(matchId) {
        const match = this.repo.getMatch(matchId);
        if (!match)
            throw new ApplyError(`No match with id ${matchId}`, 'not_found');
        const existing = this.repo.getPrepared(matchId);
        if (existing && match.status !== 'pending') {
            return { matchId, ...existing, fields: existing.fields };
        }
        if (match.status !== 'pending' && !existing) {
            throw new ApplyError(`Match is ${match.status}; only a pending match can be approved`, 'bad_status');
        }
        const stored = this.repo.getProfile();
        if (!stored)
            throw new ApplyError('No resume has been uploaded yet', 'no_profile');
        const preferences = this.repo.getPreferences();
        const log = this.log.child({ matchId, company: match.posting.company });
        const manualReason = this.manualOnlyReason(match);
        const coverLetter = preferences?.tailorLetter
            ? await this.writeCoverLetter(match, stored.profile, log)
            : null;
        let fields;
        let degraded = false;
        if (manualReason || !this.config.apply.enabled) {
            fields = fallbackFields(this.rules, {
                profile: stored.profile,
                coverLetter,
                resumeFileName: stored.profile.resumeFileName,
            });
            degraded = true;
        }
        else {
            try {
                const discovered = await this.browser.discover(match.posting.applyUrl);
                fields = mapFields(discovered, this.rules, {
                    profile: stored.profile,
                    coverLetter,
                    resumeFileName: stored.profile.resumeFileName,
                });
                if (fields.length === 0) {
                    // A form we cannot read is not a form we should pretend to have read.
                    fields = fallbackFields(this.rules, { profile: stored.profile, coverLetter, resumeFileName: stored.profile.resumeFileName });
                    degraded = true;
                }
            }
            catch (cause) {
                log.warn('could not read the apply form', errorFields(cause));
                fields = fallbackFields(this.rules, { profile: stored.profile, coverLetter, resumeFileName: stored.profile.resumeFileName });
                degraded = true;
            }
        }
        const prepared = {
            fields,
            coverLetter,
            degraded,
            manualOnly: manualReason != null,
            manualReason,
            preparedAt: new Date().toISOString(),
        };
        this.repo.savePrepared(matchId, prepared);
        if (match.status === 'pending') {
            if (!canTransition(match.status, 'approved')) {
                throw new ApplyError(`Cannot approve a match that is ${match.status}`, 'bad_status');
            }
            this.repo.updateMatchStatus(matchId, 'approved', { decidedAt: new Date().toISOString() });
        }
        this.repo.appendLog({
            matchId,
            at: prepared.preparedAt,
            action: 'prepared',
            detail: manualReason ?? (degraded ? 'Form could not be read; filled from profile.' : null),
            payload: Object.fromEntries(fields.map((f) => [f.key, f.value])),
        });
        return { matchId, ...prepared, fields: stripSelectors(fields) };
    }
    /**
     * Submits a reviewed application.
     *
     * `overrides` carries any edits the user made on the Review screen, so what
     * goes to the target site is exactly what they saw.
     */
    async submit(matchId, overrides) {
        const match = this.repo.getMatch(matchId);
        if (!match)
            throw new ApplyError(`No match with id ${matchId}`, 'not_found');
        if (!canTransition(match.status, 'applied')) {
            throw new ApplyError(`Cannot submit a match that is ${match.status}`, 'bad_status');
        }
        const prepared = this.repo.getPrepared(matchId);
        if (!prepared)
            throw new ApplyError('Approve the match before submitting it', 'not_prepared');
        const preferences = this.repo.getPreferences();
        const cap = preferences?.dailySubmitCap ?? 15;
        const submittedToday = this.repo.submissionsSince(startOfLocalDay(preferences?.timezone));
        if (submittedToday >= cap) {
            throw new ApplyError(`Daily submission cap of ${cap} has been reached`, 'cap_reached');
        }
        const stored = this.repo.getProfile();
        const log = this.log.child({ matchId, company: match.posting.company });
        const fields = prepared.fields.map((field) => ({
            ...field,
            value: overrides?.fields?.[field.key] ?? field.value,
        }));
        const auditPayload = Object.fromEntries(fields.map((f) => [f.key, f.value]));
        if (prepared.manualOnly) {
            return this.routeToUser(match, prepared.manualReason ?? 'This source must be completed by hand.', auditPayload);
        }
        if (!this.config.apply.enabled) {
            return this.routeToUser(match, 'Automated submission is switched off in the engine config.', auditPayload);
        }
        const screenshotPath = this.config.apply.screenshotConfirmations
            ? resolve(this.config.paths.screenshots, `${matchId}-${randomUUID().slice(0, 8)}.png`)
            : null;
        try {
            const { confirmationImage } = await this.browser.submit(match.posting.applyUrl, fields, stored?.resumePath ?? null, screenshotPath);
            const submittedAt = new Date().toISOString();
            this.repo.updateMatchStatus(matchId, 'applied', {
                submittedAt,
                ...(confirmationImage ? { confirmationImage } : {}),
                blockedReason: null,
            });
            this.repo.appendLog({
                matchId, at: submittedAt, action: 'submitted',
                detail: confirmationImage ? 'Confirmation captured.' : null,
                payload: auditPayload,
            });
            log.info('application submitted');
            return this.repo.getMatch(matchId);
        }
        catch (cause) {
            if (cause instanceof ManualInterventionRequired) {
                return this.routeToUser(match, cause.reason, auditPayload);
            }
            const detail = cause instanceof Error ? cause.message : String(cause);
            log.error('submission failed', errorFields(cause));
            this.repo.appendLog({ matchId, at: new Date().toISOString(), action: 'failed', detail, payload: auditPayload });
            throw new ApplyError(`Submission failed: ${detail}`, 'submit_failed');
        }
    }
    skip(matchId) {
        const match = this.repo.getMatch(matchId);
        if (!match)
            throw new ApplyError(`No match with id ${matchId}`, 'not_found');
        if (!canTransition(match.status, 'skipped')) {
            throw new ApplyError(`Cannot skip a match that is ${match.status}`, 'bad_status');
        }
        const at = new Date().toISOString();
        this.repo.updateMatchStatus(matchId, 'skipped', { decidedAt: at });
        this.repo.appendLog({ matchId, at, action: 'skipped', detail: null, payload: null });
        return this.repo.getMatch(matchId);
    }
    // ── internals ────────────────────────────────────────────────────────────
    /** Marks a match as the user's to finish and pushes to tell them so. */
    async routeToUser(match, reason, payload) {
        const at = new Date().toISOString();
        this.repo.updateMatchStatus(match.id, 'needs_you', { blockedReason: reason });
        this.repo.appendLog({ matchId: match.id, at, action: 'needs_you', detail: reason, payload });
        await this.notifier.notifyNeedsYou(match, reason).catch((cause) => {
            this.log.warn('needs-you push failed', errorFields(cause));
        });
        return this.repo.getMatch(match.id);
    }
    /**
     * Hosts listed in `apply.manualOnlyHosts` are never automated. LinkedIn is
     * there by default because Easy Apply automation violates their terms.
     */
    manualOnlyReason(match) {
        let host;
        try {
            host = new URL(match.posting.applyUrl).hostname.toLowerCase();
        }
        catch {
            return 'The posting does not have a usable application URL.';
        }
        const blocked = this.config.apply.manualOnlyHosts.some((entry) => host === entry.toLowerCase() || host.endsWith(`.${entry.toLowerCase()}`));
        return blocked
            ? `${host} is on the manual-only list, so Herald will not submit here on your behalf.`
            : null;
    }
    async writeCoverLetter(match, profile, log) {
        if (!this.llm.available)
            return null;
        try {
            const prompt = this.prompts.render('cover-letter', {
                profile: describeProfile(profile),
                title: match.posting.title,
                company: match.posting.company,
                location: match.posting.location || 'not stated',
                description: match.posting.description.slice(0, 6_000),
                topReason: match.why[0] ?? 'Your background lines up with what this role asks for.',
                maxWords: COVER_LETTER_MAX_WORDS,
            });
            const letter = await this.llm.complete({
                model: this.config.llm.writeModel,
                prompt,
                maxTokens: 800,
                temperature: 0.4,
            });
            return letter.trim() || null;
        }
        catch (cause) {
            // A missing letter is recoverable — the user can still review and submit.
            log.warn('cover letter generation failed', errorFields(cause));
            return null;
        }
    }
}
function describeProfile(profile) {
    const lines = [
        profile.fullName && `Name: ${profile.fullName}`,
        profile.location && `Location: ${profile.location}`,
        profile.years != null && `Years of experience: ${profile.years}`,
        profile.titles.length > 0 && `Titles held: ${profile.titles.join(', ')}`,
        profile.skills.length > 0 && `Skills: ${profile.skills.join(', ')}`,
        profile.summary && `Summary: ${profile.summary}`,
    ].filter((line) => typeof line === 'string');
    return lines.join('\n');
}
/** The Review screen has no use for CSS selectors; keep them server-side. */
function stripSelectors(fields) {
    return fields.map(({ selector, skipped, ...field }) => field);
}
/** Midnight in the user's zone, as an ISO instant, for the daily cap window. */
export function startOfLocalDay(timeZone, now = new Date()) {
    if (!timeZone) {
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        return midnight.toISOString();
    }
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(now);
    const pick = (type) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    // Subtract the local wall-clock time from now to land on local midnight.
    const elapsedMs = (pick('hour') * 3600 + pick('minute') * 60 + pick('second')) * 1000;
    return new Date(now.getTime() - elapsedMs).toISOString();
}
//# sourceMappingURL=apply.js.map