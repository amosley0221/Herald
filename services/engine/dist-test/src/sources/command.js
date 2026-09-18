import { spawn } from 'node:child_process';
import { htmlToText, looksRemote, parsePayText, readPath, stringList, SourceConfigError, } from './types.js';
/**
 * Runs an external aggregator CLI and reads normalized postings from stdout.
 *
 * This is how Herald talks to a tool like Pinloop without taking a dependency
 * on it: the command, its arguments and the shape of its output are all config.
 *
 *   {
 *     "id": "pinloop",
 *     "adapter": "command",
 *     "options": {
 *       "command": "pinloop",
 *       "args": ["search", "--since", "{since}", "--json"],
 *       "format": "ndjson"
 *     },
 *     "fieldMap": { "title": "title", "company": "company", "url": "url" }
 *   }
 *
 * `{since}` and `{sinceEpoch}` are substituted into the arguments. Output is
 * either NDJSON (one posting per line) or a single JSON document, in which case
 * `options.listPath` says where the array lives.
 */
export const commandAdapter = {
    id: 'command',
    async *fetch(source, ctx) {
        const command = source.options.command;
        if (typeof command !== 'string' || !command) {
            throw new SourceConfigError(source.id, 'options.command is required');
        }
        const format = String(source.options.format ?? 'ndjson');
        const timeoutMs = Number(source.options.timeoutMs ?? 300_000);
        const args = stringList(source, 'args').map((arg) => arg
            .replace(/\{since\}/g, ctx.since.toISOString())
            .replace(/\{sinceEpoch\}/g, String(Math.floor(ctx.since.getTime() / 1000))));
        const records = await runCommand(command, args, {
            timeoutMs,
            cwd: typeof source.options.cwd === 'string' ? source.options.cwd : undefined,
            env: source.options.env ?? {},
            signal: ctx.signal,
            format,
            listPath: source.options.listPath,
            log: ctx.log,
        });
        for (const record of records) {
            const posting = toRawPosting(record, source);
            if (!posting)
                continue;
            if (new Date(posting.postedAt) < ctx.since)
                continue;
            yield posting;
        }
    },
};
async function runCommand(command, args, opts) {
    return new Promise((resolve, reject) => {
        // `shell: false` is deliberate: the command and its arguments come from a
        // config file, and running them through a shell would make that config a
        // command-injection surface.
        const child = spawn(command, args, {
            cwd: opts.cwd,
            env: { ...process.env, ...opts.env },
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const records = [];
        let stdout = '';
        let stderr = '';
        let buffer = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
        const onAbort = () => child.kill('SIGTERM');
        opts.signal.addEventListener('abort', onAbort, { once: true });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            if (opts.format === 'ndjson') {
                buffer += chunk;
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    try {
                        records.push(JSON.parse(trimmed));
                    }
                    catch {
                        opts.log.debug('command emitted a non-JSON line', { line: trimmed.slice(0, 120) });
                    }
                }
            }
            else {
                stdout += chunk;
            }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => { stderr += chunk.slice(0, 4096); });
        child.on('error', (cause) => {
            clearTimeout(timer);
            opts.signal.removeEventListener('abort', onAbort);
            reject(new Error(`Could not run "${command}": ${cause.message}`, { cause }));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            opts.signal.removeEventListener('abort', onAbort);
            if (code !== 0) {
                reject(new Error(`"${command}" exited with ${code}: ${stderr.trim().slice(0, 500)}`));
                return;
            }
            if (opts.format === 'ndjson') {
                const tail = buffer.trim();
                if (tail) {
                    try {
                        records.push(JSON.parse(tail));
                    }
                    catch { /* partial final line */ }
                }
                resolve(records);
                return;
            }
            try {
                const parsed = JSON.parse(stdout);
                const list = opts.listPath ? readPath(parsed, opts.listPath) : parsed;
                resolve(Array.isArray(list) ? list : []);
            }
            catch (cause) {
                reject(new Error(`"${command}" did not emit valid JSON`, { cause }));
            }
        });
    });
}
function toRawPosting(record, source) {
    // Without a fieldMap the command is assumed to already emit Herald's shape.
    const map = source.fieldMap ?? {
        id: 'id', title: 'title', company: 'company', location: 'location', remote: 'remote',
        pay: 'pay', payMin: 'payMin', payMax: 'payMax', payCurrency: 'payCurrency',
        url: 'url', applyUrl: 'applyUrl', postedAt: 'postedAt', description: 'description',
    };
    const str = (path) => {
        if (!path)
            return null;
        const value = readPath(record, path);
        return value == null ? null : String(value);
    };
    const num = (path) => {
        if (!path)
            return null;
        const value = readPath(record, path);
        const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    };
    const title = str(map.title);
    const url = str(map.url);
    if (!title || !url)
        return null;
    const postedRaw = str(map.postedAt);
    const postedAt = postedRaw ? new Date(postedRaw) : new Date();
    const descriptionRaw = str(map.description) ?? '';
    const payMin = num(map.payMin);
    const payMax = num(map.payMax);
    const payText = str(map.pay);
    const location = str(map.location) ?? '';
    const remoteRaw = readPath(record, map.remote ?? 'remote');
    return {
        externalId: str(map.id) ?? url,
        title,
        company: str(map.company) ?? source.company ?? source.id,
        location,
        remote: typeof remoteRaw === 'boolean' ? remoteRaw : looksRemote(location, String(remoteRaw ?? ''), title),
        ...(payMin != null || payMax != null
            ? { pay: payText, payMin, payMax, payCurrency: str(map.payCurrency) ?? 'USD' }
            : parsePayText(payText)),
        url,
        applyUrl: str(map.applyUrl) ?? url,
        postedAt: Number.isFinite(postedAt.getTime()) ? postedAt.toISOString() : new Date().toISOString(),
        description: /<[a-z][\s\S]*>/i.test(descriptionRaw) ? htmlToText(descriptionRaw) : descriptionRaw,
        raw: record,
    };
}
//# sourceMappingURL=command.js.map