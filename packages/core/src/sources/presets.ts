import { defineSource, type SourceConfig } from './types.js';

/**
 * Job sources that are not a single company.
 *
 * Herald started with company boards, which answer one question well: what has
 * this employer posted? They are no good at the question most people actually
 * have, which is what has *anyone* posted. These are the sources that answer
 * that one, and every one of them is a `json` source -- a definition, not code.
 *
 * Nothing here scrapes. Indeed and LinkedIn are absent on purpose: neither has
 * a public search API any more, both forbid scraping in their terms, and both
 * defend against it well enough that a scraper would break within weeks and
 * fail by returning nothing, which is indistinguishable from a quiet day. A
 * source that lies about having found nothing is worse than no source.
 *
 * WHAT IS AND IS NOT VERIFIED. The `{query}` plumbing and the field mapping are
 * covered by tests against recorded payloads. The live response shapes are not:
 * they belong to services that can change them, and the build environment
 * cannot reach any of these hosts. So every preset is checkable from the app --
 * `testSource` fetches one and shows the first posting as Herald read it, which
 * turns "I hope this mapping is right" into something answerable in a tap.
 */

/** A source the user can turn on, and what they have to supply first. */
export interface SourcePreset {
  /** Stable id; also the source id once enabled. */
  id: string;
  name: string;
  /** One line on what it covers, shown under the name. */
  covers: string;
  /** Credentials the user must paste in, keyed by the option they fill. */
  credentials?: Array<{ option: string; label: string; help: string; signupUrl: string }>;
  /** Where to read about it, for the ones that need an account. */
  signupUrl?: string;
  /** True when it searches on the user's roles rather than listing everything. */
  searches: boolean;
  build(): SourceConfig;
}

