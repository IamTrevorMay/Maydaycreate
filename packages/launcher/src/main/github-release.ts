import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

const OWNER = 'IamTrevorMay';
const REPO = 'Maydaycreate';

interface GitHubRelease {
  id: number;
  tag_name: string;
  draft: boolean;
  upload_url: string;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  id: number;
  name: string;
  state: string;
  size: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiRequest(
  method: string,
  urlPath: string,
  token: string,
  body?: object,
): Promise<GitHubRelease & { message?: string }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'MaydayCreate-Publisher',
          Accept: 'application/vnd.github.v3+json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const code = res.statusCode ?? 0;
          try {
            const json = JSON.parse(body);
            if (code >= 200 && code < 300) resolve(json);
            else reject(new Error(`GitHub API ${method} ${urlPath} → ${code}: ${json.message || body}`));
          } catch {
            reject(new Error(`GitHub API ${method} ${urlPath} → ${code}: ${body}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function apiRequestList(
  urlPath: string,
  token: string,
): Promise<GitHubRelease[]> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: urlPath,
        method: 'GET',
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'MaydayCreate-Publisher',
          Accept: 'application/vnd.github.v3+json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const code = res.statusCode ?? 0;
          try {
            const json = JSON.parse(body);
            if (code >= 200 && code < 300) resolve(json);
            else reject(new Error(`GitHub API GET ${urlPath} → ${code}: ${(json as { message?: string }).message || body}`));
          } catch {
            reject(new Error(`GitHub API GET ${urlPath} → ${code}: ${body}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function deleteAsset(assetId: number, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/assets/${assetId}`,
        method: 'DELETE',
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'MaydayCreate-Publisher',
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if ((res.statusCode ?? 0) < 300) resolve();
          else reject(new Error(`Failed to delete asset ${assetId}: ${res.statusCode}`));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function findOrCreateDraftRelease(
  version: string,
  token: string,
): Promise<GitHubRelease> {
  const tag = `v${version}`;

  // Check existing releases (including drafts)
  const releases = await apiRequestList(
    `/repos/${OWNER}/${REPO}/releases`,
    token,
  );

  const existing = releases.find((r) => r.tag_name === tag);
  if (existing) {
    // Ensure it's a draft so we can modify it
    if (!existing.draft) {
      throw new Error(`Release ${tag} already exists and is published. Cannot overwrite.`);
    }
    return existing;
  }

  // Create a new draft release
  return apiRequest('POST', `/repos/${OWNER}/${REPO}/releases`, token, {
    tag_name: tag,
    name: tag,
    draft: true,
    prerelease: false,
  });
}

export async function uploadReleaseAsset(
  release: GitHubRelease,
  filePath: string,
  assetName: string,
  token: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const maxRetries = 3;
  const retryDelay = 10_000;
  const fileSize = fs.statSync(filePath).size;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Clean up any partial/starter assets from previous attempts
    if (attempt > 1) {
      onProgress?.(`Retry ${attempt}/${maxRetries} for ${assetName}…`);
      const freshRelease = await apiRequest(
        'GET',
        `/repos/${OWNER}/${REPO}/releases/${release.id}`,
        token,
      );
      for (const asset of freshRelease.assets) {
        if (asset.name === assetName && (asset.state === 'starter' || asset.size !== fileSize)) {
          onProgress?.(`Deleting partial asset ${assetName} (${asset.state})…`);
          await deleteAsset(asset.id, token);
        }
      }
    }

    try {
      await doUpload(release.id, filePath, assetName, fileSize, token, onProgress);
      return; // success
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onProgress?.(`Upload failed (attempt ${attempt}/${maxRetries}): ${msg}`);
      if (attempt === maxRetries) throw err;
      await sleep(retryDelay);
    }
  }
}

function doUpload(
  releaseId: number,
  filePath: string,
  assetName: string,
  fileSize: number,
  token: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  // Use system curl instead of Node's https module to avoid
  // Electron BoringSSL SSLV3_ALERT_BAD_RECORD_MAC on large uploads.
  return new Promise((resolve, reject) => {
    const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;

    const proc = spawn('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--max-time', '600',
      '-X', 'POST',
      '-H', `Authorization: token ${token}`,
      '-H', 'User-Agent: MaydayCreate-Publisher',
      '-H', 'Content-Type: application/octet-stream',
      '--data-binary', `@${filePath}`,
      '-o', '/dev/null',
      '-w', '%{http_code}',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    // Track upload progress by polling file read position
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    let lastPct = -1;

    // curl doesn't report upload progress easily, so we report start/end
    onProgress?.(`Uploading ${assetName}: 0% (0/${formatMB(fileSize)})`);

    // Poll /proc-style progress: curl writes to stdout only at end,
    // so we report periodic estimates based on elapsed time
    const startTime = Date.now();
    progressTimer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      // Estimate ~2 MB/s upload speed for progress display
      const estimatedUploaded = Math.min(elapsed * 2 * 1024 * 1024, fileSize);
      const pct = Math.min(Math.round((estimatedUploaded / fileSize) * 100), 99);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        onProgress?.(`Uploading ${assetName}: ${pct}% (${formatMB(estimatedUploaded)}/${formatMB(fileSize)})`);
      }
    }, 2000);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (progressTimer) clearInterval(progressTimer);
      onProgress?.(`Uploading ${assetName}: 100% (${formatMB(fileSize)}/${formatMB(fileSize)})`);

      if (code === 0) {
        const httpCode = parseInt(stdout.trim(), 10);
        if (httpCode >= 200 && httpCode < 300) {
          resolve();
        } else {
          reject(new Error(`Upload ${assetName} → HTTP ${httpCode}`));
        }
      } else {
        reject(new Error(`Upload ${assetName} failed: curl exit ${code}: ${stderr.trim()}`));
      }
    });

    proc.on('error', (err) => {
      if (progressTimer) clearInterval(progressTimer);
      reject(new Error(`Upload ${assetName}: curl not found: ${err.message}`));
    });
  });
}

function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function publishRelease(
  releaseId: number,
  token: string,
): Promise<void> {
  await apiRequest('PATCH', `/repos/${OWNER}/${REPO}/releases/${releaseId}`, token, {
    draft: false,
  });
}

export async function generateLatestMacYml(
  version: string,
  releaseDir: string,
): Promise<string> {
  const zipName = `Mayday Create-${version}-arm64-mac.zip`;
  const dmgName = `Mayday Create-${version}-arm64.dmg`;

  const zipPath = path.join(releaseDir, zipName);
  const dmgPath = path.join(releaseDir, dmgName);

  if (!fs.existsSync(zipPath)) throw new Error(`Missing build artifact: ${zipPath}`);
  if (!fs.existsSync(dmgPath)) throw new Error(`Missing build artifact: ${dmgPath}`);

  const [zipHash, zipSize, dmgHash, dmgSize] = await Promise.all([
    sha512Base64(zipPath),
    fileSize(zipPath),
    sha512Base64(dmgPath),
    fileSize(dmgPath),
  ]);

  // Asset names use dashes (matching what gets uploaded to GitHub)
  const zipAsset = zipName.replace(/ /g, '-');
  const dmgAsset = dmgName.replace(/ /g, '-');

  const yml = [
    `version: ${version}`,
    `files:`,
    `  - url: ${zipAsset}`,
    `    sha512: ${zipHash}`,
    `    size: ${zipSize}`,
    `  - url: ${dmgAsset}`,
    `    sha512: ${dmgHash}`,
    `    size: ${dmgSize}`,
    `path: ${zipAsset}`,
    `sha512: ${zipHash}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');

  const ymlPath = path.join(releaseDir, 'latest-mac.yml');
  fs.writeFileSync(ymlPath, yml, 'utf-8');
  return ymlPath;
}

function sha512Base64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
    stream.on('error', reject);
  });
}

function fileSize(filePath: string): Promise<number> {
  return Promise.resolve(fs.statSync(filePath).size);
}
