import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * First-run setup.
 *
 * Creates `herald.config.json` from the example, generates the bearer token the
 * apps authenticate with, and prints what still needs filling in. Safe to run
 * twice: an existing config keeps its token.
 */
function main() {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const target = process.env.HERALD_CONFIG ?? resolve(process.cwd(), 'herald.config.json');
    const example = resolve(packageRoot, 'herald.config.example.json');
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target)) {
        if (!existsSync(example)) {
            console.error(`Cannot find the example config at ${example}`);
            process.exit(1);
        }
        copyFileSync(example, target);
        console.log(`Created ${target}`);
    }
    else {
        console.log(`Using the existing ${target}`);
    }
    const config = JSON.parse(readFileSync(target, 'utf8'));
    const auth = (config.auth ?? {});
    if (!auth.token) {
        // 32 bytes of base64url: long enough that brute force is not a concern for
        // a single-user service exposed to the internet.
        auth.token = randomBytes(32).toString('base64url');
        config.auth = auth;
        writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        console.log('Generated an access token.');
    }
    else {
        console.log('An access token is already set; leaving it alone.');
    }
    const dataDir = resolve(dirname(target), (config.storage?.dataDir ?? './data'));
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(resolve(dataDir, 'resumes'), { recursive: true });
    mkdirSync(resolve(dataDir, 'screenshots'), { recursive: true });
    const sources = config.sources ?? [];
    console.log(`
Herald engine is configured.

  Config      ${target}
  Data        ${dataDir}
  Token       ${auth.token}

Still to do:

  1. Set ANTHROPIC_API_KEY in the environment (or a .env file).
     Without it the engine ingests postings but never scores them.

  2. Edit "sources" in the config — it currently lists ${sources.length}.
     Replace the example board slugs and Workday tenants with the companies
     you want watched. The "json" and "command" adapters cover anything the
     named adapters do not.

  3. Start the engine:  npm run start -w @herald/engine

  4. Open the desktop app, paste the token above, and upload your resume.
     The phone pairs by scanning the QR code the desktop app shows.

Keep the token secret: it is the only thing standing between the internet and
your resume.
`);
}
main();
//# sourceMappingURL=init.js.map