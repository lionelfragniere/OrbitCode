/* OrbitCode — Preview Server (Catch-All)
 * Serves static files from user projects under /api/preview/[projectId]/[...path]
 * This enables proper relative URL resolution for CSS, JS, images, etc.
 * 
 * Usage: /api/preview/serve?project=<encoded-path>&file=<relative-path>
 * The iframe loads the HTML, and all relative assets resolve correctly via the service worker approach.
 */
import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'text/plain',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '.pdf': 'application/pdf',
  '.py': 'text/plain',
  '.md': 'text/plain',
  '.csv': 'text/csv',
};

export async function GET(request: NextRequest) {
  const projectFolder = request.nextUrl.searchParams.get('projectFolder');
  const filePath = request.nextUrl.searchParams.get('filePath');

  if (!projectFolder || !filePath) {
    return new Response('projectFolder and filePath required', { status: 400 });
  }

  // Prevent path traversal
  const resolved = path.resolve(projectFolder, filePath);
  if (!resolved.startsWith(path.resolve(projectFolder))) {
    return new Response('Forbidden', { status: 403 });
  }

  let content: Buffer;
  let ext = path.extname(resolved).toLowerCase();

  try {
    content = await fs.readFile(resolved);
  } catch {
    // Fallback: If not found at root, try the `public/` directory!
    // Next.js and Vite default to serving from `/public` for root-relative requests.
    const publicResolved = path.resolve(projectFolder, 'public', filePath.replace(/^\/+/, ''));
    if (!publicResolved.startsWith(path.resolve(projectFolder, 'public'))) {
      return new Response('Forbidden', { status: 403 });
    }
    
    try {
      content = await fs.readFile(publicResolved);
      ext = path.extname(publicResolved).toLowerCase();
    } catch {
      return new Response('File not found', { status: 404 });
    }
  }

  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    // For HTML files, inject a <base> tag so relative URLs resolve correctly
    if (ext === '.html' || ext === '.htm') {
      let html = content.toString('utf-8');
      
      // Calculate the base URL for this project's folder
      const dir = path.dirname(filePath).replace(/\\/g, '/');
      const baseHref = `/api/preview?projectFolder=${encodeURIComponent(projectFolder)}&filePath=`;
      
      // Rewrite relative src/href attributes to use our preview API
      html = rewriteRelativeUrls(html, projectFolder, dir);
      
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response(content as unknown as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response('File not found', { status: 404 });
  }
}

/**
 * Rewrite relative URLs in HTML to point to the preview API.
 * Handles: src="script.js", href="style.css", src="img/logo.png"
 * Does NOT rewrite: absolute URLs (http://, //), data: URIs, or anchors (#)
 */
function rewriteRelativeUrls(html: string, projectFolder: string, currentDir: string): string {
  const previewBase = `/api/preview?projectFolder=${encodeURIComponent(projectFolder)}&filePath=`;
  
  // Match src="..." and href="..." attributes (but not data:, http:, //, #, {)
  return html.replace(
    /((?:src|href|action|poster)\s*=\s*)(["'])([^"']*?)\2/gi,
    (match, attr, quote, url) => {
      // Skip absolute URLs, data URIs, anchors, template expressions
      if (!url || url.startsWith('http://') || url.startsWith('https://') || 
          url.startsWith('//') || url.startsWith('data:') || url.startsWith('#') ||
          url.startsWith('javascript:') || url.startsWith('{') || url.startsWith('/api/')) {
        return match;
      }
      
      // Resolve the relative path
      let resolvedPath: string;
      if (url.startsWith('/')) {
        // Absolute path relative to project root
        resolvedPath = url.substring(1);
      } else {
        // Relative to current directory
        resolvedPath = currentDir && currentDir !== '.' 
          ? `${currentDir}/${url}` 
          : url;
      }
      
      // Normalize path (handle ../ etc)
      resolvedPath = path.normalize(resolvedPath).replace(/\\/g, '/');
      
      return `${attr}${quote}${previewBase}${encodeURIComponent(resolvedPath)}${quote}`;
    }
  );
}
