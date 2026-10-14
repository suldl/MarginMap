import { net } from 'electron';
import type { UpdateResult } from '../src/backend';

/**
 * "Check for updates" support. The feed is configured in package.json
 * (`marginmap.updateUrl`) or with the MARGINMAP_UPDATE_URL environment variable, as either
 *   - `owner/repo` (or `github:owner/repo`): the latest GitHub release of that repository, or
 *   - an http(s) URL returning a GitHub release object or `{ "version", "url", "notes" }`.
 * Nothing is downloaded or installed automatically: the user is pointed to the release page.
 */
export function resolveFeed(configured: string | undefined): string | null {
  const raw = (process.env.MARGINMAP_UPDATE_URL || configured || '').trim();
  if (!raw) return null;
  const gh = /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(raw);
  if (gh) return `https://api.github.com/repos/${gh[1]}/${gh[2]}/releases/latest`;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

/** Human-readable feed description for the settings page. */
export function describeFeed(feed: string | null): string | null {
  if (!feed) return null;
  const gh = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/releases\/latest$/.exec(feed);
  return gh ? `GitHub releases of ${gh[1]}/${gh[2]}` : new URL(feed).host || feed;
}

interface Parsed {
  version: string;
  url?: string;
  notes?: string;
  publishedAt?: string;
}

const httpsOnly = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : undefined);

function parseFeed(data: unknown): Parsed {
  const d = (data ?? {}) as Record<string, unknown>;
  // GitHub release object.
  if (typeof d.tag_name === 'string') {
    const assets = Array.isArray(d.assets) ? (d.assets as Record<string, unknown>[]) : [];
    const exe = assets.find((a) => /setup.*\.exe$/i.test(String(a.name))) ?? assets.find((a) => /\.exe$/i.test(String(a.name)));
    return {
      version: d.tag_name,
      // The release page lets people pick the installer or the portable build.
      url: httpsOnly(d.html_url) ?? httpsOnly(exe?.browser_download_url),
      notes: typeof d.body === 'string' ? d.body : undefined,
      publishedAt: typeof d.published_at === 'string' ? d.published_at : undefined,
    };
  }
  if (typeof d.version === 'string') {
    return {
      version: d.version,
      url: httpsOnly(d.url) ?? httpsOnly(d.downloadUrl),
      notes: typeof d.notes === 'string' ? d.notes : undefined,
      publishedAt: typeof d.date === 'string' ? d.date : undefined,
    };
  }
  throw new Error('The update feed did not contain a version');
}

function parseVersion(v: string) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ?? '' };
}

/** Semver-style comparison: negative if a < b. Pre-releases sort before the release. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre, undefined, { numeric: true });
}

export async function checkForUpdates(current: string, feed: string | null): Promise<UpdateResult> {
  if (!feed) return { status: 'unconfigured', current };
  try {
    const res = await net.fetch(feed, {
      headers: { accept: 'application/vnd.github+json, application/json', 'user-agent': `MarginMap/${current}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(res.status === 404 ? 'No published release was found' : `The update server answered ${res.status}`);
    const info = parseFeed(await res.json());
    const latest = info.version.replace(/^v/i, '');
    if (!parseVersion(latest)) throw new Error(`Unrecognised version "${info.version}"`);
    return {
      status: compareVersions(latest, current) > 0 ? 'available' : 'current',
      current,
      latest,
      url: info.url,
      notes: info.notes?.slice(0, 4000),
      publishedAt: info.publishedAt,
    };
  } catch (err) {
    const e = err as Error;
    const offline = e.name === 'TimeoutError' || /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/.test(e.message);
    return { status: 'error', current, error: offline ? 'Could not reach the update server — are you online?' : e.message };
  }
}
