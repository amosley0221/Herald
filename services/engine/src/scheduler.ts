import { Cron } from 'croner';
import type { Preferences } from '@herald/core';
import type { LoadedConfig } from './config.js';
import type { Repository } from './db.js';
import { errorFields, type Logger } from './log.js';
import type { Notifier } from './notify/index.js';
import type { Crawler } from './pipeline/crawl.js';
import type { ReplyTracker } from './pipeline/track.js';

/**
 * The three recurring jobs: the crawl, the morning digest, and the mailbox
 * sweep that moves applications to interview/rejected.
 *
 * The digest is rescheduled whenever the user changes their digest hour or
 * timezone, so a preference change takes effect the same day rather than after
 * a restart.
 */
export class Scheduler {
  private crawlJob: Cron | null = null;
  private digestJob: Cron | null = null;
  private trackJob: Cron | null = null;

  constructor(
    private readonly config: LoadedConfig,
    private readonly repo: Repository,
    private readonly crawler: Crawler,
    private readonly notifier: Notifier,
    private readonly tracker: ReplyTracker,
    private readonly log: Logger,
  ) {}

  start(): void {
    if (!this.config.schedule.enabled) {
      this.log.warn('scheduler disabled by config; no crawls will run on their own');
      return;
    }

    this.crawlJob = new Cron(this.config.schedule.crawlCron, { protect: true }, () => {
      void this.crawler.run().catch((cause) => this.log.error('scheduled crawl failed', errorFields(cause)));
    });
    this.log.info('crawl scheduled', {
      cron: this.config.schedule.crawlCron,
      next: this.crawlJob.nextRun()?.toISOString() ?? null,
    });

    if (this.config.tracking.enabled) {
      this.trackJob = new Cron(this.config.schedule.trackCron, { protect: true }, () => {
        void this.tracker.sweep().catch((cause) => this.log.error('reply sweep failed', errorFields(cause)));
      });
    }

    this.rescheduleDigest();

    if (this.config.schedule.crawlOnBoot) {
      this.log.info('running a crawl on boot');
      void this.crawler.run().catch((cause) => this.log.error('boot crawl failed', errorFields(cause)));
    }
  }

  /**
   * Rebuilds the digest job from the current preferences. Called at startup and
   * every time preferences are saved.
   */
  rescheduleDigest(): void {
    this.digestJob?.stop();
    this.digestJob = null;

    const preferences = this.repo.getPreferences();
    if (!preferences?.digest) {
      this.log.debug('morning digest is off');
      return;
    }

    const hour = clampHour(preferences.digestHour);
    // croner evaluates the expression in the given timezone, so the digest
    // lands at the user's local hour wherever the engine is hosted.
    this.digestJob = new Cron(
      `0 ${hour} * * *`,
      { protect: true, timezone: preferences.timezone || 'UTC' },
      () => { void this.sendDigest(preferences); },
    );
    this.log.info('digest scheduled', {
      hour,
      timezone: preferences.timezone,
      next: this.digestJob.nextRun()?.toISOString() ?? null,
    });
  }

  private async sendDigest(preferences: Preferences): Promise<void> {
    try {
      // Read preferences fresh: the threshold may have moved since the job was
      // scheduled, which changes what belongs in the digest rather than a push.
      const current = this.repo.getPreferences() ?? preferences;
      const pending = this.repo.pendingForDigest(current.threshold, this.config.matching.feedFloor);
      if (pending.length === 0) {
        this.log.info('nothing pending for the digest');
        return;
      }
      await this.notifier.notifyDigest(pending, current);
      this.log.info('digest sent', { count: pending.length });
    } catch (cause) {
      this.log.error('digest failed', errorFields(cause));
    }
  }

  stop(): void {
    this.crawlJob?.stop();
    this.digestJob?.stop();
    this.trackJob?.stop();
    this.crawlJob = this.digestJob = this.trackJob = null;
  }

  /** Next fire times, surfaced on the desktop app's status footer. */
  status(): { nextCrawl: string | null; nextDigest: string | null } {
    return {
      nextCrawl: this.crawlJob?.nextRun()?.toISOString() ?? null,
      nextDigest: this.digestJob?.nextRun()?.toISOString() ?? null,
    };
  }
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 7;
  return Math.min(23, Math.max(0, Math.round(hour)));
}
