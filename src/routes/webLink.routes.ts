import { Router, Request, Response } from 'express';
import { deepLinkService } from '../services/deepLink.service';
import { env } from '../config/env';

const router = Router();

/**
 * GET /.well-known/apple-app-site-association (and /apple-app-site-association)
 * Serves the Apple App Site Association JSON for iOS Universal Links.
 */
const appleAppSiteAssociationHandler = (_req: Request, res: Response) => {
  const teamId = env.APPLE_TEAM_ID || 'PQ3L2P67J5';
  const bundleId = env.APPLE_CLIENT_ID || 'com.app.flirttime';

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.${bundleId}`,
          paths: ['/l/*', '/moments/*', '/users/*'],
          components: [
            {
              '/': '/l/*',
              comment: 'Matches any share link code',
            },
          ],
        },
      ],
    },
    webcredentials: {
      apps: [`${teamId}.${bundleId}`],
    },
  });
};

router.get('/.well-known/apple-app-site-association', appleAppSiteAssociationHandler);
router.get('/apple-app-site-association', appleAppSiteAssociationHandler);

/**
 * GET /.well-known/assetlinks.json
 * Serves Android Digital Asset Links for verified App Links.
 */
router.get('/.well-known/assetlinks.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: env.ANDROID_PACKAGE_NAME || 'com.app.flirttime',
        sha256_cert_fingerprints: [
          '14:6D:E9:7F:0F:52:EC:6B:85:4E:22:9E:C1:2B:A3:86:7F:5F:73:C6:23:4B:2B:D2:C7:E3:6C:C9:83:B3:9E:81',
        ],
      },
    },
  ]);
});

/**
 * GET /l/:code
 * Web Landing Page with Open Graph meta tags, iOS Smart App Banner,
 * and automated redirection to native app scheme with web fallback.
 */
router.get('/l/:code', async (req: Request, res: Response) => {
  const code = req.params.code as string;

  try {
    const preview = await deepLinkService.getPreviewMetadata(code);
    const appBaseUrl = env.DEEP_LINK_BASE_URL.replace(/\/+$/, '');
    const canonicalUrl = `${appBaseUrl}/l/${code}`;
    const customSchemeUrl = `flirttime://l/${code}`;
    const appStoreUrl = `https://apps.apple.com/app/flirttime/${env.IOS_APP_STORE_ID}`;
    const playStoreUrl = `https://play.google.com/store/apps/details?id=${env.ANDROID_PACKAGE_NAME}`;

    const title = preview.title || 'FlirtTime - Dating & Real Connections';
    const description = preview.description || 'Open FlirtTime to view this shared moment.';
    const imageUrl = preview.thumbnailUrl || `${appBaseUrl}/assets/flirttime-preview-icon.png`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:site_name" content="FlirtTime">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${escapeHtml(canonicalUrl)}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">

  <!-- Apple iOS Smart App Banner & Universal Links -->
  <meta name="apple-itunes-app" content="app-id=${escapeHtml(env.IOS_APP_STORE_ID)}, app-argument=${escapeHtml(customSchemeUrl)}">

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 0%, #3d142d, #140812 80%);
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
    }
    .card {
      background: rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 24px;
      padding: 32px 24px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }
    .logo {
      font-size: 26px;
      font-weight: 800;
      background: linear-gradient(135deg, #ff4b8b, #ff758c);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 20px;
      letter-spacing: -0.5px;
    }
    .thumb-wrap {
      width: 140px;
      height: 140px;
      margin: 0 auto 20px;
      border-radius: 20px;
      overflow: hidden;
      border: 2px solid rgba(255, 75, 139, 0.4);
      background: #2a1122;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .thumb-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 10px;
      line-height: 1.3;
    }
    p {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 24px;
      line-height: 1.4;
    }
    .btn-primary {
      display: block;
      width: 100%;
      padding: 14px 20px;
      background: linear-gradient(135deg, #ff4b8b, #e6005c);
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      border-radius: 30px;
      box-shadow: 0 8px 20px rgba(255, 75, 139, 0.35);
      transition: transform 0.15s ease;
      margin-bottom: 12px;
    }
    .btn-primary:active {
      transform: scale(0.98);
    }
    .btn-secondary {
      display: block;
      width: 100%;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.85);
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      border-radius: 30px;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.4);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">FlirtTime</div>
    ${
      imageUrl
        ? `<div class="thumb-wrap"><img src="${escapeHtml(imageUrl)}" alt="Preview"></div>`
        : ''
    }
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>

    <a href="${escapeHtml(customSchemeUrl)}" id="openAppBtn" class="btn-primary">Open in App</a>
    <a href="${escapeHtml(appStoreUrl)}" class="btn-secondary">Download on App Store</a>
  </div>

  <div class="footer">
    &copy; ${new Date().getFullYear()} FlirtTime. Real Dating & Connections.
  </div>

  <script>
    // Automatically try opening the installed app on mobile devices
    window.addEventListener('DOMContentLoaded', function() {
      var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        var start = Date.now();
        var timeout = setTimeout(function() {
          // Stay on landing page if app not installed
        }, 2000);

        window.location.href = "${escapeHtml(customSchemeUrl)}";
      }
    });
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err: any) {
    return res.status(404).send(`<!DOCTYPE html>
<html>
<head><title>Content Not Found - FlirtTime</title></head>
<body style="background:#140812;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
  <h2>Content Not Available</h2>
  <p>This shared link is invalid or has expired.</p>
</body>
</html>`);
  }
});

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default router;