export const SOURCE_PRESETS: SourcePreset[] = [
  {
    id: 'adzuna',
    name: 'Adzuna',
    covers: 'Aggregates across employers and boards nationwide, searched on your roles and location. The closest thing to the everything-everywhere search.',
    searches: true,
    signupUrl: 'https://developer.adzuna.com/signup',
    credentials: [
      {
        option: 'appId',
        label: 'App ID',
        help: 'From developer.adzuna.com once you register — free, no card.',
        signupUrl: 'https://developer.adzuna.com/signup',
      },
      {
        option: 'appKey',
        label: 'App key',
        help: 'Shown beside the App ID on the same page.',
        signupUrl: 'https://developer.adzuna.com/signup',
      },
    ],
    build: () => defineSource({
      id: 'adzuna',
      name: 'Adzuna',
      adapter: 'json',
      enabled: false,
      options: {
        appId: '',
        appKey: '',
        country: 'us',
        url: 'https://api.adzuna.com/v1/api/jobs/us/search/{page}'
          + '?app_id={appId}&app_key={appKey}&results_per_page=50'
          + '&what={query}&where={location}&max_days_old=2&content-type=application/json',
        listPath: 'results',
        maxPages: 2,
        maxQueries: 3,
      },
      fieldMap: {
        id: 'id',
        title: 'title',
        company: 'company.display_name',
        location: 'location.display_name',
        url: 'redirect_url',
        postedAt: 'created',
        description: 'description',
        payMin: 'salary_min',
        payMax: 'salary_max',
      },
      rateLimitPerMinute: 25,
      priority: 5,
    }),
  },
  {
    id: 'usajobs',
    name: 'USAJOBS',
    covers: 'Every US federal opening. Free key, and the only way to see these at all.',
    searches: true,
    signupUrl: 'https://developer.usajobs.gov/APIRequest',
    credentials: [
      {
        option: 'userAgent',
        label: 'Your email',
        help: 'USAJOBS asks for it as the User-Agent on every request.',
        signupUrl: 'https://developer.usajobs.gov/APIRequest',
      },
      {
        option: 'authKey',
        label: 'API key',
        help: 'Emailed to you after you request access — free.',
        signupUrl: 'https://developer.usajobs.gov/APIRequest',
      },
    ],
    build: () => defineSource({
      id: 'usajobs',
      name: 'USAJOBS',
      adapter: 'json',
      enabled: false,
      options: {
        userAgent: '',
        authKey: '',
        url: 'https://data.usajobs.gov/api/search'
          + '?Keyword={query}&LocationName={location}&ResultsPerPage=50&Page={page}',
        listPath: 'SearchResult.SearchResultItems',
        maxPages: 2,
        maxQueries: 3,
        headers: { 'User-Agent': '{userAgent}', 'Authorization-Key': '{authKey}' },
      },
      fieldMap: {
        id: 'MatchedObjectId',
        title: 'MatchedObjectDescriptor.PositionTitle',
        company: 'MatchedObjectDescriptor.OrganizationName',
        location: 'MatchedObjectDescriptor.PositionLocationDisplay',
        url: 'MatchedObjectDescriptor.PositionURI',
        applyUrl: 'MatchedObjectDescriptor.ApplyURI.0',
        postedAt: 'MatchedObjectDescriptor.PublicationStartDate',
        description: 'MatchedObjectDescriptor.UserArea.Details.JobSummary',
        payMin: 'MatchedObjectDescriptor.PositionRemuneration.0.MinimumRange',
        payMax: 'MatchedObjectDescriptor.PositionRemuneration.0.MaximumRange',
      },
      rateLimitPerMinute: 30,
      priority: 4,
    }),
  },
  {
    id: 'remotive',
    name: 'Remotive',
    covers: 'Remote roles across many employers. No account needed.',
    searches: true,
    build: () => defineSource({
      id: 'remotive',
      name: 'Remotive',
      adapter: 'json',
      enabled: false,
      options: {
        url: 'https://remotive.com/api/remote-jobs?limit=50&search={query}',
        listPath: 'jobs',
        maxQueries: 3,
      },
      fieldMap: {
        id: 'id',
        title: 'title',
        company: 'company_name',
        location: 'candidate_required_location',
        url: 'url',
        postedAt: 'publication_date',
        description: 'description',
        pay: 'salary',
      },
      rateLimitPerMinute: 20,
      priority: 3,
    }),
  },
  {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    covers: 'A broad open board, mostly remote and European. No account needed.',
    searches: false,
    build: () => defineSource({
      id: 'arbeitnow',
      name: 'Arbeitnow',
      adapter: 'json',
      enabled: false,
      options: {
        url: 'https://www.arbeitnow.com/api/job-board-api?page={page}',
        listPath: 'data',
        maxPages: 3,
      },
      fieldMap: {
        id: 'slug',
        title: 'title',
        company: 'company_name',
        location: 'location',
        remote: 'remote',
        url: 'url',
        postedAt: 'created_at',
        description: 'description',
      },
      rateLimitPerMinute: 20,
      priority: 2,
    }),
  },
  {
    id: 'remoteok',
    name: 'RemoteOK',
    covers: 'Remote roles, heavily engineering and design. No account needed.',
    searches: false,
    build: () => defineSource({
      id: 'remoteok',
      name: 'RemoteOK',
      adapter: 'json',
      enabled: false,
      options: {
        // The feed's first element is a legal notice rather than a posting. It
        // carries no title, so mapping drops it without needing a special case.
        url: 'https://remoteok.com/api',
      },
      fieldMap: {
        id: 'id',
        title: 'position',
        company: 'company',
        location: 'location',
        url: 'url',
        postedAt: 'date',
        description: 'description',
        payMin: 'salary_min',
        payMax: 'salary_max',
      },
      rateLimitPerMinute: 10,
      priority: 2,
    }),
  },
  {
    id: 'jobicy',
    name: 'Jobicy',
    covers: 'Remote roles across a range of industries. No account needed.',
    searches: false,
    build: () => defineSource({
      id: 'jobicy',
      name: 'Jobicy',
      adapter: 'json',
      enabled: false,
      options: {
        url: 'https://jobicy.com/api/v2/remote-jobs?count=50',
        listPath: 'jobs',
      },
      fieldMap: {
        id: 'id',
        title: 'jobTitle',
        company: 'companyName',
        location: 'jobGeo',
        url: 'url',
        postedAt: 'pubDate',
        description: 'jobDescription',
        payMin: 'annualSalaryMin',
        payMax: 'annualSalaryMax',
        payCurrency: 'salaryCurrency',
      },
      rateLimitPerMinute: 20,
      priority: 2,
    }),
  },
];

/** A preset by id, for rebuilding a source the user turned on earlier. */
export function findPreset(id: string): SourcePreset | undefined {
  return SOURCE_PRESETS.find((preset) => preset.id === id);
}

/** Which credential options a preset still needs before it can run. */
export function missingCredentials(preset: SourcePreset, source: SourceConfig): string[] {
  return (preset.credentials ?? [])
    .filter(({ option }) => !String(source.options[option] ?? '').trim())
    .map(({ option }) => option);
}
