import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Prompt templates live on disk, not in code, so wording can be tuned without
 * rebuilding or redeploying the engine. `{{name}}` placeholders are filled from
 * the variables map; an unknown placeholder is an error rather than a silently
 * empty string, since a half-filled prompt produces confidently wrong scores.
 */
export class PromptLibrary {
    directory;
    cache = new Map();
    constructor(directory) {
        this.directory = directory;
    }
    render(name, variables) {
        const template = this.load(name);
        const missing = [];
        const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
            if (!(key in variables)) {
                missing.push(key);
                return '';
            }
            return String(variables[key]);
        });
        if (missing.length > 0) {
            throw new Error(`Prompt "${name}" expects variables not provided: ${missing.join(', ')}`);
        }
        return rendered;
    }
    load(name) {
        const cached = this.cache.get(name);
        if (cached !== undefined)
            return cached;
        const path = resolve(this.directory, `${name}.md`);
        if (!existsSync(path)) {
            throw new Error(`Prompt template not found: ${path}`);
        }
        const contents = readFileSync(path, 'utf8');
        this.cache.set(name, contents);
        return contents;
    }
    /** Drops cached templates so an edit on disk takes effect on the next crawl. */
    reload() {
        this.cache.clear();
    }
}
//# sourceMappingURL=prompts.js.map