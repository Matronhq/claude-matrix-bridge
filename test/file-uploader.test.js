import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { isSensitivePath, resolveInWorkdir, sendFileViewerLink } from '../lib/file-uploader.js';

describe('isSensitivePath', () => {
  it('blocks .env files', () => {
    expect(isSensitivePath('/app/.env')).toBe(true);
    expect(isSensitivePath('/app/.env.local')).toBe(true);
    expect(isSensitivePath('/app/.env.production')).toBe(true);
  });

  it('blocks secrets/credentials files', () => {
    expect(isSensitivePath('/app/secrets.json')).toBe(true);
    expect(isSensitivePath('/app/credentials')).toBe(true);
    expect(isSensitivePath('/app/credentials.yaml')).toBe(true);
  });

  it('blocks key files', () => {
    expect(isSensitivePath('/app/server.pem')).toBe(true);
    expect(isSensitivePath('/app/private.key')).toBe(true);
    expect(isSensitivePath('/app/id_rsa')).toBe(true);
    expect(isSensitivePath('/app/id_ed25519')).toBe(true);
  });

  it('blocks sensitive directories', () => {
    expect(isSensitivePath('/home/user/.aws/config')).toBe(true);
    expect(isSensitivePath('/home/user/.ssh/known_hosts')).toBe(true);
    expect(isSensitivePath('/home/user/.docker/config.json')).toBe(true);
    expect(isSensitivePath('/home/user/.kube/config')).toBe(true);
    expect(isSensitivePath('/home/user/.gnupg/secring.gpg')).toBe(true);
  });

  it('allows normal code files', () => {
    expect(isSensitivePath('/app/src/index.js')).toBe(false);
    expect(isSensitivePath('/app/README.md')).toBe(false);
    expect(isSensitivePath('/app/package.json')).toBe(false);
  });
});

describe('resolveInWorkdir', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'file-link-test-'));
    writeFileSync(path.join(tmpDir, 'inside.txt'), 'hello');
    writeFileSync('/tmp/outside-target.txt', 'secret');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    try { rmSync('/tmp/outside-target.txt'); } catch {}
  });

  it('returns resolved path for file inside workdir', async () => {
    const result = await resolveInWorkdir(path.join(tmpDir, 'inside.txt'), tmpDir);
    expect(result).toBe(path.join(tmpDir, 'inside.txt'));
  });

  it('returns null for file outside workdir', async () => {
    const result = await resolveInWorkdir('/etc/passwd', tmpDir);
    expect(result).toBeNull();
  });

  it('returns null for symlink pointing outside workdir', async () => {
    const linkPath = path.join(tmpDir, 'sneaky-link');
    symlinkSync('/tmp/outside-target.txt', linkPath);
    const result = await resolveInWorkdir(linkPath, tmpDir);
    expect(result).toBeNull();
  });

  it('handles workdir with trailing slash', async () => {
    const result = await resolveInWorkdir(path.join(tmpDir, 'inside.txt'), tmpDir + '/');
    expect(result).toBe(path.join(tmpDir, 'inside.txt'));
  });

  it('rejects prefix-collision paths', async () => {
    const result = await resolveInWorkdir(tmpDir + 'extra/evil.txt', tmpDir);
    expect(result).toBeNull();
  });

  it('falls back to lexical check for non-existent files', async () => {
    const result = await resolveInWorkdir(path.join(tmpDir, 'does-not-exist.txt'), tmpDir);
    expect(result).toBe(path.join(tmpDir, 'does-not-exist.txt'));
  });
});

describe('sendFileViewerLink', () => {
  let tmpDir;
  let sendHtml;
  const VIEWER_URL = 'https://viewer.example.com';
  const HMAC = 'test-secret-key-for-hmac';

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'file-link-test-'));
    sendHtml = vi.fn();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sends a viewer link for a valid file', async () => {
    writeFileSync(path.join(tmpDir, 'test.js'), 'console.log("hello");');
    const result = await sendFileViewerLink(sendHtml, path.join(tmpDir, 'test.js'), {
      workdir: tmpDir,
      toolUseId: 'toolu_test1',
      viewerBaseUrl: VIEWER_URL,
      hmacSecret: HMAC,
    });
    expect(result).toMatch(/^https:\/\/viewer\.example\.com\/view\?token=/);
    expect(sendHtml).toHaveBeenCalledTimes(1);
    const [plain, html] = sendHtml.mock.calls[0];
    expect(plain).toBe('📎 test.js');
    expect(html).toContain('test.js');
    expect(html).toContain('href=');
  });

  it('returns null when viewer is not configured', async () => {
    writeFileSync(path.join(tmpDir, 'test.js'), 'code');
    const result = await sendFileViewerLink(sendHtml, path.join(tmpDir, 'test.js'), {
      workdir: tmpDir,
      toolUseId: 'toolu_noviewer',
    });
    expect(result).toBeNull();
    expect(sendHtml).not.toHaveBeenCalled();
  });

  it('skips files exceeding maxBytes', async () => {
    writeFileSync(path.join(tmpDir, 'big.txt'), 'x'.repeat(100));
    const result = await sendFileViewerLink(sendHtml, path.join(tmpDir, 'big.txt'), {
      workdir: tmpDir,
      maxBytes: 50,
      toolUseId: 'toolu_big',
      viewerBaseUrl: VIEWER_URL,
      hmacSecret: HMAC,
    });
    expect(result).toBeNull();
    expect(sendHtml).not.toHaveBeenCalled();
  });

  it('skips missing files', async () => {
    const result = await sendFileViewerLink(sendHtml, path.join(tmpDir, 'nope.txt'), {
      workdir: tmpDir,
      toolUseId: 'toolu_missing',
      viewerBaseUrl: VIEWER_URL,
      hmacSecret: HMAC,
    });
    expect(result).toBeNull();
    expect(sendHtml).not.toHaveBeenCalled();
  });

  it('denies files outside workdir', async () => {
    const result = await sendFileViewerLink(sendHtml, '/etc/passwd', {
      workdir: tmpDir,
      toolUseId: 'toolu_outside',
      viewerBaseUrl: VIEWER_URL,
      hmacSecret: HMAC,
    });
    expect(result).toBeNull();
    expect(sendHtml).not.toHaveBeenCalled();
  });

  it('denies sensitive files', async () => {
    writeFileSync(path.join(tmpDir, '.env.local'), 'SECRET=foo');
    const result = await sendFileViewerLink(sendHtml, path.join(tmpDir, '.env.local'), {
      workdir: tmpDir,
      toolUseId: 'toolu_sensitive',
      viewerBaseUrl: VIEWER_URL,
      hmacSecret: HMAC,
    });
    expect(result).toBeNull();
    expect(sendHtml).not.toHaveBeenCalled();
  });
});
