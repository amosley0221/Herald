import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_PROMPTS, renderPrompt, type PromptName } from '@herald/core';

/**
 * Prompt templates live on disk so wording can be tuned without rebuilding or
 * redeploying the engine. When a file is absent the built-in default from
 * @herald/core is used instead — which is the same text the Android app runs
 * with, so a score computed there was asked the same question as one computed
 * here. A file still wins, so tuning works as before.
 */
export class PromptLibrary {
  private readonly cache = new Map<string, string>();

  constructor(private readonly directory: string) {}

  render(name: string, variables: Record<string, string | number>): string {
    return renderPrompt(this.load(name), variables);
  }

  private load(name: string): string {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;

    const path = resolve(this.directory, `${name}.md`);
    const contents = existsSync(path)
      ? readFileSync(path, 'utf8')
      : DEFAULT_PROMPTS[name as PromptName];

    if (contents === undefined) {
      throw new Error(
        `Prompt template not found at ${path}, and "${name}" has no built-in default.`,
      );
    }
    this.cache.set(name, contents);
    return contents;
  }

  /** Drops cached templates so an edit on disk takes effect on the next crawl. */
  reload(): void {
    this.cache.clear();
  }
}
